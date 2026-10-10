import { Buffer } from "buffer";
import * as Crypto from "expo-crypto";

import { HttpError, httpRequest, type RequestOptions } from "@/core/http";
import { ProviderError, type Session } from "@/core/provider";

/**
 * Proton Link talks to two backends that share one token:
 *  - "legacy" ECARX app gateway: login, token refresh, messages. Sends `AUTHORIZATION: <token>`.
 *  - "atlas" gateway: vehicles, status, remote control, imagery, trips. Sends `Authorization: Bearer <token>`.
 * Reverse-engineered from Proton Link 2.1.0 (see docs/protonlink_2.1.0_openapi.json).
 */

export type ProtonEnv = "prod" | "uat" | "qa";

export const HOSTS: Record<ProtonEnv, { legacy: string; atlas: string }> = {
  prod: { legacy: "https://app.acotech.my:8443/", atlas: "https://app-atlas.acotech.my:8443/" },
  uat: { legacy: "https://appuat.acotech.my:60033/", atlas: "https://uatapp-atlas.acotech.my:60012/" },
  qa: { legacy: "https://app.acotech.my:50011/", atlas: "https://qaapp-atlas.acotech.my:50012/" },
};

export const APP_VERSION = { name: "2.1.0", code: "210" };
// The app sends the Android API level here (Build.VERSION.SDK_INT); the login
// gateway rejects the request when it is missing.
const AGENT_VERSION = "34";
// The atlas gateway reads these from Build.*; it expects Android-shaped values
// regardless of the phone actually running the client.
export const DEVICE = { brand: "google", model: "Pixel 7", osVersion: "14" };
const TOKEN_EXPIRED = 40006;

export type ProtonSession = Session & {
  userId: string;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  env: ProtonEnv;
  /** Server-issued, unlike deviceId; MQTT results are routed to it. */
  pushDeviceId?: string;
  /** ms. Kept because Proton never says when the refresh token expires. */
  signedInAt?: number;
};

type Envelope<T> = { code: number | string; msg?: string; data?: T; exceptionCode?: string };

export const md5 = (s: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.MD5, s).then((h) => h.toLowerCase());

/** 32 hex chars, the same shape as Proton's device ids. */
export const newDeviceId = () => Crypto.randomUUID().replace(/-/g, "");

// Mirrors cn.com.ecarx.module_base.api.Header.buildHeader() exactly (plus the
// X-AGENT-VERSION the gateway requires); the app always reports itself as android.
function legacyHeaders(token?: string): Record<string, string> {
  return {
    "X-AGENT-TYPE": "android",
    "Accept-Language": "en",
    Connection: "close",
    "APP-NAME": "Proton Link",
    "Version-Name": APP_VERSION.name,
    "Version-Code": APP_VERSION.code,
    "X-APP-ID": "protonlink_01",
    "X-EQUIPMENT-TYPE": "proton link",
    "X-AGENT-VERSION": AGENT_VERSION,
    AUTHORIZATION: token ?? "",
  };
}

function atlasHeaders(token: string): Record<string, string> {
  return {
    "ACCEPT-LANGUAGE": "en",
    "VERSION-NAME": APP_VERSION.name,
    "VERSION-CODE": APP_VERSION.code,
    "X-EQUIPMENT-TYPE": "Proton_Link",
    "X-EQUIPMENT-BRAND": DEVICE.brand,
    "X-EQUIPMENT-MODEL": DEVICE.model,
    "X-EQUIPMENT-OS-VERSION": DEVICE.osVersion,
    "X-AGENT-VERSION": AGENT_VERSION,
    "CLIENT-ID": "android",
    "TENANT-ID": "acotech",
    "APP-NAME": "Proton Link",
    "REQUEST-ID": Crypto.randomUUID().replace(/-/g, ""),
    Authorization: `Bearer ${token}`,
  };
}

