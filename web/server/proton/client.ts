import { coord, mapStatus, mapTrip, mapVehicle, type AtlasTrip, type AtlasVehicleInfo, type AtlasVehicleStatus } from "../../../src/providers/proton/mappers.ts";
import { formatNotice } from "../../../src/providers/proton/format.ts";
import { md5, ProtonError, type ProtonApi } from "./api.ts";
import { watchControlResults, type ControlResult } from "./mqtt.ts";
import { bindPushDevice, registerPushDevice } from "./push-device.ts";

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

/** Command id → Atlas `serviceKey` (acosdk RvcKtxKt.toRequest) and its capability family. */
const CONTROLS: Record<string, { family: string; build: (p: Params) => ControlRequest }> = {
  lock: { family: "RDU", build: () => ({ serviceKey: "RDL-OFF" }) },
  unlock: { family: "RDU", build: () => ({ serviceKey: "RDU-ON" }) },
  climate_on: { family: "RCE", build: (p) => ({ serviceKey: "RCE-ON", parameters: [{ key: "rce.temp", stringVal: String(p.temp ?? 22) }] }) },
  climate_off: { family: "RCE", build: () => ({ serviceKey: "RCE-OFF" }) },
  horn_lights: { family: "RHL", build: () => ({ serviceKey: "RHL-HornAndLight" }) },
  lights: { family: "RHL", build: () => ({ serviceKey: "RHL-LIGHT" }) },
  windows_close: { family: "RWS", build: () => ({ serviceKey: "RWS-OFF" }) },
  windows_open: { family: "RWS", build: () => ({ serviceKey: "RWS-ON" }) },
  sunroof_close: { family: "RWS", build: () => ({ serviceKey: "RWS-SunroofOFF" }) },
  // Unlocks the boot latch; it doesn't pop the boot open.
  trunk_open: { family: "RDU", build: () => ({ serviceKey: "RDU-TargetON" }) },
  trunk_lock: { family: "RDU", build: () => ({ serviceKey: "RDU-TargetOFF" }) },
  // Minutes, as Proton Link's engine dialog sends them.
  engine_start: { family: "RES", build: (p) => ({ serviceKey: "RES-Engine-ON", duration: Number(p.minutes ?? 10) }) },
  engine_stop: { family: "RES", build: () => ({ serviceKey: "RES-Engine-OFF" }) },
  defrost_on: { family: "RCE", build: () => ({ serviceKey: "RCE-DefrostON" }) },
  charge_start: { family: "RCS", build: () => ({ serviceKey: "RCS-ChargingStart" }) },
  charge_stop: { family: "RCS", build: () => ({ serviceKey: "RCS-ChargingStop" }) },
};

// Keyed by EXECUTION_FAIL code.
const CAR_REFUSALS: Record<string, string> = {
  // The car allows only a few remote starts until it has been driven.
  "2048": "Remote start limit reached. Drive the car once, then try again.",
};

type CapabilityNode = { itemCode?: string; child?: CapabilityNode[] };

/** Capability item codes look like `A001X001Y010-RDU`; the suffix is the service family. */
function families(tree: CapabilityNode[]) {
  const out = new Set<string>();
  const walk = (nodes?: CapabilityNode[]) =>
    nodes?.forEach((n) => {
      const fam = n.itemCode?.split("-")[1];
      if (fam) out.add(fam);
      walk(n.child);
    });
  walk(tree);
  return out;
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

export function createClient(api: ProtonApi, dataDir: string) {
  const infoByVin = new Map<string, AtlasVehicleInfo>();

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
      const fams = families((await api.atlas<CapabilityNode[]>(`basic/ability/vehicle/${encodeURIComponent(vin)}`)) ?? []);
      if (fams.size === 0) return undefined;
      return Object.entries(CONTROLS)
        .filter(([, c]) => fams.has(c.family))
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
          return { ...mapVehicle(v, imageUrl), commands, color, plate: v.customPlateNo || v.plateNo || undefined };
        }),
      );
      return vehicles.sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault));
    },

    async getStatus(vin: string) {
      const s = (await api.atlas<AtlasVehicleStatus>("iot/function/getVehicleStatus", { method: "POST", body: { vin } })) ?? {};
      const at = coord(s.latitude, s.longitude);
      return { ...mapStatus(s), location: at ? { ...at, updatedAt: typeof s.updateTime === "number" ? s.updateTime : undefined } : null };
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
      const list = await api.atlas<AtlasTrip[]>("bigdata/vehicle/trip/queryList/app/v1", {
        method: "POST",
        body: { startTime: end - days * 86_400_000, endTime: end, vin, isPage: true, currentPage: 1, pageSize: 50 },
      });
      return (list ?? []).map(mapTrip).filter((t) => t !== null);
    },

    async getTripTrack(vin: string, startTime: number, endTime: number) {
      const points = await api.atlas<{ latitude?: string; longitude?: string }[]>("bigdata/vehicle/trip/queryTrackList/app/v1", {
        method: "POST",
        body: { startTime, endTime, currentPage: 0, pageSize: 1000, vin },
      });
      return (points ?? []).map((p) => coord(p.latitude, p.longitude)).filter((c) => !!c);
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
