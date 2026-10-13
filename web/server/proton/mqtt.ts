import { X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import tls from "node:tls";

import mqtt from "mqtt";

import type { ProtonEnv } from "./api.ts";

/**
 * Command results arrive over MQTT (docs/proton-integration.md, "MQTT"); the HTTP control call
 * only says the command was queued. Node version of src/providers/proton/mqtt.ts.
 *
 * TLS: the broker presents EMQX's default self-signed certificate (CN=Server). The Proton app
 * trusts anything; the mobile app pins that certificate. Here it's pinned on first use: the
 * certificate seen on the first connection is saved to the data volume and required after that.
 */
const BROKERS: Record<ProtonEnv, { host: string; port: number }> = {
  prod: { host: "prodinfomq-atlas.acotech.my", port: 55883 },
  uat: { host: "uatinfomq-atlas.acotech.my", port: 61883 },
  qa: { host: "qainfomq-atlas.acotech.my", port: 45883 },
};
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

async function brokerCert(env: ProtonEnv, dataDir: string): Promise<string> {
  const path = `${dataDir}/mqtt-${env}.pem`;
  try {
    return await readFile(path, "utf8");
  } catch {
    // first use
  }
  const { host, port } = BROKERS[env];
  const pem = await new Promise<string>((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      const raw = socket.getPeerCertificate().raw;
      socket.destroy();
      if (!raw) return reject(new Error("broker sent no certificate"));
      resolve(`-----BEGIN CERTIFICATE-----\n${raw.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`);
    });
    socket.setTimeout(8000, () => socket.destroy(new Error("timed out fetching the broker certificate")));
    socket.on("error", reject);
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, pem);
  const cert = new X509Certificate(pem);
  console.log(`[push] Pinned broker certificate ${cert.subject.replace(/\n/g, ", ")} (sha256 ${cert.fingerprint256})`);
  return pem;
}

/** Resolves once subscribed, so a fast reply isn't missed; null when MQTT isn't reachable. */
export async function watchControlResults(env: ProtonEnv, deviceId: string, dataDir: string): Promise<ResultWatch | null> {
  let ca: string;
  try {
    ca = await brokerCert(env, dataDir);
  } catch (e) {
    console.error(`[push] Couldn't get the broker certificate: ${(e as Error).message}`);
    return null;
  }
  const { host, port } = BROKERS[env];
  // mqtt.js passes TLS options through to tls.connect, but its types don't list them all.
  const options: mqtt.IClientOptions & tls.ConnectionOptions = {
    protocol: "mqtts",
    host,
    port,
    ca,
    // The pinned cert is the trust root; its CN ("Server") never matches the host name.
    checkServerIdentity: () => undefined,
    clientId: deviceId,
    username: USERNAME,
    password: PASSWORD[env],
    protocolVersion: 4,
    clean: true,
    keepalive: 60,
    reconnectPeriod: 0,
    connectTimeout: 8000,
  };
  const client = mqtt.connect(options);

  const ready = await new Promise<boolean>((resolve) => {
    client.once("connect", () => {
      client.subscribe([`mobile/${deviceId}/message`, `mobile/${deviceId}/notify`], { qos: 1 }, (err) => {
        if (err) console.error(`[push] Subscribe failed: ${err.message}`);
        else console.log(`[push] Subscribed as ${deviceId}`);
        resolve(!err);
      });
    });
    client.once("error", (e) => {
      console.error(`[push] MQTT error: ${e.message}`);
      resolve(false);
    });
    client.once("close", () => resolve(false));
  });
  if (!ready) {
    client.end(true);
    return null;
  }

  const results = new Map<string, ControlResult>();
  const waiters = new Map<string, (r: ControlResult) => void>();
  const delivered = new Set<string>();
  const deliveryListeners = new Map<string, () => void>();
  client.on("message", (topic, payload) => {
    console.log(`[push] Message on ${topic}: ${payload.toString()}`);
    const parsed = parseControlResult(payload.toString());
    if (!parsed) return;
    if ("delivered" in parsed) {
      delivered.add(parsed.taskId);
      deliveryListeners.get(parsed.taskId)?.();
      deliveryListeners.delete(parsed.taskId);
      return;
    }
    results.set(parsed.taskId, parsed.result);
    waiters.get(parsed.taskId)?.(parsed.result);
  });

  return {
    waitFor(requestId, timeoutMs, onDelivered) {
      if (onDelivered) {
        if (delivered.has(requestId)) onDelivered();
        else deliveryListeners.set(requestId, onDelivered);
      }
      const done = results.get(requestId);
      if (done) return Promise.resolve(done);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(requestId);
          resolve(null);
        }, timeoutMs);
        waiters.set(requestId, (r) => {
          clearTimeout(timer);
          waiters.delete(requestId);
          resolve(r);
        });
      });
    },
    close() {
      client.end();
    },
  };
}

/** A push is `{messageCategory, content}`; for commands `content` is `{taskId, serviceResult, code, ...}`. */
function parseControlResult(payload: string): { taskId: string; result: ControlResult } | { taskId: string; delivered: true } | null {
  try {
    const msg = JSON.parse(payload);
    const raw = typeof msg?.content === "string" ? JSON.parse(msg.content) : msg?.content;
    if (!raw?.taskId) return null;
    if (msg.messageCategory && msg.messageCategory !== "VEHICLE_CONTROL") return null;
    const taskId = String(raw.taskId);
    switch (String(raw.serviceResult ?? "")) {
      case "ISSUED_SUCCESS":
        return { taskId, delivered: true };
      case "EXECUTION_SUCCESS":
        return { taskId, result: { isOk: true, code: raw.code } };
      case "EXECUTION_FAIL":
        return { taskId, result: { isOk: false, code: raw.code, message: raw.body || raw.message || undefined } };
      default:
        return null;
    }
  } catch {
    return null;
  }
}
