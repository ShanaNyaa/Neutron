import { createCipheriv } from "node:crypto";

import { APP_VERSION, DEVICE, type ProtonApi, type ProtonEnv } from "./api.ts";

/**
 * Node port of src/providers/proton/push-device.ts. Proton only delivers MQTT messages to
 * server-issued device ids, so we register one (generateDeviceId) and bind it to the account
 * (integrated/replenish). The upload header is AES/ECB/PKCS5 with key = appSecret + seconds.
 */
const APP_SECRET: Record<ProtonEnv, string> = {
  prod: "eG[llZO)N0vw2+,%A&6KHX",
  uat: "KrRn@{dn#%&BdOvi@!=9$@",
  qa: "KrRn@{dn#%&BdOvi@!=9$@",
};

export function encryptUpload(env: ProtonEnv, content: string, timestamp = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(APP_SECRET[env] + timestamp, "utf8");
  if (![16, 24, 32].includes(key.length)) throw new Error(`AES key is ${key.length} bytes`);
  const cipher = createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
  const encrypted = Buffer.concat([cipher.update(content, "utf8"), cipher.final()]);
  // Android Base64 URL_SAFE | NO_WRAP | NO_PADDING.
  return `timestamp=${timestamp};value=${encrypted.toString("base64url")}`;
}

function deviceInfo(installId: string) {
  return {
    appVersion: APP_VERSION.name,
    appVersionCode: Number(APP_VERSION.code),
    deviceSystem: "Android",
    deviceBrand: DEVICE.brand,
    deviceModel: DEVICE.model,
    deviceSystemVersion: DEVICE.osVersion,
    uniquelyId: installId.slice(0, 16),
    installId,
    channel: "FCM",
  };
}

// Proton answers rapid repeats with "trigger frequency control".
const RETRY_AFTER_MS = 10 * 60_000;
let lastFailure = 0;

export async function registerPushDevice(api: ProtonApi): Promise<string | null> {
  if (Date.now() - lastFailure < RETRY_AFTER_MS) return null;
  try {
    const res = await api.atlas<Record<string, string> | null>("information/mobileSync/generateDeviceId", {
      headers: { "X-UPLOAD-ID": encryptUpload(api.env, JSON.stringify(deviceInfo(api.deviceId))), "X-AGENT-TYPE": "Android" },
      noAuth: true,
    });
    const deviceId = res?.deviceId ?? Object.values(res ?? {}).find((x) => typeof x === "string" && x.length >= 16);
    if (!deviceId) throw new Error(`no device id in ${JSON.stringify(res)}`);
    console.log(`[push] Push device id issued: ${deviceId}`);
    await bindPushDevice(api, deviceId);
    return deviceId;
  } catch (e) {
    lastFailure = Date.now();
    console.warn(`[push] Push device registration failed: ${(e as Error).message}`);
    return null;
  }
}

/** A binding can lapse, leaving MQTT connected but silent, so this runs before each command. */
export async function bindPushDevice(api: ProtonApi, deviceId: string) {
  await api
    .atlas("information/mobileSync/integrated/replenish", { method: "POST", body: { deviceId, uniquelyId: api.deviceId.slice(0, 16) } })
    // "duplicate deviceId reported" means it's already bound to this account, which is fine.
    .catch((e) => !/duplicate/i.test((e as Error).message) && console.warn(`[push] Binding the push device failed: ${(e as Error).message}`));
}
