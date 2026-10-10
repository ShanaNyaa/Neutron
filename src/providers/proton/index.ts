import { ProviderError, type ProviderDefinition } from "@/core/provider";
import type { CommandDefinition, CommandId, Coordinate, Notice, Vehicle } from "@/core/types";
import { login, md5, newDeviceId, normalizeMsisdn, ProtonApi, type ProtonEnv, type ProtonSession } from "@/providers/proton/api";
import { getItem, removeItem, setItem } from "@/core/secure-kv";
import { formatNotice, formatPhone } from "@/providers/proton/format";
import { buildScene } from "@/providers/proton/imagery";
import { watchControlResults, watchPushes, type ControlResult } from "@/providers/proton/mqtt";
import { bindPushDevice, registerPushDevice } from "@/providers/proton/push-device";
import { log, logError } from "@/lib/log";
import { coord, mapStatus, mapTrip, mapVehicle, type AtlasTrip, type AtlasVehicleInfo, type AtlasVehicleStatus } from "@/providers/proton/mappers";

type ControlRequest = {
  serviceKey: string;
  vin?: string;
  duration?: number | null;
  parameters?: { key: string; stringVal?: string; intVal?: number }[] | null;
};

/** Our command ids → Atlas `serviceKey` (acosdk RvcKtxKt.toRequest) + capability family. */
const CONTROLS: Record<string, { family: string; build: (p: Record<string, string | number>) => ControlRequest }> = {
  lock: { family: "RDU", build: () => ({ serviceKey: "RDL-OFF" }) },
  unlock: { family: "RDU", build: () => ({ serviceKey: "RDU-ON" }) },
  climate_on: {
    family: "RCE",
    build: (p) => ({ serviceKey: "RCE-ON", parameters: [{ key: "rce.temp", stringVal: String(p.temp ?? 22) }] }),
  },
  climate_off: { family: "RCE", build: () => ({ serviceKey: "RCE-OFF" }) },
  horn_lights: { family: "RHL", build: () => ({ serviceKey: "RHL-HornAndLight" }) },
  lights: { family: "RHL", build: () => ({ serviceKey: "RHL-LIGHT" }) },
  windows_close: { family: "RWS", build: () => ({ serviceKey: "RWS-OFF" }) },
  windows_open: { family: "RWS", build: () => ({ serviceKey: "RWS-ON" }) },
  sunroof_close: { family: "RWS", build: () => ({ serviceKey: "RWS-SunroofOFF" }) },
  // RDU unlocks/locks the trunk latch; it doesn't pop the trunk open.
  trunk_open: { family: "RDU", build: () => ({ serviceKey: "RDU-TargetON" }) },
  trunk_lock: { family: "RDU", build: () => ({ serviceKey: "RDU-TargetOFF" }) },
  // Duration is in minutes (the app's engine dialog passes minutes straight through).
  engine_start: { family: "RES", build: (p) => ({ serviceKey: "RES-Engine-ON", duration: Number(p.minutes ?? 10) }) },
  engine_stop: { family: "RES", build: () => ({ serviceKey: "RES-Engine-OFF" }) },
  defrost_on: { family: "RCE", build: () => ({ serviceKey: "RCE-DefrostON" }) },
  charge_start: { family: "RCS", build: () => ({ serviceKey: "RCS-ChargingStart" }) },
  charge_stop: { family: "RCS", build: () => ({ serviceKey: "RCS-ChargingStop" }) },
};

