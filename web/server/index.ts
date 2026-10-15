import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { stream } from "hono/streaming";

import { formatPhone } from "../../src/providers/proton/format.ts";
import { login, newDeviceId, normalizeMsisdn, ProtonApi, ProtonError } from "./proton/api.ts";
import { createClient, type ProtonClient } from "./proton/client.ts";
import { geocoder } from "./geocode.ts";
import { userStore, type StoredSession } from "./users.ts";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const PRODUCTION = process.env.NODE_ENV === "production";
// Host names the browser may use to reach this server. Guards against DNS rebinding.
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? "localhost,127.0.0.1").split(",").map((h) => h.trim());
// Proton numbers that may sign in, in any format. Empty: only the first person to sign in.
// "*": anyone with a Proton Link account (the lockout after failed sign-ins still applies).
const OPEN_TO_ANYONE = (process.env.ALLOWED_PHONES ?? "").trim() === "*";
const ALLOWED_PHONES = OPEN_TO_ANYONE
  ? []
  : (process.env.ALLOWED_PHONES ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => normalizeMsisdn(p));
const COOKIE = "neutron_session";
const COOKIE_MAX_AGE = 30 * 24 * 3600;

/**
 * Encrypts the stored Proton sessions. Required in production. In development one is generated
 * and kept in the data volume, so a fresh `compose up` works without setup.
 */
async function sessionSecret(): Promise<string> {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (PRODUCTION) {
    console.error("[server] SESSION_SECRET is required in production (for example: openssl rand -base64 32).");
    process.exit(1);
  }
  const file = path.join(DATA_DIR, "dev-session-secret");
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    const secret = randomBytes(32).toString("base64");
    await writeFile(file, secret, { mode: 0o600 });
    console.warn("[server] No SESSION_SECRET set; generated one for development in the data volume.");
    return secret;
  }
}

const store = await userStore(DATA_DIR, await sessionSecret());
const geo = geocoder(DATA_DIR);

// Everyone signed in, by Proton userId. The client is created on first use and dropped on sign-out.
type User = { session: StoredSession; client: ProtonClient | null };
const users = new Map<string, User>();
for (const session of await store.allSessions()) users.set(session.userId, { session, client: null });
const migrated = await store.migrateLegacy();
if (migrated) users.set(migrated.userId, { session: migrated, client: null });

function clientFor(user: User): ProtonClient {
  user.client ??= createClient(
    new ProtonApi(user.session, async (s) => {
      user.session = { ...user.session, ...s };
      await store.saveSession(user.session);
    }),
    DATA_DIR,
  );
  return user.client;
}

/** The person's Proton session is gone (expired, or signed in elsewhere): sign them out everywhere. */
async function dropUser(userId: string) {
  users.delete(userId);
  await store.removeSession(userId);
  await store.revokeAllCookies(userId);
}

// Failed sign-ins, per number and per address: after LOCKOUT_AFTER within the window, wait LOCKOUT_MS.
const LOCKOUT_AFTER = 5;
const LOCKOUT_MS = 15 * 60_000;
const failures = new Map<string, number[]>();
function lockedFor(key: string) {
  const recent = (failures.get(key) ?? []).filter((t) => Date.now() - t < LOCKOUT_MS);
  failures.set(key, recent);
  return recent.length >= LOCKOUT_AFTER ? LOCKOUT_MS - (Date.now() - recent[0]) : 0;
}
const noteFailure = (key: string) => failures.set(key, [...(failures.get(key) ?? []), Date.now()]);

/**
 * Checked before Proton is contacted. With ALLOWED_PHONES empty, only the owner (whoever signed
 * in first) and people already here may sign in; a migrated session has no number on record yet,
 * so that case is settled by userId after Proton answers (see /api/login).
 */
function allowedPhone(msisdn: string) {
  if (OPEN_TO_ANYONE) return true;
  if (ALLOWED_PHONES.length) return ALLOWED_PHONES.includes(msisdn);
  if (users.size === 0) return true;
  return [...users.values()].some((u) => u.session.msisdn === msisdn || !u.session.msisdn);
}

type Env = { Variables: { user: User; cookie: string } };
const app = new Hono<Env>();

app.use("/api/*", async (c, next) => {
  const host = (c.req.header("host") ?? "").replace(/:\d+$/, "");
  if (!ALLOWED_HOSTS.includes(host)) return c.json({ error: `Host ${host} isn't in ALLOWED_HOSTS` }, 403);
  // A JSON content type can't be sent cross-site without a CORS preflight, which this server
  // never answers, so other websites can't send commands through your browser.
  if (c.req.method !== "GET" && !c.req.header("content-type")?.startsWith("application/json")) {
    return c.json({ error: "Expected application/json" }, 415);
  }
  await next();
});

