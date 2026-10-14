// Builds client/public/themes.json from mbadolato/iTerm2-Color-Schemes (MIT).
// Run: podman compose run --rm dev node scripts/build-themes.mjs
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const TARBALL = "https://codeload.github.com/mbadolato/iTerm2-Color-Schemes/tar.gz/refs/heads/master";
const LICENSE = "https://raw.githubusercontent.com/mbadolato/iTerm2-Color-Schemes/master/LICENSE";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "client", "public");

const KEYS = [
  "background", "foreground", "black", "red", "green", "yellow", "blue", "purple", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightPurple", "brightCyan", "brightWhite",
];

const tmp = await mkdtemp(join(tmpdir(), "themes-"));
try {
  const res = await fetch(TARBALL);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
  await new Promise((resolve, reject) => {
    const tar = spawn("tar", ["-xz", "-C", tmp, "--wildcards", "*/windowsterminal/*.json"], { stdio: ["pipe", "inherit", "inherit"] });
    tar.on("error", reject);
    tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`))));
    Readable.fromWeb(res.body).on("error", reject).pipe(tar.stdin);
  });

  const root = (await readdir(tmp))[0];
  const dir = join(tmp, root, "windowsterminal");
  const themes = [];
  for (const file of await readdir(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const t = JSON.parse((await readFile(join(dir, file), "utf8")).replace(/^﻿/, ""));
      const c = KEYS.map((k) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(t[k] ?? "").trim());
        if (!m) throw new Error(`bad ${k}`);
        return m[1].toLowerCase();
      });
      if (typeof t.name !== "string" || !t.name) throw new Error("no name");
      themes.push({ n: t.name, c });
    } catch (e) {
      console.warn(`Skipping ${file}: ${e.message}`);
    }
  }
  themes.sort((a, b) => a.n.localeCompare(b.n, "en"));
  await writeFile(join(out, "themes.json"), JSON.stringify(themes));
  console.log(`Wrote ${themes.length} themes`);

  const lic = await fetch(LICENSE);
  if (!lic.ok) throw new Error(`LICENSE download failed: ${lic.status}`);
  await writeFile(
    join(out, "themes-LICENSE.txt"),
    `Terminal colour schemes in themes.json come from https://github.com/mbadolato/iTerm2-Color-Schemes (https://iterm2colorschemes.com/).\n\n${await lic.text()}`,
  );
} finally {
  await rm(tmp, { recursive: true, force: true });
}