const commands: CommandDefinition[] = [
  { id: "lock", label: "Lock", icon: "lock-closed" },
  { id: "unlock", label: "Unlock", icon: "lock-open" },
  {
    id: "climate_on",
    label: "Climate",
    icon: "snow",
    params: [{ key: "temp", label: "Temperature", type: "number", min: 16, max: 32, step: 0.5, default: 22, unit: "°C" }],
  },
  { id: "climate_off", label: "Climate Off", icon: "power" },
  { id: "horn_lights", label: "Honk and Flash", icon: "megaphone" },
  { id: "lights", label: "Flash Lights", icon: "flashlight" },
  { id: "windows_close", label: "Close Windows", icon: "contract" },
  { id: "windows_open", label: "Open Windows", icon: "expand" },
  { id: "sunroof_close", label: "Close Sunroof", icon: "sunny" },
  { id: "trunk_open", label: "Unlock Trunk", icon: "car" },
  { id: "trunk_lock", label: "Lock Trunk", icon: "car" },
  {
    id: "engine_start",
    label: "Start Engine",
    icon: "flame",
    params: [
      {
        key: "minutes",
        label: "Run for",
        type: "choice",
        default: 10,
        // Proton Link's EngineDialog choices; the car may refuse other durations.
        options: [3, 5, 8, 10].map((m) => ({ label: `${m} min`, value: m })),
      },
    ],
    timer: { defaultMinutes: 10, running: "The engine is running. It will be switched off automatically.", ended: "Engine off", stoppedBy: "engine_stop", isRunning: (s) => s.isEngineOn },
  },
  { id: "engine_stop", label: "Stop Engine", icon: "stop-circle", isDestructive: true },
  { id: "defrost_on", label: "Defrost", icon: "thermometer" },
  { id: "charge_start", label: "Start Charging", icon: "flash" },
  { id: "charge_stop", label: "Stop Charging", icon: "flash-off" },
];

type CapabilityNode = { itemCode?: string; child?: CapabilityNode[] };

