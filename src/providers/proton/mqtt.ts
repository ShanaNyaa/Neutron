import { Buffer } from "buffer";
import { NativeModules, TurboModuleRegistry } from "react-native";

import { log, logError, logWarn } from "@/lib/log";
import type { ProtonEnv } from "@/providers/proton/api";

/**
 * Proton pushes the car's result for a remote command over MQTT (docs/proton-integration.md,
 * "Remote commands"); the HTTP control call only confirms it was queued. It also pushes inbox
 * messages there. MQTT 3.1.1 client: subscribe before sending, wait for the message whose
 * `taskId` is the `requestId`; the connection closes once nobody is listening.
 *
 * TLS: the broker presents EMQX's default self-signed certificate (CN=Server), whose key is
 * public, so it can't truly authenticate the server. We pin that leaf certificate
 * (react-native-tcp-socket compares it byte for byte) instead of disabling checks as the
 * Proton app does. Only command results travel here; commands go over HTTPS.
 */
const BROKERS: Record<ProtonEnv, { host: string; port: number }> = {
  prod: { host: "prodinfomq-atlas.acotech.my", port: 55883 },
  uat: { host: "uatinfomq-atlas.acotech.my", port: 61883 },
  qa: { host: "qainfomq-atlas.acotech.my", port: 45883 },
};
// Proton Link's MQTT credentials (username = app name, password = the app's mqPassword).
const USERNAME = "Proton Link";
const PASSWORD: Record<ProtonEnv, string> = {
  prod: "Y7ZlUtuG)YDiNMF_BzjpnpCb[VtH#Tf[",
  uat: '8u8yK"bc,].a3l\'>w?e;@_A%.vKWh}?6',
  qa: '8u8yK"bc,].a3l\'>w?e;@_A%.vKWh}?6',
};

export type ControlResult = { isOk: boolean; code?: number | string; message?: string };

export type ResultWatch = {
  /** `onDelivered` fires on ISSUED_SUCCESS: the command reached the car but hasn't run yet. */
  waitFor(requestId: string, timeoutMs: number, onDelivered?: () => void): Promise<ControlResult | null>;
  close(): void;
};

