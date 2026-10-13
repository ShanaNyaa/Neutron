import { createHash, randomUUID } from "node:crypto";

/**
 * Node port of src/providers/proton/api.ts: the same hosts, headers and token refresh, with
 * node:crypto in place of expo-crypto. See docs/proton-integration.md.
 */

export type ProtonEnv = "prod" | "uat" | "qa";

export const HOSTS: Record<ProtonEnv, { legacy: string; atlas: string }> = {
  prod: { legacy: "https://app.acotech.my:8443/", atlas: "https://app-atlas.acotech.my:8443/" },
  uat: { legacy: "https://appuat.acotech.my:60033/", atlas: "https://uatapp-atlas.acotech.my:60012/" },
  qa: { legacy: "https://app.acotech.my:50011/", atlas: "https://qaapp-atlas.acotech.my:50012/" },
};

export const APP_VERSION = { name: "2.1.0", code: "210" };
// Android API level (Build.VERSION.SDK_INT); the login gateway rejects requests without it.
const AGENT_VERSION = "34";
// The atlas gateway expects Android-shaped Build.* values.
export const DEVICE = { brand: "google", model: "Pixel 7", osVersion: "14" };
const TOKEN_EXPIRED = 40006;

export type ProtonSession = {
  userId: string;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  env: ProtonEnv;
  /** Server-issued, unlike deviceId; MQTT results are routed to it. */
  pushDeviceId?: string;
  signedInAt?: number;
  accountLabel?: string;
};

export class ProtonError extends Error {
  constructor(
    message: string,
    readonly code?: string | number,
    /** The session is no longer usable; sign in again. */
    readonly isReauthRequired = false,
  ) {
    super(message);
    this.name = "ProtonError";
  }
}

type Envelope<T> = { code: number | string; msg?: string; data?: T };

export const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

/** 32 hex chars, the same shape as Proton's device ids. */
export const newDeviceId = () => randomUUID().replace(/-/g, "");

function legacyHeaders(token?: string): Record<string, string> {
  return {
    "X-AGENT-TYPE": "android",
    "Accept-Language": "en",
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
    "REQUEST-ID": newDeviceId(),
    Authorization: `Bearer ${token}`,
  };
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  /** Arrays repeat the key (`a=1&a=2`). */
  query?: Record<string, string | number | boolean | (string | number)[] | undefined | null>;
  body?: unknown;
  timeoutMs?: number;
};

async function call<T>(base: string, path: string, opts: RequestOptions): Promise<T> {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
    else if (v != null) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json; charset=UTF-8";

  const method = opts.method ?? "GET";
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e) {
    const message = (e as Error).name === "TimeoutError" ? "Request timed out" : `Network error: ${(e as Error).message}`;
    console.error(`[http] ${method} ${url.host}${url.pathname} failed: ${message}`);
    throw new ProtonError(message);
  }
  const text = await res.text();
  let env: Envelope<T> | undefined;
  try {
    env = text ? JSON.parse(text) : undefined;
  } catch {
    // not JSON
  }
  console.log(`[http] ${method} ${url.host}${url.pathname} → ${res.status} ${env?.code ?? ""} (${Date.now() - started} ms)`);
  if (res.status === 401) throw new ProtonError("Session expired", 401, true);
  if (env && typeof env === "object" && "code" in env) {
    if (Number(env.code) === 200) return env.data as T;
    if (Number(env.code) === TOKEN_EXPIRED) throw new ProtonError("Session expired", TOKEN_EXPIRED, true);
    throw new ProtonError(env.msg || `Proton error ${env.code}`, env.code);
  }
  throw new ProtonError(`HTTP ${res.status}`, res.status);
}

/** Proton expects "60" + the number without its leading 0 (E.164 without the plus). */
export function normalizeMsisdn(raw: string, countryCode = "60") {
  let n = raw.replace(/[\s()-]/g, "").replace(/^\+/, "");
  if (n.startsWith(countryCode)) return n;
  if (n.startsWith("0")) n = n.slice(1);
  return countryCode + n;
}

export type LoginEntity = { userId: string; accessToken: string; refreshToken: string; expiresIn?: string };

export function login(env: ProtonEnv, mobilePhone: string, password: string, deviceId: string) {
  return call<LoginEntity>(HOSTS[env].legacy, "app/v1/member/login", {
    method: "POST",
    headers: legacyHeaders(),
    body: { mobilePhone: normalizeMsisdn(mobilePhone), password: md5(password), type: "1", clientType: "phone", deviceId },
  });
}

export class ProtonApi {
  private refreshing: Promise<void> | null = null;
  private session: ProtonSession;
  private readonly onSession: (s: ProtonSession) => Promise<void>;

  constructor(session: ProtonSession, onSession: (s: ProtonSession) => Promise<void>) {
    this.session = session;
    this.onSession = onSession;
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
    return this.withRefresh(() =>
      call<T>(HOSTS[this.session.env].legacy, path, { ...opts, headers: { ...legacyHeaders(this.session.accessToken), ...opts.headers } }),
    );
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
      if (!(e instanceof ProtonError) || !e.isReauthRequired) throw e;
      await this.refresh();
      return fn();
    }
  }

  private refresh() {
    this.refreshing ??= (async () => {
      const { userId, refreshToken, deviceId, env } = this.session;
      try {
        const res = await call<{ accessToken: string }>(HOSTS[env].legacy, "app/v1/member/tokenRefresh", {
          method: "POST",
          headers: legacyHeaders(),
          body: { userId, refreshToken, clientType: "phone", deviceId },
        });
        this.session = { ...this.session, accessToken: res.accessToken };
        await this.onSession(this.session);
      } catch {
        throw new ProtonError("Your Proton session expired. Sign in again.", "refresh", true);
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
}
