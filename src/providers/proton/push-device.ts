import { Buffer } from "buffer";
import * as Crypto from "expo-crypto";

import { log, logError, logWarn } from "@/lib/log";
import { APP_VERSION, DEVICE, type ProtonApi, type ProtonEnv } from "@/providers/proton/api";

/**
 * Proton only delivers MQTT messages to server-issued device ids: an id we made up gets a
 * working MQTT connection and no messages.
 *
 * Mirrors the Proton SDK's DeviceManager (com.malaysia.acosdk.push.impl):
 *  1. GET  /information/mobileSync/generateDeviceId, header X-UPLOAD-ID = encrypted device info
 *     → ApiResult<Map<String,String>> holding the new device id.
 *  2. POST /information/mobileSync/integrated/replenish (Authorization) binds that id to the
 *     signed-in user; the SDK's coroutine names `deviceId` and `uniquelyId`.
 * Encryption (DeviceManager.encrypt): AES/ECB/PKCS5Padding, key = UTF-8(appSecret + timestamp),
 * output "timestamp=<t>;value=<base64 url-safe, no padding>". With a 22-character secret the
 * key is only a valid AES length (32 bytes) with a 10-digit timestamp, i.e. seconds.
 *
 * Parts of those methods didn't decompile, so the response key and replenish body are
 * best guesses.
 */
const APP_SECRET: Record<ProtonEnv, string> = {
  prod: "eG[llZO)N0vw2+,%A&6KHX",
  uat: "KrRn@{dn#%&BdOvi@!=9$@",
  qa: "KrRn@{dn#%&BdOvi@!=9$@",
};

// aes-js is plain JS (no native code); it's one of the few that does ECB mode.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const aesjs = require("aes-js") as {
  ModeOfOperation: { ecb: new (key: Uint8Array) => { encrypt(data: Uint8Array): Uint8Array } };
  padding: { pkcs7: { pad(data: Uint8Array): Uint8Array } };
};

export function encryptUpload(env: ProtonEnv, content: string, timestamp = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(APP_SECRET[env] + timestamp, "utf8");
  if (![16, 24, 32].includes(key.length)) throw new Error(`AES key is ${key.length} bytes`);
  // PKCS5 and PKCS7 padding are identical for AES's 16-byte blocks.
  const padded = aesjs.padding.pkcs7.pad(Buffer.from(content, "utf8"));
  const encrypted = new aesjs.ModeOfOperation.ecb(key).encrypt(padded);
  const b64 = Buffer.from(encrypted).toString("base64");
  // Android's Base64 flags 11 = URL_SAFE | NO_WRAP | NO_PADDING (standard base64 fails the signature check).
  const value = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `timestamp=${timestamp};value=${value}`;
}

/**
 * The SDK's DeviceInfo as built on a fresh install (DeviceManager.init + constructor
 * defaults). Moshi omits null fields, so mac, country, lang, fingerprint, hardware id and
 * deviceToken (we have no FCM token) are left out. Field order follows the class.
 */
function deviceInfo(installId: string) {
  return {
    appVersion: APP_VERSION.name,
    appVersionCode: Number(APP_VERSION.code),
    deviceSystem: "Android",
    deviceBrand: DEVICE.brand,
    deviceModel: DEVICE.model,
    deviceSystemVersion: DEVICE.osVersion,
    // Android IDs are 16 hex characters.
    uniquelyId: installId.slice(0, 16),
    installId,
    channel: "FCM",
  };
}

// Proton answers rapid repeats with "trigger frequency control".
const RETRY_AFTER_MS = 10 * 60_000;
let lastFailure = 0;

export async function registerPushDevice(api: ProtonApi, env: ProtonEnv): Promise<string | null> {
  if (Date.now() - lastFailure < RETRY_AFTER_MS) {
    log("push", "Skipping push device registration (last attempt failed recently)");
    return null;
  }
  // Stable per install: reuse the id we already send at login.
  const installId = api.deviceId || Crypto.randomUUID().replace(/-/g, "");
  try {
    const info = deviceInfo(installId);
    log("push", "Requesting a push device id", info);
    // The SDK's push client sends this with its own headers and no auth header.
    let res: Record<string, string> | null;
    try {
      res = await api.atlas<Record<string, string> | null>("information/mobileSync/generateDeviceId", {
        headers: { "X-UPLOAD-ID": encryptUpload(env, JSON.stringify(info)), "X-AGENT-TYPE": "Android" },
        noAuth: true,
      });
    } catch (e) {
      lastFailure = Date.now();
      logWarn("push", `generateDeviceId rejected: ${(e as Error).message}`);
      return null;
    }
    const deviceId = res?.deviceId ?? Object.values(res ?? {}).find((x) => typeof x === "string" && x.length >= 16);
    if (!deviceId) {
      lastFailure = Date.now();
      logWarn("push", "No device id in the reply", res);
      return null;
    }
    log("push", "Push device id issued", { deviceId, reply: res });

    await bindPushDevice(api, deviceId);
    return deviceId;
  } catch (e) {
    lastFailure = Date.now();
    logError("push", `Push device registration failed: ${(e as Error).message}`, e);
    return null;
  }
}

/**
 * The SDK's reSubmitDeviceId. A binding can lapse, leaving MQTT connected but silent, so
 * this runs before each command. Never throws.
 */
export async function bindPushDevice(api: ProtonApi, deviceId: string) {
  const uniquelyId = (api.deviceId || "").slice(0, 16);
  await api
    .atlas("information/mobileSync/integrated/replenish", { method: "POST", body: { deviceId, uniquelyId } })
    .then(() => log("push", "Push device bound to this account"))
    .catch((e) => logWarn("push", `Binding the push device failed: ${(e as Error).message}`));
}