// Looked up per command, not at import: in bridgeless mode legacy modules aren't registered
// yet at app start, so an import-time check reports "unavailable" for the whole session.
type Libs = {
  TcpSocket: typeof import("react-native-tcp-socket").default;
  mqtt: typeof import("mqtt-packet");
  cert: unknown;
};
let libs: Libs | null = null;
function loadLibs(): Libs | null {
  if (libs) return libs;
  const find = () => NativeModules.TcpSockets ?? TurboModuleRegistry.get("TcpSockets");
  // A legacy module can come back empty on its first lookup (that lookup starts creating
  // it) and present on the next, so look twice before giving up.
  const first = find();
  const found = first ?? find();
  if (!found) return null;
  log("push", `TCP socket module found${first ? "" : " on the second lookup"}`);
  /* eslint-disable @typescript-eslint/no-require-imports */
  libs = {
    // Plain CommonJS (module.exports = { connectTLS, ... }), despite its typings' default export.
    TcpSocket: (() => {
      const m = require("react-native-tcp-socket");
      return (m.default ?? m) as typeof import("react-native-tcp-socket").default;
    })(),
    mqtt: require("mqtt-packet") as typeof import("mqtt-packet"),
    cert: require("./mqtt-server.pem"),
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  return libs;
}

type Payload = Buffer | string;

/**
 * One connection per device id, shared by everyone listening: the broker allows a client id
 * only once, so a second connection would kick the first (e.g. a command's result watch).
 */
type Connection = {
  /** False once it has closed; the caller then opens a new one. */
  retain(): boolean;
  onPublish(listener: (payload: Payload) => void): () => void;
  onClose(listener: () => void): () => void;
  release(): void;
};
const connections = new Map<string, Promise<Connection | null>>();

function acquire(env: ProtonEnv, deviceId: string): Promise<Connection | null> {
  const key = `${env}:${deviceId}`;
  let pending = connections.get(key);
  if (!pending) {
    const attempt: Promise<Connection | null> = connect(env, deviceId, () => forget());
    // Only forgets this attempt, not a newer connection under the same key.
    const forget = () => connections.get(key) === attempt && connections.delete(key);
    connections.set(key, attempt);
    // A failed attempt isn't cached: the next caller tries again.
    attempt.then((c) => !c && forget());
    pending = attempt;
  }
  return pending.then((c) => {
    if (c?.retain()) return c;
    // Closed between lookups: start over with a fresh connection.
    if (c) return acquire(env, deviceId);
    return null;
  });
}

/** Resolves once subscribed, so a fast reply isn't missed; null when MQTT isn't available. */
export async function watchControlResults(env: ProtonEnv, deviceId: string): Promise<ResultWatch | null> {
  const conn = await acquire(env, deviceId);
  if (!conn) return null;
  // By task id; a result can arrive before waitFor is called.
  const results = new Map<string, ControlResult>();
  const waiters = new Map<string, (r: ControlResult) => void>();
  const delivered = new Set<string>();
  const deliveryListeners = new Map<string, () => void>();
  const off = conn.onPublish((payload) => {
    const parsed = parseControlResult(payload);
    if (!parsed) return;
    if ("delivered" in parsed) {
      log("push", `${parsed.taskId} reached the car`);
      delivered.add(parsed.taskId);
      deliveryListeners.get(parsed.taskId)?.();
      deliveryListeners.delete(parsed.taskId);
      return;
    }
    const result = parsed;
    log("push", `Result for ${result.taskId}: ${result.result.isOk ? "executed" : `failed${result.result.message ? `, ${result.result.message}` : ""}`}`, result.result, result.result.isOk ? "info" : "error");
    results.set(result.taskId, result.result);
    waiters.get(result.taskId)?.(result.result);
  });
  return {
    waitFor(requestId, timeoutMs, onDelivered) {
      if (onDelivered) {
        if (delivered.has(requestId)) onDelivered();
        else deliveryListeners.set(requestId, onDelivered);
      }
      const ready = results.get(requestId);
      if (ready) return Promise.resolve(ready);
      return new Promise((done) => {
        const timer = setTimeout(() => {
          logWarn("push", `No result for ${requestId} within ${Math.round(timeoutMs / 1000)} s`);
          waiters.delete(requestId);
          done(null);
        }, timeoutMs);
        waiters.set(requestId, (r) => {
          clearTimeout(timer);
          waiters.delete(requestId);
          done(r);
        });
      });
    },
    close() {
      off();
      conn.release();
    },
  };
}

/**
 * Calls `onPush` for every message that isn't a command result (inbox messages, alerts) until
 * the returned function is called. `onClose` fires if the connection drops; null when MQTT
 * isn't available.
 */
export async function watchPushes(env: ProtonEnv, deviceId: string, onPush: () => void, onClose: () => void): Promise<(() => void) | null> {
  const conn = await acquire(env, deviceId);
  if (!conn) return null;
  const offPublish = conn.onPublish((payload) => {
    if (!parseControlResult(payload)) onPush();
  });
  const offClose = conn.onClose(onClose);
  return () => {
    offPublish();
    offClose();
    conn.release();
  };
}

function connect(env: ProtonEnv, deviceId: string, forget: () => void): Promise<Connection | null> {
  const loaded = loadLibs();
  if (!loaded) {
    // Tells "not in this build" apart from "built in but not visible to JS" (interop layer).
    logWarn("push", "MQTT unavailable in this build (no TCP socket module); results will show as queued", {
      nativeModules: !!NativeModules.TcpSockets,
      turboModuleRegistry: !!TurboModuleRegistry.get("TcpSockets"),
      bridgeless: !!(globalThis as { RN$Bridgeless?: boolean }).RN$Bridgeless,
    });
    return Promise.resolve(null);
  }
  const { TcpSocket, mqtt, cert: SERVER_CERT } = loaded;
  const { host, port } = BROKERS[env];
  log("push", `Connecting to ${host}:${port}`);

  return new Promise((resolve) => {
    try {
      open(resolve);
    } catch (e) {
      logError("push", `Couldn’t open the connection: ${(e as Error)?.message ?? String(e)}`, e);
      resolve(null);
    }
  });

  function open(resolve: (c: Connection | null) => void) {
    const parser = mqtt.parser({ protocolVersion: 4 });
    const publishListeners = new Set<(payload: Payload) => void>();
    const closeListeners = new Set<() => void>();
    let refs = 0;
    let closed = false;
    let ping: ReturnType<typeof setInterval> | undefined;
    let settled = false;

    const socket = TcpSocket.connectTLS({ host, port, ca: SERVER_CERT }, () => {
      log("push", "TLS connected (pinned certificate matched)");
      send({
        cmd: "connect",
        protocolId: "MQTT",
        protocolVersion: 4,
        clean: true,
        clientId: deviceId,
        keepalive: 60,
        username: USERNAME,
        password: Buffer.from(PASSWORD[env]),
      });
    });

    const send = (packet: Parameters<typeof mqtt.generate>[0]) => {
      try {
        socket.write(mqtt.generate(packet));
      } catch {
        // socket already gone
      }
    };

    const shutDown = () => {
      if (closed) return;
      closed = true;
      forget();
      if (ping) clearInterval(ping);
      closeListeners.forEach((l) => l());
    };

    const close = () => {
      log("push", "Disconnecting");
      shutDown();
      send({ cmd: "disconnect" });
      socket.destroy();
    };

    const fail = (reason: string) => {
      if (settled) return;
      logError("push", `Connection failed: ${reason}`);
      settled = true;
      close();
      resolve(null);
    };
    const connectTimer = setTimeout(() => fail("no answer within 8 s"), 8000);

    socket.on("data", (data) => parser.parse(Buffer.from(data as Uint8Array)));
    socket.on("error", (e) => {
      if (!settled) fail((e as Error)?.message ?? "socket error");
      else logError("push", `Socket error: ${(e as Error)?.message ?? "unknown"}`);
    });
    socket.on("close", () => {
      if (!settled) return fail("socket closed");
      log("push", "Socket closed");
      shutDown();
    });

    parser.on("error", (e) => logError("push", `Couldn’t parse a packet: ${e.message}`));
    parser.on("packet", (packet) => {
      switch (packet.cmd) {
        case "connack":
          log("push", `CONNACK return code ${packet.returnCode ?? packet.reasonCode}`, packet);
          if (packet.returnCode !== 0 && packet.reasonCode !== 0) return fail(`broker refused (code ${packet.returnCode ?? packet.reasonCode})`);
          send({
            cmd: "subscribe",
            messageId: 1,
            subscriptions: [
              { topic: `mobile/${deviceId}/message`, qos: 1 },
              { topic: `mobile/${deviceId}/notify`, qos: 1 },
            ],
          });
          return;
        case "suback":
          log("push", `Subscribed to mobile/${deviceId}/message and /notify`, { granted: packet.granted });
          clearTimeout(connectTimer);
          ping = setInterval(() => send({ cmd: "pingreq" }), 45_000);
          if (!settled) {
            settled = true;
            resolve({
              retain: () => {
                if (closed) return false;
                refs++;
                return true;
              },
              release: () => {
                if (--refs <= 0 && !closed) close();
              },
              onPublish: (l) => {
                publishListeners.add(l);
                return () => publishListeners.delete(l);
              },
              onClose: (l) => {
                closeListeners.add(l);
                return () => closeListeners.delete(l);
              },
            });
          }
          return;
        case "pingresp":
          return;
        case "publish":
          // Logged in full to learn Proton's message shapes; the app's receipt code didn't decompile.
          log("push", `Message on ${packet.topic} (QoS ${packet.qos}${packet.dup ? ", duplicate" : ""})`, packet.payload.toString());
          if (packet.qos === 1 && packet.messageId != null) send({ cmd: "puback", messageId: packet.messageId });
          publishListeners.forEach((l) => l(packet.payload));
          return;
      }
    });
  }
}

/**
 * A push is `{messageCategory, content, ...}`; for commands, `content` (an object, or a
 * JSON string) is `{taskId, serviceResult, code, message, body, ...}`.
 */
function parseControlResult(
  payload: Payload,
): { taskId: string; result: ControlResult } | { taskId: string; delivered: true } | null {
  try {
    const msg = JSON.parse(payload.toString());
    const raw = typeof msg?.content === "string" ? JSON.parse(msg.content) : msg?.content;
    if (!raw?.taskId) return null;
    if (msg.messageCategory && msg.messageCategory !== "VEHICLE_CONTROL") return null;
    const outcome = String(raw.serviceResult ?? "");
    // ISSUED_SUCCESS: handed to the car's modem (Proton Link's "SentToTBox"); not the result yet.
    if (outcome === "ISSUED_SUCCESS") return { taskId: String(raw.taskId), delivered: true };
    if (outcome === "EXECUTION_SUCCESS") return { taskId: String(raw.taskId), result: { isOk: true, code: raw.code } };
    if (outcome === "EXECUTION_FAIL") {
      return {
        taskId: String(raw.taskId),
        result: { isOk: false, code: raw.code, message: raw.body || raw.message || undefined },
      };
    }
    return null;
  } catch {
    return null;
  }
}
