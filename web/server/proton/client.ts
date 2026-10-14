import { coord, mapStatus, mapTrip, mapVehicle, type AtlasTrip, type AtlasVehicleInfo, type AtlasVehicleStatus } from "../../../src/providers/proton/mappers.ts";
import { formatNotice } from "../../../src/providers/proton/format.ts";
import { md5, ProtonError, type ProtonApi } from "./api.ts";
import { watchControlResults, type ControlResult } from "./mqtt.ts";
import { bindPushDevice, registerPushDevice } from "./push-device.ts";
import { loadPack, type SceneAngleId } from "./scene.ts";

/**
 * The parts of src/providers/proton/index.ts the web app uses: vehicles, status, commands,
 * trips and the inbox. The mappers and formatters are imported from the mobile app unchanged.
 */

type ControlRequest = {
  serviceKey: string;
  duration?: number | null;
  parameters?: { key: string; stringVal?: string }[] | null;
};

type Params = Record<string, string | number>;

/** A capability tree item: `A001X001Y010-RDU` → family "RDU", plus its (English and Chinese) name. */
type Ability = { family: string; name: string };
const has = (caps: Ability[], family: string, name?: RegExp) => caps.some((c) => c.family === family && (!name || name.test(c.name)));

/**
 * Command id → Atlas `serviceKey` (acosdk RvcKtxKt.toRequest) and the capability it needs. A
 * family alone is too broad: an S70 lists RWS for its windows but has no sunroof control.
 */
const CONTROLS: Record<string, { needs: (caps: Ability[]) => boolean; build: (p: Params) => ControlRequest }> = {
  lock: { needs: (c) => has(c, "RDL") || has(c, "RDU"), build: () => ({ serviceKey: "RDL-OFF" }) },
  unlock: { needs: (c) => has(c, "RDU"), build: () => ({ serviceKey: "RDU-ON" }) },
  climate_on: { needs: (c) => has(c, "RCE"), build: (p) => ({ serviceKey: "RCE-ON", parameters: [{ key: "rce.temp", stringVal: String(p.temp ?? 22) }] }) },
  climate_off: { needs: (c) => has(c, "RCE"), build: () => ({ serviceKey: "RCE-OFF" }) },
  defrost_on: { needs: (c) => has(c, "RCE", /defrost/i), build: () => ({ serviceKey: "RCE-DefrostON" }) },
  horn_lights: { needs: (c) => has(c, "RHL"), build: () => ({ serviceKey: "RHL-HornAndLight" }) },
  lights: { needs: (c) => has(c, "RHL"), build: () => ({ serviceKey: "RHL-LIGHT" }) },
  windows_close: { needs: (c) => has(c, "RWS", /window (?:close|open)/i), build: () => ({ serviceKey: "RWS-OFF" }) },
  windows_open: { needs: (c) => has(c, "RWS", /window (?:close|open)/i), build: () => ({ serviceKey: "RWS-ON" }) },
  ventilate: { needs: (c) => has(c, "RWS", /ventilat/i), build: () => ({ serviceKey: "RWS-BreathableON" }) },
  sunroof_close: { needs: (c) => has(c, "RWS", /sunroof/i), build: () => ({ serviceKey: "RWS-SunroofOFF" }) },
  // Unlocks the boot latch; it doesn't pop the boot open.
  trunk_open: { needs: (c) => has(c, "RTU") || has(c, "RDU", /trunk/i), build: () => ({ serviceKey: "RDU-TargetON" }) },
  trunk_lock: { needs: (c) => has(c, "RTU", /trunk lock|lock trunk/i) || has(c, "RDU", /trunk lock|lock trunk/i), build: () => ({ serviceKey: "RDU-TargetOFF" }) },
  // Minutes, as Proton Link's engine dialog sends them.
  engine_start: { needs: (c) => has(c, "RES"), build: (p) => ({ serviceKey: "RES-Engine-ON", duration: Number(p.minutes ?? 10) }) },
  engine_stop: { needs: (c) => has(c, "RES"), build: () => ({ serviceKey: "RES-Engine-OFF" }) },
  charge_start: { needs: (c) => has(c, "RCS"), build: () => ({ serviceKey: "RCS-ChargingStart" }) },
  charge_stop: { needs: (c) => has(c, "RCS"), build: () => ({ serviceKey: "RCS-ChargingStop" }) },
};