/** Capability item codes look like `A001X001Y010-RDU`; the suffix is the service family. */
function families(tree: CapabilityNode[]): Set<string> {
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

/**
 * Fallback for inbox messages without businessData. Success words win: successes can read
 * like warnings ("Remote engine started. Please use the vehicle in time.").
 */
function inboxSucceeded(text: string) {
  if (/success|succeeded|started|completed|executed|turned on|is on\b/i.test(text)) return true;
  return !/fail|unable|cannot|can't|limit reached|exceed|error|timed? ?out|rejected|not (?:been )?(?:executed|completed|started|possible)/i.test(text);
}

// Keyed by EXECUTION_FAIL code.
const CAR_REFUSALS: Record<string, string> = {
  // The car allows only a few remote starts until it has been driven.
  "2048": "Remote start limit reached. Drive the car once, then try again.",
};
function carRefusal(code: string | number | undefined, message: string | undefined) {
  return CAR_REFUSALS[String(code)] ?? message ?? "The car couldn’t do that";
}

export const protonProvider: ProviderDefinition = {
  id: "proton",
  name: "Proton Link 2.0",
  description: "X50, X70, X90, S70, e.MAS and more. Sign in with your Proton Link phone number.",
  color: "#1f6feb",
  icon: "car-sport",
  logo: require("../../../assets/proton.png"),
  // The PNG's mark covers about 70% of its canvas.
  logoScale: 1.25,
  capabilities: ["status", "location", "commands", "trips", "notices", "imagery"],
  commands,
  credentialFields: [
    {
      key: "mobilePhone",
      label: "Mobile number",
      type: "phone",
      placeholder: "Mobile number",
      help: "Your Malaysian number. The +60 is added for you.",
    },
    { key: "password", label: "Password", type: "password", placeholder: "Password" },
  ],

  async signIn(values) {
    const env: ProtonEnv = "prod";
    const deviceId = newDeviceId();
    const res = await login(env, values.mobilePhone.trim(), values.password, deviceId);
    const session: ProtonSession = {
      userId: res.userId,
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      deviceId,
      env,
      signedInAt: Date.now(),
    };
    return { type: "success", session, accountLabel: formatPhone("+" + normalizeMsisdn(values.mobilePhone)) };
  },

  createClient({ session, saveSession }) {
    if (!session) throw new ProviderError("Not signed in", undefined, true);
    const api = new ProtonApi(session as ProtonSession, saveSession);
    const infoByVin = new Map<string, AtlasVehicleInfo>();
    const recent = new Map<string, { at: number; promise: Promise<AtlasVehicleStatus> }>();

    const imageFor = async (v: AtlasVehicleInfo) => {
      if (!v.matCode || !v.modelCode || !v.bodyColorCode) return undefined;
      try {
        const res = await api.atlas<{ fileUrls?: { url?: string }[] }>("basic/mat/model/bodyPictureList", {
          method: "POST",
          body: { matCode: v.matCode, modelCode: v.modelCode, bodyColorCode: v.bodyColorCode, topColorCode: v.topColorCode ?? null },
        });
        return res?.fileUrls?.find((f) => f.url)?.url;
      } catch {
        return undefined;
      }
    };

    type BodyColor = { bodyColorCode?: string; bodyColorName?: string; bodyColorIcon?: string; topColorCodes?: { topColorCode?: string }[] };
    const catalogues = new Map<string, Promise<BodyColor[]>>();
    const catalogue = (v: AtlasVehicleInfo) => {
      if (!v.matCode || !v.modelCode) return Promise.resolve<BodyColor[]>([]);
      const key = `${v.matCode}:${v.modelCode}`;
      if (!catalogues.has(key)) {
        catalogues.set(
          key,
          api
            .atlas<{ bodyColors?: BodyColor[] }>("basic/mat/colorModelDetailList", {
              method: "POST",
              body: { matCode: v.matCode, modelCode: v.modelCode },
            })
            .then((r) => r?.bodyColors ?? [])
            // Don't cache a failure as "no colours": drop it so the next call retries.
            .catch(() => {
              catalogues.delete(key);
              return [];
            }),
        );
      }
      return catalogues.get(key)!;
    };
    const paintFor = async (v: AtlasVehicleInfo) =>
      v.bodyColorCode ? (await catalogue(v)).find((c) => c.bodyColorCode === v.bodyColorCode)?.bodyColorName : undefined;

    const factoryByVin = new Map<string, AtlasVehicleInfo>();
    // Renders are per body + roof colour, so take the roof code that goes with the paint.
    const withPaint = async (factory: AtlasVehicleInfo, code: string): Promise<AtlasVehicleInfo> => {
      const entry = (await catalogue(factory)).find((c) => c.bodyColorCode === code);
      return { ...factory, bodyColorCode: code, topColorCode: entry?.topColorCodes?.[0]?.topColorCode ?? factory.topColorCode };
    };

    // Local-only paint override per VIN; empty means the factory paint.
    const paintKey = (vin: string) => `proton.paint.${vin}`;
    const paintOverrides = new Map<string, string | null>();
    const paintOverride = async (vin: string) => {
      if (!paintOverrides.has(vin)) paintOverrides.set(vin, (await getItem(paintKey(vin)).catch(() => null)) || null);
      return paintOverrides.get(vin) ?? null;
    };

    const loadInfos = async () => {
      const list = (await api.atlas<AtlasVehicleInfo[]>("basic/user/vehicle/list")) ?? [];
      return Promise.all(
        list.map(async (factory) => {
          const override = await paintOverride(factory.vin);
          factoryByVin.set(factory.vin, factory);
          const v = override ? await withPaint(factory, override) : factory;
          infoByVin.set(v.vin, v);
          return { factory, v };
        }),
      );
    };
    // On launch vehicles come from the local store, so listVehicles may not have run yet.
    const infoFor = async (vin: string) => {
      if (!infoByVin.has(vin)) await loadInfos();
      return infoByVin.get(vin);
    };

    /**
     * Proton also files each command's outcome as a vehicle-control inbox message. Await
     * `ready` before sending: it snapshots existing messages so only new ones count (their
     * timestamps aren't reliably in the phone's time zone).
     */
    const inboxResult = (deadline: number) => {
      let stopped = false;
      // The command's requestId; businessData.taskId matches it.
      let taskId: string | undefined;
      type Msg = { id?: string; messageTitle?: string; messageContent?: string; createTimeInt?: number; businessData?: string; templatesCategoryCode?: string };
      const fetchLatest = (labels: string[]) =>
        api.atlas<Msg[]>("information/mobileLog/queryPageList", { query: { labelIdList: labels, currentPage: 1, pageSize: 10 } }).catch(() => null);
      const keyOf = (m: Msg) => m.id ?? `${m.createTimeInt}:${m.messageContent}`;
      const setup = (async () => {
        const labels = ((await api.atlas<{ labelId?: string }[]>("information/mobileLog/queryLabelList").catch(() => null)) ?? [])
          .map((l) => l.labelId)
          .filter((id): id is string => !!id);
        const seen = new Set((labels.length ? ((await fetchLatest(labels)) ?? []) : []).map(keyOf));
        return { labels, seen };
      })();
      const promise = (async (): Promise<ControlResult | null> => {
        const { labels, seen } = await setup;
        if (!labels.length) return null;
        while (!stopped && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 5_000));
          if (stopped) return null;
          for (const m of (await fetchLatest(labels)) ?? []) {
            if (seen.has(keyOf(m)) || !/vehicle\s*control|remote|control/i.test(`${m.messageTitle} ${m.templatesCategoryCode}`)) continue;
            // businessData is the same result MQTT carries: {taskId, serviceResult, code, ...}.
            let data: { taskId?: string; serviceResult?: string; code?: string | number } | undefined;
            try {
              data = m.businessData ? JSON.parse(m.businessData) : undefined;
            } catch {}
            if (data?.taskId && taskId && data.taskId !== taskId) continue;
            // ISSUED_SUCCESS: reached the modem, not the outcome yet.
            if (data?.serviceResult === "ISSUED_SUCCESS") continue;
            log("command", "Result from the inbox", m);
            const text = m.messageContent?.trim() ?? "";
            const ok =
              data?.serviceResult === "EXECUTION_SUCCESS" ? true : data?.serviceResult === "EXECUTION_FAIL" ? false : inboxSucceeded(text);
            return { isOk: ok, code: data?.code, message: text || undefined };
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

    const supported = async (vin: string): Promise<CommandId[] | undefined> => {
      try {
        const tree = await api.atlas<CapabilityNode[]>(`basic/ability/vehicle/${encodeURIComponent(vin)}`);
        const fams = families(tree ?? []);
        if (fams.size === 0) return undefined;
        return Object.entries(CONTROLS)
          .filter(([, c]) => fams.has(c.family))
          .map(([id]) => id);
      } catch {
        return undefined; // show everything if the capability tree is unavailable
      }
    };

    const pinKey = `proton.pin.${api.userId}`;
    const forgetPin = async () => {
      await removeItem(pinKey).catch(() => {});
      await removeItem(`proton.pinSaved.${api.userId}`).catch(() => {});
    };

    // Proton only routes MQTT messages to server-issued push device ids.
    const pushDeviceId = async () => {
      let pushId = api.pushDeviceId;
      if (!pushId) {
        pushId = (await registerPushDevice(api, api.env)) ?? undefined;
        if (pushId) await api.setPushDeviceId(pushId);
      } else {
        await bindPushDevice(api, pushId);
      }
      return pushId ?? api.deviceId;
    };

    const status = (v: Vehicle) => {
      const hit = recent.get(v.vin!);
      if (hit && Date.now() - hit.at < 5_000) return hit.promise;
      const promise = api
        .atlas<AtlasVehicleStatus>("iot/function/getVehicleStatus", { method: "POST", body: { vin: v.vin } })
        .then((s) => s ?? {});
      promise.catch(() => recent.delete(v.vin!));
      recent.set(v.vin!, { at: Date.now(), promise });
      return promise;
    };

    return {
      async listVehicles() {
        const infos = await loadInfos();
        const vehicles = await Promise.all(
          infos.map(async ({ factory, v }) => {
            const [img, cmds, paint] = await Promise.all([imageFor(v), supported(v.vin), paintFor(v)]);
            return {
              ...mapVehicle(v, img),
              commands: cmds,
              color: paint,
              paintCode: v.bodyColorCode,
              factoryPaintCode: factory.bodyColorCode,
            };
          }),
        );
        return vehicles.sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault));
      },

      async getStatus(v) {
        return mapStatus(await status(v));
      },

      async getLocation(v) {
        // getVehiclePosition is async (MQTT); the last known fix is part of the status payload.
        const s = await status(v);
        const latitude = Number(s.latitude);
        const longitude = Number(s.longitude);
        if (!s.latitude || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        return {
          latitude,
          longitude,
          updatedAt: typeof s.updateTime === "number" ? s.updateTime : undefined,
        };
      },

      async sendCommand(v, command, { pin, params, onProgress }) {
        const control = CONTROLS[command];
        if (!control) throw new ProviderError(`Unsupported command ${command}`);
        const pinRequired = (await infoFor(v.vin!).catch(() => undefined))?.enablePin ?? v.isPinRequired;
        if (pinRequired) {
          // The PIN is checked separately before each command; it's never part of the control body.
          if (!pin) throw new ProviderError("Enter your vehicle PIN");
          // Proton Link sends md5(md5(pin) + userId) with type VEHICLE_CONTROL.
          const pinCode = await md5((await md5(pin)) + api.userId);
          try {
            await api.atlas("basic/vehicle/checkPinCode", {
              method: "POST",
              body: { vin: v.vin, pinCode, type: "VEHICLE_CONTROL" },
            });
          } catch (e) {
            // The saved PIN is stale (changed in Proton Link).
            if (e instanceof ProviderError && !e.isReauthRequired && pin === (await getItem(pinKey).catch(() => null))) await forgetPin();
            throw e;
          }
          // Shared Keychain, for Shortcuts and Control Center (plugins/native/MottokarCore.swift).
          // The PIN is readable only while unlocked; the marker is readable while locked, so
          // they can tell "unlock your iPhone" apart from "no PIN saved".
          await setItem(pinKey, pin, { whenUnlocked: true }).catch(() => {});
          await setItem(`proton.pinSaved.${api.userId}`, "1").catch(() => {});
        }
        const req = control.build(params ?? {});
        // Listen before sending: a fast car can answer before the HTTP call returns.
        const mqttId = await pushDeviceId();
        const inbox = inboxResult(Date.now() + 45_000);
        await inbox.ready;
        const watch = await watchControlResults(api.env, mqttId).catch((e) => {
          logError("push", `MQTT setup failed: ${(e as Error)?.message ?? String(e)}`, e);
          return null;
        });
        try {
          const res = await api.atlas<{ requestId?: string }>("iot/function/vehicleControl", {
            method: "POST",
            body: { vin: v.vin, scheduledTime: null, endTime: null, duration: null, parameters: null, timerData: null, ...req },
          });
          const queued = { isOk: true, message: "Sent to your car", requestId: res?.requestId };
          onProgress?.("cloud");
          if (!res?.requestId) return queued;
          inbox.forTask(res.requestId);
          // 40 s is Proton Link's default command timeout. Race the inbox too: MQTT can be
          // connected yet silent.
          const result = await Promise.race([
            watch ? watch.waitFor(res.requestId, 40_000, () => onProgress?.("car")) : new Promise<null>(() => {}),
            inbox.promise,
          ]);
          if (!result) return queued;
          if (!result.isOk) return { isOk: false, message: carRefusal(result.code, result.message), requestId: res.requestId, isConfirmed: true };
          return { isOk: true, message: "Done", requestId: res.requestId, isConfirmed: true };
        } finally {
          watch?.close();
          inbox.stop();
        }
      },

      savedPin() {
        return getItem(pinKey).catch(() => null);
      },

      async signOut() {
        await forgetPin();
      },

      async sessionInfo() {
        return { validUntil: api.refreshExpiresAt, signedInAt: api.signedInAt };
      },

      async getDataUsage(v) {
        // Values are KB, as strings (ConditionActivity multiplies by 1024).
        const res = await api.legacy<{ residueFlow?: string; usedFlow?: string }>("app/v1/vehicle/flow", {
          query: { userId: api.userId, vin: v.vin },
        });
        const bytes = (kb?: string) => (kb && Number.isFinite(Number(kb)) ? Number(kb) * 1024 : undefined);
        const usage = { usedBytes: bytes(res?.usedFlow), remainingBytes: bytes(res?.residueFlow) };
        return usage.usedBytes == null && usage.remainingBytes == null ? null : usage;
      },

      async getPaints(v) {
        const info = await infoFor(v.vin!);
        if (!info) return [];
        const factory = factoryByVin.get(v.vin!) ?? info;
        const colors = (await catalogue(factory)).filter((c): c is BodyColor & { bodyColorCode: string } => !!c.bodyColorCode);
        // The catalogue can list paints with no renders for this model.
        const renderable = await Promise.all(
          colors.map(async (c) =>
            c.bodyColorCode === factory.bodyColorCode || c.bodyColorCode === info!.bodyColorCode
              ? true
              : !!(await imageFor(await withPaint(factory, c.bodyColorCode))),
          ),
        );
        return colors
          .filter((_, i) => renderable[i])
          .map((c) => ({ code: c.bodyColorCode, name: c.bodyColorName ?? c.bodyColorCode, swatch: c.bodyColorIcon || undefined }));
      },

      async setPaint(v, code) {
        const value = code && code !== v.factoryPaintCode ? code : null;
        paintOverrides.set(v.vin!, value);
        // So getScene uses the new paint before the vehicle list reloads.
        const factory = factoryByVin.get(v.vin!);
        if (factory) infoByVin.set(v.vin!, value ? await withPaint(factory, value) : factory);
        await setItem(paintKey(v.vin!), value ?? "");
      },

      async getScene(v) {
        const info = await infoFor(v.vin!);
        if (!info?.matCode || !info.modelCode || !info.bodyColorCode) return null;
        const scene = await buildScene(api, info);
        // A chosen paint may lack the top-down pack; fall back to the factory paint.
        const factory = factoryByVin.get(v.vin!);
        if (!scene?.angles.some((a) => a.id === "top") && factory && factory.bodyColorCode !== info.bodyColorCode) {
          return buildScene(api, factory);
        }
        return scene;
      },

      async renameVehicle(v, name) {
        await api.atlas("basic/vehicle/setVehicleName", { method: "POST", body: { vin: v.vin, vehicleName: name } });
        const info = infoByVin.get(v.vin!);
        if (info) info.vehicleName = name;
      },

      async getTrips(v) {
        const end = Date.now();
        const list = await api.atlas<AtlasTrip[]>("bigdata/vehicle/trip/queryList/app/v1", {
          method: "POST",
          body: { startTime: end - 30 * 86_400_000, endTime: end, vin: v.vin, isPage: true, currentPage: 1, pageSize: 50 },
        });
        return (list ?? []).map(mapTrip).filter((t) => t !== null);
      },

      async getTripTrack(v, trip) {
        const end = trip.endedAt ?? (trip.durationMin != null ? trip.startedAt + trip.durationMin * 60_000 : undefined);
        if (!end) return [];
        const points = await api.atlas<{ latitude?: string; longitude?: string }[]>("bigdata/vehicle/trip/queryTrackList/app/v1", {
          method: "POST",
          body: { startTime: trip.startedAt, endTime: end, currentPage: 0, pageSize: 1000, vin: v.vin },
        });
        return (points ?? []).map((p) => coord(p.latitude, p.longitude)).filter((c): c is Coordinate => !!c);
      },

      watchNotices(onChange) {
        let stopped = false;
        let close: (() => void) | null = null;
        let retry: ReturnType<typeof setTimeout> | undefined;
        const reconnect = (afterMs: number) => {
          if (!stopped) retry = setTimeout(open, afterMs);
        };
        const open = async () => {
          try {
            const off = await watchPushes(api.env, await pushDeviceId(), onChange, () => {
              close = null;
              reconnect(30_000);
            });
            if (stopped) off?.();
            else if (off) close = off;
            else reconnect(60_000);
          } catch (e) {
            logError("push", `Couldn’t watch for messages: ${(e as Error)?.message ?? String(e)}`, e);
            reconnect(60_000);
          }
        };
        open();
        return () => {
          stopped = true;
          clearTimeout(retry);
          close?.();
        };
      },

      async markNoticeRead(n) {
        await api.atlas("information/mobileLog/markReadByLogId", { method: "POST", body: { logIds: [n.id] } });
      },

      async getNotices() {
        // Not the legacy app/v1/message list: Proton Link no longer uses it and its read state
        // doesn't stick.
        type Label = { labelId?: string; labelName?: string };
        type Msg = {
          id: string;
          messageTitle?: string;
          messageContent?: string;
          createTime?: string;
          createTimeInt?: number;
          readStatus?: number;
          templateLabelId?: string;
        };
        const labels = ((await api.atlas<Label[]>("information/mobileLog/queryLabelList")) ?? []).filter((l) => l.labelId);
        if (!labels.length) return [];
        const names = new Map(labels.map((l) => [l.labelId!, l.labelName]));
        const list = await api.atlas<Msg[]>("information/mobileLog/queryPageList", {
          query: { labelIdList: labels.map((l) => l.labelId!), currentPage: 1, pageSize: 30 },
        });
        return (list ?? []).map(
          (n): Notice => ({
            id: String(n.id),
            ...formatNotice({
              title: n.messageTitle,
              body: n.messageContent,
              label: (n.templateLabelId && names.get(n.templateLabelId)) || undefined,
            }),
            createdAt: n.createTimeInt || Date.parse(String(n.createTime ?? "").replace(" ", "T")) || Date.now(),
            // Only 0 means unread.
            isRead: n.readStatus !== 0,
          }),
        );
      },
    };
  },
};
