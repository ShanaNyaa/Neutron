import { CarFront } from "lucide-react";

import type { SceneAngle, WebStatus, WebVehicle } from "../api.ts";
import { useScene } from "../hooks.ts";

/**
 * Proton Link's car view: a base frame plus transparent overlays (doors, windows, boot, bonnet)
 * stacked to match the live status. Port of src/providers/proton/imagery.ts. Falls back to the
 * plain side picture while the layers load or when Proton has none for this car.
 */
export function CarScene({ vehicle, status, angle = "top", className = "" }: { vehicle: WebVehicle; status?: WebStatus; angle?: SceneAngle["id"]; className?: string }) {
  const scene = useScene(vehicle.vin);
  const chosen = scene.data?.angles.find((a) => a.id === angle);
  const layers = chosen ? stack(chosen.layers, status) : [];
  const alt = `${vehicle.name}${vehicle.color ? ` in ${vehicle.color}` : ""}`;

  if (layers.length) {
    return (
      <div className={`scene ${angle} ${className}`} role="img" aria-label={alt}>
        {layers.map((src, i) => <img key={src} src={src} alt="" draggable={false} style={{ zIndex: i }} />)}
      </div>
    );
  }
  if (vehicle.imageUrl) return <img className={`scene-fallback ${className}`} src={vehicle.imageUrl} alt={alt} />;
  return <CarFront className={`scene-fallback muted ${className}`} size={120} aria-label={alt} />;
}

const DOORS = [
  ["LEFT_FRONT", "frontLeft"],
  ["RIGHT_FRONT", "frontRight"],
  ["LEFT_REAR", "rearLeft"],
  ["RIGHT_REAR", "rearRight"],
] as const;

function stack(layers: Record<string, string>, s?: WebStatus) {
  const pick = (token: string) => layers[Object.keys(layers).find((k) => k.includes(token)) ?? ""];
  const base = pick("VEHICLE_FRAME") ?? pick("FRAME");
  if (!base) return [];
  const door = (k: keyof NonNullable<WebStatus["doors"]>) => s?.doors?.[k] === "open";
  const win = (k: keyof NonNullable<WebStatus["windows"]>) => s?.windows?.[k] === "open";
  const out: (string | undefined)[] = [base];
  for (const [token, key] of DOORS) {
    out.push(door(key) ? pick(`DOOR_${token}_OPEN`) : pick(`DOOR_${token}_CLOSE`));
    if (win(key)) out.push(door(key) ? pick(`WINDOW_${token}_DOOR_OPEN`) : pick(`WINDOW_${token}_DOOR_CLOSE`));
  }
  out.push(door("hood") ? pick("HOOD_OPEN") : pick("HOOD_CLOSE"));
  out.push(door("trunk") ? pick("TRUNK_OPEN") : pick("TRUNK_CLOSE"));
  out.push(win("sunroof") ? pick("SUNROOF_OPEN") : pick("SUNROOF_CLOSE"));
  if (s?.isChargePortOpen) out.push(pick("CHARGING_COVER_OPEN"));
  return out.filter((x): x is string => !!x);
}
