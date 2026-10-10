import { Directory, File, Paths } from "expo-file-system";
import { unzipSync } from "fflate";

import type { VehicleSceneAngle, VehicleStatus } from "@/core/types";
import type { ProtonApi } from "@/providers/proton/api";
import type { AtlasVehicleInfo } from "@/providers/proton/mappers";

/**
 * Reproduces the Proton Link car view. The app renders no 3D model: it downloads
 * a zip of PNG layers per camera angle (a base VEHICLE_FRAME plus transparent
 * overlays like DOOR_LEFT_FRONT_OPEN), then stacks the ones matching the live
 * status (com.malaysia.acosdk.rvc.impl.VehicleModelManager / VehicleThemeEnum).
 */

type ModelResource = { md5?: string; url?: string };

const ANGLE_ENDPOINT = {
  top: "basic/model/bodyCode/queryControlColorPicture",
  fortyFive: "basic/model/bodyCode/queryFortyFiveColorPicture",
} as const;

type AngleId = keyof typeof ANGLE_ENDPOINT;

/** Download + unzip a layer pack once, keyed by its md5; returns local file URIs by token. */
async function loadPack(api: ProtonApi, info: AtlasVehicleInfo, angle: AngleId): Promise<Record<string, string>> {
  const body = {
    matCode: info.matCode,
    modelCode: info.modelCode,
    bodyColorCode: info.bodyColorCode,
    topColorCode: info.topColorCode ?? null,
  };
  const res = await api.atlas<ModelResource>(ANGLE_ENDPOINT[angle], { method: "POST", body });
  if (!res?.url || !res.md5) return {};

  const dir = new Directory(Paths.cache, "proton-theme", `${res.md5}-${angle}`);
  if (!dir.exists) {
    const tmp = new Directory(Paths.cache, "proton-theme", `${res.md5}-${angle}-dl`);
    if (tmp.exists) tmp.delete();
    tmp.create({ intermediates: true });
    const zip = await File.downloadFileAsync(res.url, new File(tmp, "pack.zip"));
    const entries = unzipSync(zip.bytes ? await zip.bytes() : new Uint8Array());
    dir.create({ intermediates: true });
    for (const [name, data] of Object.entries(entries)) {
      const base = name.split("/").pop() ?? name;
      if (!/\.(png|webp|jpg|jpeg)$/i.test(base) || data.length === 0) continue;
      const out = new File(dir, base);
      out.create({ overwrite: true });
      out.write(data);
    }
    tmp.delete();
  }

  const layers: Record<string, string> = {};
  for (const entry of dir.list()) {
    if (entry instanceof File) layers[entry.name.replace(/\.[^.]+$/, "").toUpperCase()] = entry.uri;
  }
  return layers;
}

function pick(layers: Record<string, string>, token: string) {
  const key = Object.keys(layers).find((k) => k.includes(token));
  return key ? layers[key] : undefined;
}

function buildAngle(id: AngleId, label: string, layers: Record<string, string>): VehicleSceneAngle | null {
  const base = pick(layers, "VEHICLE_FRAME") ?? pick(layers, "FRAME");
  if (!base) return null;

  const out: VehicleSceneAngle["layers"] = [{ uri: base }];
  const add = (uri: string | undefined, when: (s: VehicleStatus) => boolean) => uri && out.push({ uri, when });
  const doorOpen = (s: VehicleStatus, key: keyof NonNullable<VehicleStatus["doors"]>) => s.doors?.[key] === "open";
  const winOpen = (s: VehicleStatus, key: keyof NonNullable<VehicleStatus["windows"]>) => s.windows?.[key] === "open";

  // [enum SIDE_ROW token, status key]
  const doors = [
    ["LEFT_FRONT", "frontLeft"],
    ["RIGHT_FRONT", "frontRight"],
    ["LEFT_REAR", "rearLeft"],
    ["RIGHT_REAR", "rearRight"],
  ] as const;

  for (const [token, key] of doors) {
    add(pick(layers, `DOOR_${token}_CLOSE`), (s) => !doorOpen(s, key));
    add(pick(layers, `DOOR_${token}_OPEN`), (s) => doorOpen(s, key));
    add(pick(layers, `WINDOW_${token}_DOOR_CLOSE`), (s) => winOpen(s, key) && !doorOpen(s, key));
    add(pick(layers, `WINDOW_${token}_DOOR_OPEN`), (s) => winOpen(s, key) && doorOpen(s, key));
  }

  add(pick(layers, "HOOD_CLOSE"), (s) => !doorOpen(s, "hood"));
  add(pick(layers, "HOOD_OPEN"), (s) => doorOpen(s, "hood"));
  add(pick(layers, "TRUNK_CLOSE"), (s) => !doorOpen(s, "trunk"));
  add(pick(layers, "TRUNK_OPEN"), (s) => doorOpen(s, "trunk"));
  add(pick(layers, "SUNROOF_CLOSE"), (s) => !winOpen(s, "sunroof"));
  add(pick(layers, "SUNROOF_OPEN"), (s) => winOpen(s, "sunroof"));
  add(pick(layers, "CHARGING_COVER_OPEN"), (s) => s.isChargePortOpen === true);

  return { id, label, aspectRatio: id === "top" ? 1 : 1.6, layers: out };
}

export async function buildScene(api: ProtonApi, info: AtlasVehicleInfo) {
  const [top, fortyFive] = await Promise.all([
    loadPack(api, info, "top").catch(() => ({})),
    loadPack(api, info, "fortyFive").catch(() => ({})),
  ]);
  const angles = [buildAngle("fortyFive", "45°", fortyFive), buildAngle("top", "Top", top)].filter(
    (a): a is VehicleSceneAngle => a !== null,
  );
  return angles.length ? { angles } : null;
}
