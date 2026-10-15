import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ProtonSession } from "./proton/api.ts";

/**
 * Everyone who signs in to this server, keyed by their Proton `userId`:
 *
 *   ${DATA_DIR}/users/<userId>/session.json.enc   Proton tokens, AES-256-GCM with SESSION_SECRET
 *   ${DATA_DIR}/users/<userId>/commands.jsonl     that person's command log
 *   ${DATA_DIR}/cookies.json                      sha256(cookie token) → userId
 *
 * Cookie tokens are only ever stored hashed, so the file can't be used to impersonate anyone.
 */

export type StoredSession = ProtonSession & {
  /** E.164 without the plus, as Proton wants it; compared against ALLOWED_PHONES. */
  msisdn: string;
  /**
   * Set when this session was migrated from the single-user session.json. The first browser to
   * open the app claims it (see claimLegacy), so the owner needn't sign in again after upgrading.
   */
  legacy?: boolean;
};

export type CommandLogEntry = { time: number; userId: string; vin: string; command: string; result: string };

type CookieFile = Record<string, { userId: string; createdAt: number; lastSeenAt?: number }>;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

function encrypt(key: Buffer, plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

function decrypt(key: Buffer, encoded: string) {
  const buf = Buffer.from(encoded, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, file);
}

const safeId = (userId: string) => /^[A-Za-z0-9_-]{1,128}$/.test(userId);

export async function userStore(dataDir: string, secret: string) {
  const key = createHash("sha256").update(secret, "utf8").digest();
  const usersDir = path.join(dataDir, "users");
  const cookiesFile = path.join(dataDir, "cookies.json");
  const sessionFile = (userId: string) => path.join(usersDir, userId, "session.json.enc");
  const logFile = (userId: string) => path.join(usersDir, userId, "commands.jsonl");

  // One writer at a time for cookies.json.
  let cookieLock: Promise<unknown> = Promise.resolve();
  const withCookies = <T>(fn: (cookies: CookieFile) => Promise<T> | T) => {
    const run = cookieLock.then(async () => {
      const cookies = await readJson<CookieFile>(cookiesFile, {});
      const before = JSON.stringify(cookies);
      const out = await fn(cookies);
      if (JSON.stringify(cookies) !== before) await writeJson(cookiesFile, cookies);
      return out;
    });
    cookieLock = run.catch(() => undefined);
    return run;
  };

  const store = {
    async loadSession(userId: string): Promise<StoredSession | null> {
      if (!safeId(userId)) return null;
      try {
        return JSON.parse(decrypt(key, await readFile(sessionFile(userId), "utf8")));
      } catch {
        return null;
      }
    },

    async saveSession(session: StoredSession) {
      if (!safeId(session.userId)) throw new Error("Bad user id");
      await mkdir(path.dirname(sessionFile(session.userId)), { recursive: true });
      await writeFile(sessionFile(session.userId), encrypt(key, JSON.stringify(session)), { mode: 0o600 });
    },

    async userIds(): Promise<string[]> {
      try {
        return (await readdir(usersDir, { withFileTypes: true })).filter((d) => d.isDirectory() && safeId(d.name)).map((d) => d.name);
      } catch {
        return [];
      }
    },

    async allSessions(): Promise<StoredSession[]> {
      const out: StoredSession[] = [];
      for (const id of await store.userIds()) {
        const s = await store.loadSession(id);
        if (s) out.push(s);
      }
      return out;
    },

    /** Issues a cookie token for this person. Returns the raw token; only its hash is stored. */
    async issueCookie(userId: string): Promise<string> {
      const token = randomBytes(32).toString("base64url");
      await withCookies((cookies) => {
        cookies[hash(token)] = { userId, createdAt: Date.now() };
      });
      return token;
    },

    async userForCookie(token: string | undefined): Promise<string | null> {
      if (!token) return null;
      const h = hash(token);
      return withCookies((cookies) => {
        const entry = cookies[h];
        if (!entry) return null;
        // Touched at most hourly, so a busy page doesn't rewrite the file on every request.
        if (!entry.lastSeenAt || Date.now() - entry.lastSeenAt > 3_600_000) entry.lastSeenAt = Date.now();
        return entry.userId;
      });
    },

    async revokeCookie(token: string | undefined) {
      if (!token) return;
      await withCookies((cookies) => {
        delete cookies[hash(token)];
      });
    },

    async cookieCount(userId: string) {
      return withCookies((cookies) => Object.values(cookies).filter((c) => c.userId === userId).length);
    },

    async revokeAllCookies(userId: string) {
      await withCookies((cookies) => {
        for (const [h, c] of Object.entries(cookies)) if (c.userId === userId) delete cookies[h];
      });
    },

    /** Drops the Proton session but keeps the log, for "signed out everywhere". */
    async removeSession(userId: string) {
      if (!safeId(userId)) return;
      await rm(sessionFile(userId), { force: true });
    },

    /** Everything about this person: session, cookies and log. */
    async deleteUser(userId: string) {
      if (!safeId(userId)) return;
      await store.revokeAllCookies(userId);
      await rm(path.join(usersDir, userId), { recursive: true, force: true });
    },

    async appendLog(entry: CommandLogEntry) {
      if (!safeId(entry.userId)) return;
      await mkdir(path.dirname(logFile(entry.userId)), { recursive: true });
      await appendFile(logFile(entry.userId), JSON.stringify(entry) + "\n", { mode: 0o600 });
    },

    async readLog(userId: string, limit = 200): Promise<CommandLogEntry[]> {
      if (!safeId(userId)) return [];
      try {
        const lines = (await readFile(logFile(userId), "utf8")).split("\n").filter(Boolean);
        return lines
          .slice(-limit)
          .map((l) => {
            try {
              return JSON.parse(l) as CommandLogEntry;
            } catch {
              return null;
            }
          })
          .filter((e): e is CommandLogEntry => !!e)
          .reverse();
      } catch {
        return [];
      }
    },

    /**
     * Turns a pre-multi-user `${DATA_DIR}/session.json` into the first user's encrypted session.
     * The plain file is removed once the encrypted copy is written.
     */
    async migrateLegacy(): Promise<StoredSession | null> {
      const legacyFile = path.join(dataDir, "session.json");
      const old = await readJson<(ProtonSession & { msisdn?: string }) | null>(legacyFile, null);
      if (!old?.userId || !old.accessToken) return null;
      const session: StoredSession = {
        ...old,
        // The old file didn't record the number; it's filled in on the next sign-in.
        msisdn: old.msisdn ?? "",
        legacy: true,
      };
      await store.saveSession(session);
      await rm(legacyFile, { force: true });
      console.log(`[users] Moved session.json to users/${old.userId}/session.json.enc`);
      return session;
    },
  };
  return store;
}

export type UserStore = Awaited<ReturnType<typeof userStore>>;