// Keyed by EXECUTION_FAIL code.
const CAR_REFUSALS: Record<string, string> = {
  // The car allows only a few remote starts until it has been driven.
  "2048": "Remote start limit reached. Drive the car once, then try again.",
};

type CapabilityNode = { itemCode?: string; itemName?: string; child?: CapabilityNode[] };

function abilities(tree: CapabilityNode[]) {
  const out: Ability[] = [];
  const walk = (nodes?: CapabilityNode[]) =>
    nodes?.forEach((n) => {
      const family = n.itemCode?.split("-")[1];
      if (family) out.push({ family, name: n.itemName ?? "" });
      walk(n.child);
    });
  walk(tree);
  return out;
}

/** "METALLIC QUARTZ BLACK II 2K-A0" → "Metallic Quartz Black II" (drops the paint code). */
function paintName(raw?: string) {
  if (!raw) return undefined;
  return raw
    .replace(/\s+\S*\d\S*-\S+$/, "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Ii|Iii|Iv)\b/g, (r) => r.toUpperCase());
}

/** "P380-1.5-7DCT2WD-Q-MH0" → "1.5 · 7DCT"; the variant letter isn't decoded. */
function drivetrain(modelName?: string) {
  const [, engine, gearbox] = modelName?.split("-") ?? [];
  const box = gearbox?.match(/^\d*[A-Z]+?(?=\dWD|$)/)?.[0];
  return [engine && /^\d/.test(engine) ? engine : undefined, box].filter(Boolean).join(" · ") || undefined;
}

/** Success words win: successes can read like warnings ("Remote engine started. Please use the vehicle in time."). */
function inboxSucceeded(text: string) {
  if (/success|succeeded|started|completed|executed|turned on|is on\b/i.test(text)) return true;
  return !/fail|unable|cannot|can't|limit reached|exceed|error|timed? ?out|rejected|not (?:been )?(?:executed|completed|started|possible)/i.test(text);
}

export type Stage = "cloud" | "car";
export type CommandResult = { isOk: boolean; message: string; requestId?: string; isConfirmed?: boolean };

type Msg = {
  id?: string;
  messageTitle?: string;
  messageContent?: string;
  createTime?: string;
  createTimeInt?: number;
  readStatus?: number;
  templateLabelId?: string;
  templatesCategoryCode?: string;
  businessData?: string;
};

export type SceneResult = { angles: { id: SceneAngleId; pack: string; layers: Record<string, string> }[] };

export function createClient(api: ProtonApi, dataDir: string) {
  const infoByVin = new Map<string, AtlasVehicleInfo>();
  const sceneByVin = new Map<string, SceneResult>();

  const loadInfos = async () => {
    const list = (await api.atlas<AtlasVehicleInfo[]>("basic/user/vehicle/list")) ?? [];
    list.forEach((v) => infoByVin.set(v.vin, v));
    return list;
  };
  const infoFor = async (vin: string) => {
    if (!infoByVin.has(vin)) await loadInfos();
    const info = infoByVin.get(vin);
    if (!info) throw new ProtonError("That car isn't on this account");
    return info;
  };

  const imageFor = async (v: AtlasVehicleInfo) => {
    if (!v.matCode || !v.modelCode || !v.bodyColorCode) return undefined;
    const res = await api
      .atlas<{ fileUrls?: { url?: string }[] }>("basic/mat/model/bodyPictureList", {
        method: "POST",
        body: { matCode: v.matCode, modelCode: v.modelCode, bodyColorCode: v.bodyColorCode, topColorCode: v.topColorCode ?? null },
      })
      .catch(() => null);
    return res?.fileUrls?.find((f) => f.url)?.url;
  };

  const paintFor = async (v: AtlasVehicleInfo) => {
    if (!v.matCode || !v.modelCode || !v.bodyColorCode) return undefined;
    const res = await api
      .atlas<{ bodyColors?: { bodyColorCode?: string; bodyColorName?: string }[] }>("basic/mat/colorModelDetailList", {
        method: "POST",
        body: { matCode: v.matCode, modelCode: v.modelCode },
      })
      .catch(() => null);
    return res?.bodyColors?.find((c) => c.bodyColorCode === v.bodyColorCode)?.bodyColorName;
  };

  const supported = async (vin: string) => {
    try {
      const caps = abilities((await api.atlas<CapabilityNode[]>(`basic/ability/vehicle/${encodeURIComponent(vin)}`)) ?? []);
      if (caps.length === 0) return undefined;
      return Object.entries(CONTROLS)
        .filter(([, c]) => c.needs(caps))
        .map(([id]) => id);
    } catch {
      return undefined; // offer everything if the capability tree is unavailable
    }
  };

  const pushDeviceId = async () => {
    let id = api.pushDeviceId;
    if (!id) {
      id = (await registerPushDevice(api)) ?? undefined;
      if (id) await api.setPushDeviceId(id);
    } else {
      await bindPushDevice(api, id);
    }
    return id ?? api.deviceId;
  };

  const labels = async () =>
    ((await api.atlas<{ labelId?: string; labelName?: string }[]>("information/mobileLog/queryLabelList").catch(() => null)) ?? []).filter(
      (l): l is { labelId: string; labelName?: string } => !!l.labelId,
    );
  const latestMessages = (labelIds: string[], pageSize: number) =>
    api.atlas<Msg[]>("information/mobileLog/queryPageList", { query: { labelIdList: labelIds, currentPage: 1, pageSize } });

  /**
   * Proton also files each command's outcome as an inbox message; a fallback for when MQTT is
   * connected but silent. Await `ready` before sending so only newer messages count.
   */
  const inboxResult = (deadline: number) => {
    let stopped = false;
    let taskId: string | undefined;
    const keyOf = (m: Msg) => m.id ?? `${m.createTimeInt}:${m.messageContent}`;
    const setup = (async () => {
      const ids = (await labels()).map((l) => l.labelId);
      const seen = new Set((ids.length ? ((await latestMessages(ids, 10).catch(() => null)) ?? []) : []).map(keyOf));
      return { ids, seen };
    })();
    const promise = (async (): Promise<ControlResult | null> => {
      const { ids, seen } = await setup;
      if (!ids.length) return null;
      while (!stopped && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5_000));
        if (stopped) return null;
        for (const m of (await latestMessages(ids, 10).catch(() => null)) ?? []) {
          if (seen.has(keyOf(m)) || !/vehicle\s*control|remote|control/i.test(`${m.messageTitle} ${m.templatesCategoryCode}`)) continue;
          let data: { taskId?: string; serviceResult?: string; code?: string | number } | undefined;
          try {
            data = m.businessData ? JSON.parse(m.businessData) : undefined;
          } catch {}
          if (data?.taskId && taskId && data.taskId !== taskId) continue;
          if (data?.serviceResult === "ISSUED_SUCCESS") continue;
          const text = m.messageContent?.trim() ?? "";
          const isOk =
            data?.serviceResult === "EXECUTION_SUCCESS" ? true : data?.serviceResult === "EXECUTION_FAIL" ? false : inboxSucceeded(text);
          return { isOk, code: data?.code, message: text || undefined };
        }
      }
      return null;
    })();
    return {
      ready: setup.then(() => undefined),
      promise,
      forTask: (id: string) => (taskId = id),
      stop: () => (stopped = true),
    };
  };

  return {
    async listVehicles() {
      const infos = await loadInfos();
      const vehicles = await Promise.all(
        infos.map(async (v) => {
          const [imageUrl, commands, color] = await Promise.all([imageFor(v), supported(v.vin), paintFor(v)]);
          const info = v as AtlasVehicleInfo & { bodyColorName?: string; soldTime?: number };
          return {
            ...mapVehicle(v, imageUrl),
            // Proton Link leaves vehicleName empty unless you rename the car; matName is the model ("S70").
            name: v.vehicleName?.trim() || [v.brandName && v.brandName !== "acotech" ? v.brandName : "Proton", v.matName].filter(Boolean).join(" "),
            model: drivetrain(v.modelName) ?? v.modelName,
            commands,
            color: paintName(info.bodyColorName) ?? color,
            plate: v.customPlateNo || v.plateNo || undefined,
            ownedSince: info.soldTime || undefined,
          };
        }),
      );
      return vehicles.sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault));
    },

    async getStatus(vin: string) {
      const s = (await api.atlas<AtlasVehicleStatus>("iot/function/getVehicleStatus", { method: "POST", body: { vin } })) ?? {};
      const at = coord(s.latitude, s.longitude);
      return { ...mapStatus(s), location: at ? { ...at, updatedAt: typeof s.updateTime === "number" ? s.updateTime : undefined } : null };
    },

    /** The layer pack per camera angle; the layers are served by /api/scene/:pack/:file. */
    async getScene(vin: string): Promise<SceneResult> {
      const cached = sceneByVin.get(vin);
      if (cached) return cached;
      const info = await infoFor(vin);
      if (!info.matCode || !info.modelCode || !info.bodyColorCode) return { angles: [] };

      const ids: SceneAngleId[] = ["fortyFive", "top"];
      const packs = await Promise.all(
        ids.map((id) =>
          loadPack(api, info, id, dataDir).catch((e) => {
            console.log(`[scene] ${id} failed: ${(e as Error).message}`);
            return null;
          }),
        ),
      );
      const angles: SceneResult["angles"] = [];
      packs.forEach((p, i) => {
        if (!p) return;
        const layers: Record<string, string> = {};
        for (const f of p.files) layers[f.replace(/\.[^.]+$/, "").toUpperCase()] = `/api/scene/${p.pack}/${f}`;
        if (Object.keys(layers).some((k) => k.includes("FRAME"))) angles.push({ id: ids[i], pack: p.pack, layers });
      });
      const scene = { angles };
      // Don't cache a total failure, so the next call retries.
      if (angles.length) sceneByVin.set(vin, scene);
      return scene;
    },

    async getDataUsage(vin: string) {
      const res = await api.legacy<{ residueFlow?: string; usedFlow?: string }>("app/v1/vehicle/flow", { query: { userId: api.userId, vin } });
      const bytes = (kb?: string) => {
        const n = kb === undefined || kb === "" ? NaN : Number(kb);
        return Number.isFinite(n) ? n * 1024 : undefined;
      };
      const usedBytes = bytes(res?.usedFlow);
      const remainingBytes = bytes(res?.residueFlow);
      return usedBytes === undefined && remainingBytes === undefined ? null : { usedBytes, remainingBytes };
    },

    async sendCommand(vin: string, command: string, opts: { pin?: string; params?: Params; onProgress?: (stage: Stage) => void }): Promise<CommandResult> {
      const control = CONTROLS[command];
      if (!control) throw new ProtonError(`Unsupported command ${command}`);
      const info = await infoFor(vin);
      if (info.enablePin) {
        if (!opts.pin) throw new ProtonError("Enter your vehicle PIN", "pin");
        // Proton Link sends md5(md5(pin) + userId) with type VEHICLE_CONTROL.
        await api.atlas("basic/vehicle/checkPinCode", {
          method: "POST",
          body: { vin, pinCode: md5(md5(opts.pin) + api.userId), type: "VEHICLE_CONTROL" },
        });
      }
      const req = control.build(opts.params ?? {});
      // Listen before sending: a fast car can answer before the HTTP call returns.
      const inbox = inboxResult(Date.now() + 45_000);
      const [watch] = await Promise.all([pushDeviceId().then((id) => watchControlResults(api.env, id, dataDir)), inbox.ready]);
      try {
        const res = await api.atlas<{ requestId?: string }>("iot/function/vehicleControl", {
          method: "POST",
          body: { vin, scheduledTime: null, endTime: null, duration: null, parameters: null, timerData: null, ...req },
        });
        opts.onProgress?.("cloud");
        const queued = { isOk: true, message: "Sent to your car. No reply from it yet.", requestId: res?.requestId };
        if (!res?.requestId) return queued;
        inbox.forTask(res.requestId);
        // 40 s is Proton Link's own timeout. Race the inbox too: MQTT can be connected yet silent.
        const result = await Promise.race([
          watch ? watch.waitFor(res.requestId, 40_000, () => opts.onProgress?.("car")) : new Promise<null>(() => {}),
          inbox.promise,
        ]);
        if (!result) return queued;
        if (!result.isOk) {
          const message = CAR_REFUSALS[String(result.code)] ?? result.message ?? "The car couldn't do that";
          return { isOk: false, message, requestId: res.requestId, isConfirmed: true };
        }
        return { isOk: true, message: "Done", requestId: res.requestId, isConfirmed: true };
      } finally {
        watch?.close();
        inbox.stop();
      }
    },

    async getTrips(vin: string, days = 30) {
      const end = Date.now();
      const pageSize = 50;
      const all: AtlasTrip[] = [];
      // Proton pages trips 50 at a time, newest first; a short page is the last one.
      for (let currentPage = 1; currentPage <= 20; currentPage++) {
        const page =
          (await api.atlas<AtlasTrip[]>("bigdata/vehicle/trip/queryList/app/v1", {
            method: "POST",
            body: { startTime: end - days * 86_400_000, endTime: end, vin, isPage: true, currentPage, pageSize },
          })) ?? [];
        all.push(...page);
        if (page.length < pageSize) break;
      }
      // The start time alone, so a trip keeps its id (and its link) as newer trips arrive.
      return all
        .map(mapTrip)
        .filter((t) => t !== null)
        .map((t) => ({ ...t, id: String(t.startedAt) }));
    },

    async getTripTrack(vin: string, startTime: number, endTime: number) {
      const points = await api.atlas<{ latitude?: string; longitude?: string }[]>("bigdata/vehicle/trip/queryTrackList/app/v1", {
        method: "POST",
        body: { startTime, endTime, currentPage: 0, pageSize: 1000, vin },
      });
      return (points ?? []).map((p) => coord(p.latitude, p.longitude)).filter((c) => !!c);
    },

    async markNoticeRead(id: string) {
      await api.atlas("information/mobileLog/markReadByLogId", { method: "POST", body: { logIds: [id] } });
    },

    async getNotices() {
      const all = await labels();
      if (!all.length) return [];
      const names = new Map(all.map((l) => [l.labelId, l.labelName]));
      const list = (await latestMessages(all.map((l) => l.labelId), 30)) ?? [];
      return list.map((n) => ({
        id: String(n.id),
        ...formatNotice({
          title: n.messageTitle,
          body: n.messageContent,
          label: (n.templateLabelId && names.get(n.templateLabelId)) || undefined,
        }),
        createdAt: n.createTimeInt || Date.parse(String(n.createTime ?? "").replace(" ", "T")) || Date.now(),
        // Only 0 means unread.
        isRead: n.readStatus !== 0,
      }));
    },
  };
}

export type ProtonClient = ReturnType<typeof createClient>;