app.onError(async (e, c) => {
  if (e instanceof ProtonError) {
    const user = c.get("user") as User | undefined;
    if (e.isReauthRequired && user) await dropUser(user.session.userId);
    return c.json({ error: e.message, code: e.code, signedOut: e.isReauthRequired }, e.isReauthRequired ? 401 : 502);
  }
  console.error(e);
  return c.json({ error: (e as Error).message ?? "Server error" }, 500);
});

// `Secure` whenever the page came over HTTPS (directly or through a reverse proxy). A browser
// drops Secure cookies on plain HTTP, which would break use over a LAN address.
const secureCookie = (c: Context) => c.req.header("x-forwarded-proto") === "https" || new URL(c.req.url).protocol === "https:";

async function issueCookie(c: Context, userId: string) {
  const token = await store.issueCookie(userId);
  setCookie(c, COOKIE, token, { httpOnly: true, secure: secureCookie(c), sameSite: "Lax", path: "/", maxAge: COOKIE_MAX_AGE });
  return token;
}

/** Who is asking, from the cookie. A migrated single-user session is claimed by the first browser. */
async function resolveUser(c: Context): Promise<User | null> {
  const token = getCookie(c, COOKIE);
  const userId = await store.userForCookie(token);
  if (userId) {
    const user = users.get(userId);
    if (user) return user;
    await store.revokeCookie(token);
    deleteCookie(c, COOKIE, { path: "/" });
    return null;
  }
  const legacy = [...users.values()].find((u) => u.session.legacy);
  if (legacy) {
    delete legacy.session.legacy;
    await store.saveSession(legacy.session);
    await issueCookie(c, legacy.session.userId);
    console.log(`[users] The migrated session was claimed by ${c.req.header("x-forwarded-for") ?? "a browser"}`);
    return legacy;
  }
  return null;
}

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/session", async (c) => {
  const user = await resolveUser(c);
  return c.json({ signedIn: !!user, account: user?.session.accountLabel ?? null });
});

app.post("/api/login", async (c) => {
  const { mobilePhone, password } = await c.req.json<{ mobilePhone?: string; password?: string }>();
  if (!mobilePhone?.trim() || !password) return c.json({ error: "Enter your mobile number and password" }, 400);
  const msisdn = normalizeMsisdn(mobilePhone.trim());
  const address = c.req.header("x-forwarded-for")?.split(",")[0].trim() || "local";
  const wait = Math.max(lockedFor(`phone:${msisdn}`), lockedFor(`addr:${address}`));
  if (wait > 0) return c.json({ error: `Too many failed sign-ins. Try again in ${Math.ceil(wait / 60_000)} min.` }, 429);
  if (!allowedPhone(msisdn)) {
    noteFailure(`phone:${msisdn}`);
    noteFailure(`addr:${address}`);
    return c.json({ error: "That number isn't allowed on this Neutron server. Ask whoever runs it to add you." }, 403);
  }
  const deviceId = newDeviceId();
  let res;
  try {
    res = await login("prod", mobilePhone.trim(), password, deviceId);
  } catch (e) {
    noteFailure(`phone:${msisdn}`);
    noteFailure(`addr:${address}`);
    await new Promise((r) => setTimeout(r, 1_000));
    throw e;
  }
  if (!OPEN_TO_ANYONE && !ALLOWED_PHONES.length && users.size && !users.has(res.userId)) {
    noteFailure(`addr:${address}`);
    return c.json({ error: "That number isn't allowed on this Neutron server. Ask whoever runs it to add you." }, 403);
  }
  failures.delete(`phone:${msisdn}`);
  const previous = users.get(res.userId);
  const session: StoredSession = {
    userId: res.userId,
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    deviceId,
    env: "prod",
    // Proton allows one session per account, so the old tokens are dead; the push device id survives.
    pushDeviceId: previous?.session.pushDeviceId,
    signedInAt: Date.now(),
    accountLabel: formatPhone("+" + msisdn),
    msisdn,
  };
  await store.saveSession(session);
  // Other devices keep their cookies: they just use the new tokens.
  users.set(res.userId, { session, client: null });
  await issueCookie(c, res.userId);
  return c.json({ signedIn: true, account: session.accountLabel });
});

// Everything below needs a signed-in person, except the cached scene pictures.
app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/scene/")) return next();
  const user = await resolveUser(c);
  if (!user) return c.json({ error: "Not signed in", signedOut: true }, 401);
  c.set("user", user);
  c.set("cookie", getCookie(c, COOKIE) ?? "");
  await next();
});

const proton = (c: Context<Env>) => clientFor(c.get("user"));

/** Signs this device out. When it was the last one, the Proton tokens go too. */
app.post("/api/logout", async (c) => {
  const user = c.get("user");
  await store.revokeCookie(c.get("cookie"));
  deleteCookie(c, COOKIE, { path: "/" });
  if ((await store.cookieCount(user.session.userId)) === 0) {
    users.delete(user.session.userId);
    await store.removeSession(user.session.userId);
  }
  return c.json({ signedIn: false, account: null });
});

