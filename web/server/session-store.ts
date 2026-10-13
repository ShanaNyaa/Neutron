import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import type { ProtonSession } from "./proton/api.ts";

/** One Proton account per server, kept in the data volume (never sent to the browser). */
export function sessionStore(dataDir: string) {
  const path = `${dataDir}/session.json`;
  return {
    async load(): Promise<ProtonSession | null> {
      try {
        return JSON.parse(await readFile(path, "utf8"));
      } catch {
        return null;
      }
    },
    async save(session: ProtonSession) {
      await mkdir(dataDir, { recursive: true });
      await writeFile(path, JSON.stringify(session, null, 2), { mode: 0o600 });
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
}