function unwrap<T>(env: Envelope<T>): T {
  if (Number(env.code) === 200) return env.data as T;
  if (Number(env.code) === TOKEN_EXPIRED) throw new ProviderError("Session expired", TOKEN_EXPIRED, true);
  throw new ProviderError(env.msg || `Proton error ${env.code}`, env.code);
}

async function call<T>(base: string, path: string, opts: RequestOptions): Promise<T> {
  try {
    return unwrap(await httpRequest<Envelope<T>>(base, path, opts));
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 401) throw new ProviderError("Session expired", 401, true);
      const env = e.body as Envelope<unknown> | undefined;
      if (env && typeof env === "object" && "code" in env) unwrap(env);
      throw new ProviderError(e.message, e.status);
    }
    throw e;
  }
}

/** Proton expects "60" + the number without its leading 0 (E.164 without the plus). */
export function normalizeMsisdn(raw: string, countryCode = "60") {
  let n = raw.replace(/[\s()-]/g, "").replace(/^\+/, "");
  if (n.startsWith(countryCode)) return n;
  if (n.startsWith("0")) n = n.slice(1);
  return countryCode + n;
}

export type LoginEntity = { userId: string; accessToken: string; refreshToken: string; expiresIn?: string; clientId?: string };

export async function login(env: ProtonEnv, mobilePhone: string, password: string, deviceId: string) {
  return call<LoginEntity>(HOSTS[env].legacy, "app/v1/member/login", {
    method: "POST",
    headers: legacyHeaders(),
    body: { mobilePhone: normalizeMsisdn(mobilePhone), password: await md5(password), type: "1", clientType: "phone", deviceId },
  });
}

export class ProtonApi {
  private refreshing: Promise<void> | null = null;

  constructor(
    private session: ProtonSession,
    private onSession: (s: ProtonSession) => Promise<void>,
  ) {}

  /** ms, if the refresh token is a JWT. Proton's current tokens are opaque, so normally undefined. */
  get refreshExpiresAt(): number | undefined {
    return jwtExpiry(this.session.refreshToken);
  }

  get signedInAt() {
    return this.session.signedInAt;
  }

  get userId() {
    return this.session.userId;
  }

  get deviceId() {
    return this.session.deviceId;
  }

  get env() {
    return this.session.env;
  }

  get pushDeviceId() {
    return this.session.pushDeviceId;
  }

  async setPushDeviceId(pushDeviceId: string) {
    this.session = { ...this.session, pushDeviceId };
    await this.onSession(this.session);
  }

  legacy<T>(path: string, opts: RequestOptions = {}) {
    return this.withRefresh(() => call<T>(HOSTS[this.session.env].legacy, path, { ...opts, headers: { ...legacyHeaders(this.session.accessToken), ...opts.headers } }));
  }

  atlas<T>(path: string, opts: RequestOptions & { noAuth?: boolean } = {}) {
    const { noAuth, ...rest } = opts;
    return this.withRefresh(() => {
      const headers: Record<string, string> = { ...atlasHeaders(this.session.accessToken), ...rest.headers };
      if (noAuth) delete headers.Authorization;
      return call<T>(HOSTS[this.session.env].atlas, path, { ...rest, headers });
    });
  }

  private async withRefresh<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ProviderError) || !e.isReauthRequired) throw e;
      await this.refresh();
      return fn();
    }
  }

  private refresh() {
    this.refreshing ??= (async () => {
      const { userId, refreshToken, deviceId, env } = this.session;
      try {
        const res = await call<{ accessToken: string; expiresIn?: string }>(HOSTS[env].legacy, "app/v1/member/tokenRefresh", {
          method: "POST",
          headers: legacyHeaders(),
          body: { userId, refreshToken, clientType: "phone", deviceId },
        });
        this.session = { ...this.session, accessToken: res.accessToken };
        await this.onSession(this.session);
      } catch {
        throw new ProviderError("Your Proton session expired. Sign in again.", "refresh", true);
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
}

function jwtExpiry(token?: string): number | undefined {
  const parts = token?.split(".");
  if (!parts || parts.length !== 3) return undefined;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const exp = Number(JSON.parse(json)?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}
