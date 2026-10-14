import { readFile } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { stream } from "hono/streaming";

import { formatPhone } from "../../src/providers/proton/format.ts";
import { login, newDeviceId, normalizeMsisdn, ProtonApi, ProtonError, type ProtonSession } from "./proton/api.ts";
import { createClient, type ProtonClient } from "./proton/client.ts";
import { geocoder } from "./geocode.ts";
import { sessionStore } from "./session-store.ts";

const PORT = Number(process.env.PORT ?? 3001);
const DATA_DIR = process.env.DATA_DIR ?? "/data";
// Host names the browser may use to reach this server. Guards against DNS rebinding.
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? "localhost,127.0.0.1").split(",").map((h) => h.trim());

const store = sessionStore(DATA_DIR);
const geo = geocoder(DATA_DIR);
let session: ProtonSession | null = await store.load();
let client: ProtonClient | null = null;

function proton(): ProtonClient {
  if (!session) throw new ProtonError("Not signed in", undefined, true);
  client ??= createClient(
    new ProtonApi(session, async (s) => {
      session = s;
      await store.save(s);
    }),
    DATA_DIR,
  );
  return client;
}

async function signOut() {
  session = null;
  client = null;
  await store.clear();
}

const app = new Hono();

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
    if (e.isReauthRequired && session) await signOut();
    return c.json({ error: e.message, code: e.code, signedOut: e.isReauthRequired }, e.isReauthRequired ? 401 : 502);
  }
  console.error(e);
  return c.json({ error: (e as Error).message ?? "Server error" }, 500);
});

app.get("/api/session", (c) => c.json({ signedIn: !!session, account: session?.accountLabel ?? null }));

app.post("/api/login", async (c) => {
  const { mobilePhone, password } = await c.req.json<{ mobilePhone?: string; password?: string }>();
  if (!mobilePhone?.trim() || !password) return c.json({ error: "Enter your mobile number and password" }, 400);
  const deviceId = newDeviceId();
  const res = await login("prod", mobilePhone.trim(), password, deviceId);
  session = {
    userId: res.userId,
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    deviceId,
    env: "prod",
    signedInAt: Date.now(),
    accountLabel: formatPhone("+" + normalizeMsisdn(mobilePhone)),
  };
  client = null;
  await store.save(session);
  return c.json({ signedIn: true, account: session.accountLabel });
});

app.post("/api/logout", async (c) => {
  await signOut();
  return c.json({ signedIn: false, account: null });
});

app.get("/api/vehicles", async (c) => c.json(await proton().listVehicles()));

app.get("/api/vehicles/:vin/status", async (c) => c.json(await proton().getStatus(c.req.param("vin"))));

app.get("/api/vehicles/:vin/trips", async (c) => c.json(await proton().getTrips(c.req.param("vin"))));

app.get("/api/vehicles/:vin/trips/track", async (c) => {
  const start = Number(c.req.query("start"));
  const end = Number(c.req.query("end"));
  if (!start || !end) return c.json({ error: "start and end are required" }, 400);
  return c.json(await proton().getTripTrack(c.req.param("vin"), start, end));
});

app.get("/api/vehicles/:vin/scene", async (c) => c.json(await proton().getScene(c.req.param("vin"))));

app.get("/api/vehicles/:vin/data-usage", async (c) => c.json(await proton().getDataUsage(c.req.param("vin"))));

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

app.get("/api/notices", async (c) => c.json(await proton().getNotices()));

// Signed-in only, so the server isn't an open proxy to Nominatim.
app.get("/api/geocode", async (c) => {
  proton();
  const lat = Number(c.req.query("lat"));
  const lng = Number(c.req.query("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return c.json({ error: "lat and lng are required" }, 400);
  return c.json({ address: await geo.address(lat, lng) });
});

app.post("/api/notices/:id/read", async (c) => {
  await proton().markNoticeRead(c.req.param("id"));
  return c.json({ ok: true });
});

/**
 * Streams newline-delimited JSON: `{"stage":"cloud"}` once Proton accepts the command,
 * `{"stage":"car"}` once it reaches the car, then `{"result":...}` or `{"error":...}`.
 */
app.post("/api/vehicles/:vin/commands/:command", async (c: Context) => {
  const { pin, params } = await c.req.json<{ pin?: string; params?: Record<string, string | number> }>();
  const vin = c.req.param("vin")!;
  const command = c.req.param("command")!;
  const client = proton();
  c.header("Content-Type", "application/x-ndjson");
  return stream(c, async (out) => {
    const send = (line: unknown) => out.write(JSON.stringify(line) + "\n");
    try {
      const result = await client.sendCommand(vin, command, { pin, params, onProgress: (stage) => void send({ stage }) });
      await send({ result });
    } catch (e) {
      const err = e as ProtonError;
      if (err.isReauthRequired) await signOut();
      await send({ error: err.message, code: err.code, signedOut: !!err.isReauthRequired });
    }
  });
});

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// In production the server also hosts the built React app.
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./client/dist" }));
  app.get("*", serveStatic({ path: "./client/dist/index.html" }));
}

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, ({ port }) => {
  console.log(`[server] Listening on ${port}${session ? ` (signed in as ${session.accountLabel ?? session.userId})` : ""}`);
});