/** Removes everything the server holds about this person: tokens, cookies, command log. */
app.post("/api/delete-my-data", async (c) => {
  const user = c.get("user");
  users.delete(user.session.userId);
  await store.deleteUser(user.session.userId);
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ signedIn: false, account: null });
});

app.get("/api/log", async (c) => c.json(await store.readLog(c.get("user").session.userId)));

app.get("/api/vehicles", async (c) => c.json(await proton(c).listVehicles()));

app.get("/api/vehicles/:vin/status", async (c) => c.json(await proton(c).getStatus(c.req.param("vin"))));

app.get("/api/vehicles/:vin/trips", async (c) => c.json(await proton(c).getTrips(c.req.param("vin"))));

app.get("/api/vehicles/:vin/trips/track", async (c) => {
  const start = Number(c.req.query("start"));
  const end = Number(c.req.query("end"));
  if (!start || !end) return c.json({ error: "start and end are required" }, 400);
  return c.json(await proton(c).getTripTrack(c.req.param("vin"), start, end));
});

app.get("/api/vehicles/:vin/scene", async (c) => c.json(await proton(c).getScene(c.req.param("vin"))));

app.get("/api/vehicles/:vin/data-usage", async (c) => c.json(await proton(c).getDataUsage(c.req.param("vin"))));

const IMAGE_TYPES: Record<string, string> = { png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg" };

// Serves the cached layer pictures; needs no Proton session.
app.get("/api/scene/:pack/:file", async (c) => {
  const { pack, file } = c.req.param();
  const match = /^[A-Za-z0-9_.-]+\.(png|webp|jpe?g)$/.exec(file);
  if (!/^[0-9a-fA-F]{8,64}-(top|fortyFive)$/.test(pack) || !match) return c.json({ error: "Not found" }, 404);
  const root = path.resolve(DATA_DIR, "scene");
  const full = path.resolve(root, pack, file);
  if (!full.startsWith(root + path.sep)) return c.json({ error: "Not found" }, 404);
  try {
    const data = await readFile(full);
    return c.body(new Uint8Array(data), 200, {
      "Content-Type": IMAGE_TYPES[match[1].toLowerCase()],
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});

app.get("/api/notices", async (c) => c.json(await proton(c).getNotices()));

// Signed-in only, so the server isn't an open proxy to Nominatim.
app.get("/api/geocode", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lng = Number(c.req.query("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return c.json({ error: "lat and lng are required" }, 400);
  return c.json({ address: await geo.address(lat, lng) });
});

app.post("/api/notices/:id/read", async (c) => {
  await proton(c).markNoticeRead(c.req.param("id"));
  return c.json({ ok: true });
});

/**
 * Streams newline-delimited JSON: `{"stage":"cloud"}` once Proton accepts the command,
 * `{"stage":"car"}` once it reaches the car, then `{"result":...}` or `{"error":...}`.
 */
app.post("/api/vehicles/:vin/commands/:command", async (c) => {
  const { pin, params } = await c.req.json<{ pin?: string; params?: Record<string, string | number> }>();
  const vin = c.req.param("vin")!;
  const command = c.req.param("command")!;
  const user = c.get("user");
  const client = clientFor(user);
  const log = (result: string) => store.appendLog({ time: Date.now(), userId: user.session.userId, vin, command, result });
  c.header("Content-Type", "application/x-ndjson");
  return stream(c, async (out) => {
    const send = (line: unknown) => out.write(JSON.stringify(line) + "\n");
    try {
      const result = await client.sendCommand(vin, command, { pin, params, onProgress: (stage) => void send({ stage }) });
      await log(result.isOk ? "ok" : `failed: ${result.message}`);
      await send({ result });
    } catch (e) {
      const err = e as ProtonError;
      await log(`error: ${err.message}`);
      if (err.isReauthRequired) await dropUser(user.session.userId);
      await send({ error: err.message, code: err.code, signedOut: !!err.isReauthRequired });
    }
  });
});

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// In production the server also hosts the built React app.
if (PRODUCTION) {
  app.use("/*", serveStatic({ root: "./client/dist" }));
  app.get("*", serveStatic({ path: "./client/dist/index.html" }));
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, ({ port }) => {
  const who = [...users.values()].map((u) => u.session.accountLabel ?? u.session.userId);
  console.log(`[server] Listening on ${HOST}:${port}${who.length ? ` (${who.length} signed in: ${who.join(", ")})` : ""}`);
  if (OPEN_TO_ANYONE) console.log("[server] ALLOWED_PHONES is *: anyone with a Proton Link account may sign in.");
  else if (!ALLOWED_PHONES.length) console.log("[server] ALLOWED_PHONES is empty: only the first person to sign in may use this server.");
});
