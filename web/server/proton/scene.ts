import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

import type { AtlasVehicleInfo } from "../../../src/providers/proton/mappers.ts";
import type { ProtonApi } from "./api.ts";

/**
 * Port of src/providers/proton/imagery.ts: downloads Proton's zip of transparent PNG layers per
 * camera angle and caches the unzipped files by md5. The browser stacks the layers.
 */

export type SceneAngleId = "top" | "fortyFive";

const ANGLE_ENDPOINT: Record<SceneAngleId, string> = {
  top: "basic/model/bodyCode/queryControlColorPicture",
  fortyFive: "basic/model/bodyCode/queryFortyFiveColorPicture",
};

type ModelResource = { md5?: string; url?: string };

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/** Downloads and unzips a layer pack once; returns its folder name and image files. */
export async function loadPack(api: ProtonApi, info: AtlasVehicleInfo, angle: SceneAngleId, dataDir: string) {
  const res = await api.atlas<ModelResource>(ANGLE_ENDPOINT[angle], {
    method: "POST",
    body: { matCode: info.matCode, modelCode: info.modelCode, bodyColorCode: info.bodyColorCode, topColorCode: info.topColorCode ?? null },
  });
  if (!res?.url || !res.md5) return null;

  const pack = `${res.md5}-${angle}`;
  const dir = path.join(dataDir, "scene", pack);
  if (!(await exists(dir))) {
    console.log(`[scene] Downloading ${pack}`);
    const zip = await fetch(res.url);
    if (!zip.ok) throw new Error(`Downloading the ${angle} car pictures failed (${zip.status})`);
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const tmp = `${dir}-dl`;
    await rm(tmp, { recursive: true, force: true });
    await mkdir(tmp, { recursive: true });
    try {
      for (const [name, data] of Object.entries(entries)) {
        const base = name.split("/").pop() ?? name;
        if (!/^[A-Za-z0-9_.-]+\.(png|webp|jpe?g)$/i.test(base) || data.length === 0) continue;
        await writeFile(path.join(tmp, base), data);
      }
      await rename(tmp, dir);
    } catch (e) {
      await rm(tmp, { recursive: true, force: true });
      throw e;
    }
  }

  const files = (await readdir(dir)).filter((f) => /\.(png|webp|jpe?g)$/i.test(f));
  return { pack, files };
}
