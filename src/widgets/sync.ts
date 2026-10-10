import { requireOptionalNativeModule } from "expo";
import { Directory, File, Paths } from "expo-file-system";

import { isIOS } from "@/core/shared";
import * as store from "@/core/store";
import type { Vehicle, VehicleStatus } from "@/core/types";
import type { CarWidgetCar } from "@/widgets/car-widget";
import { getCommandTimers } from "@/lib/command-timer";

// Loaded lazily: builds made before expo-widgets was added (and Android/web) skip it.
const hasWidgets = isIOS && !!requireOptionalNativeModule("ExpoWidgets");
/* eslint-disable @typescript-eslint/no-require-imports */
const CarWidget = (hasWidgets ? require("./car-widget").default : null) as typeof import("@/widgets/car-widget").default | null;
const CarLockWidget = (hasWidgets ? require("./lock-widget").default : null) as typeof import("@/widgets/lock-widget").default | null;
/* eslint-enable @typescript-eslint/no-require-imports */

// While a timed command runs, a second timeline entry at its end drops the countdown so it doesn't sit at 0:00.
function send(cars: CarWidgetCar[]) {
  const ends = cars.map((c) => c.timerEndsAt).filter((t): t is number => !!t && t > Date.now());
  if (CarWidget && ends.length) {
    const at = Math.min(...ends);
    const after = cars.map((c) => (c.timerEndsAt && c.timerEndsAt <= at ? { ...c, timerEndsAt: undefined } : c));
    CarWidget.updateTimeline([
      { date: new Date(), props: { cars } },
      { date: new Date(at), props: { cars: after } },
    ]);
  } else CarWidget?.updateSnapshot({ cars });
  try {
    CarLockWidget?.updateSnapshot({ cars });
  } catch {
    // Builds made before the Lock widget existed don't know it.
  }
}

/** The widgets' "Choose a car" list: the default car, then every car the app has now. */
function syncCarChoices(all: { connId: string; vehicle: Vehicle }[]) {
  const options = [
    { name: "Default car", value: "main" },
    ...all.map(({ connId, vehicle }) => ({ name: vehicle.name, value: `${connId}/${vehicle.id}`, subtitle: vehicle.model })),
  ];
  for (const widget of [CarWidget, CarLockWidget]) {
    try {
      widget?.setConfigurationParameterEnum("car", options);
    } catch {
      // Builds made before the picker became dynamic.
    }
  }
}

export function syncWidgets() {
  if (!CarWidget) return;
  try {
    const all = store.allVehicles();
    syncCarChoices(all);
    send(all.map(({ connId, vehicle }) => toWidgetCar(connId, vehicle)));
    const missing = all.filter(({ vehicle }) => vehicle.imageUrl && !cachedImage(vehicle.imageUrl));
    if (missing.length) {
      Promise.all(missing.map(({ vehicle }) => downloadImage(vehicle.imageUrl!)))
        .then(() => send(all.map(({ connId, vehicle }) => toWidgetCar(connId, vehicle))))
        .catch(() => {});
    }
  } catch {
    // Never let widget sync break a fetch.
  }
}

// Widgets can't fetch images: renders are saved in the shared App Group, named by URL hash.
const APP_GROUP = "group.com.zackryrosli.mottokar";
function imageDir() {
  const root = Paths.appleSharedContainers?.[APP_GROUP];
  return root ? new Directory(root, "widget-images") : null;
}
function imageFile(url: string) {
  const dir = imageDir();
  if (!dir) return null;
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  return new File(dir, `${(h >>> 0).toString(16)}.png`);
}
function cachedImage(url: string) {
  const f = imageFile(url);
  return f?.exists ? f.uri : undefined;
}
async function downloadImage(url: string) {
  const f = imageFile(url);
  const dir = imageDir();
  if (!f || !dir || f.exists) return;
  if (!dir.exists) dir.create({ intermediates: true });
  await File.downloadFileAsync(url, f);
}

// Run by plugins/native/CarControls.swift. Unlock and Start open the app to confirm instead:
// a widget tap also works in StandBy while the phone is locked.
const BACKGROUND = new Set(["lock", "climate_on", "lights"]);
const ACTIONS: { id: string; symbol: string; label: string }[] = [
  { id: "engine_start", symbol: "power", label: "Start" },
  { id: "climate_on", symbol: "fanblades.fill", label: "Climate" },
  { id: "lights", symbol: "headlight.low.beam.fill", label: "Lights" },
];

function toWidgetCar(connId: string, vehicle: Vehicle): CarWidgetCar {
  const stored = store.loadSnapshot<VehicleStatus>(connId, vehicle.id, "status");
  const s = stored?.data;
  const base = `mottokar://vehicle/${connId}/${encodeURIComponent(vehicle.id)}`;
  const lock = s?.lock === "unlocked" ? { id: "lock", symbol: "lock.fill", label: "Lock" } : { id: "unlock", symbol: "lock.open.fill", label: "Unlock" };
  const actions = [lock, ...ACTIONS]
    .filter((a) => !vehicle.commands || vehicle.commands.includes(a.id))
    .slice(0, 4)
    .map((a) => ({
      ...a,
      url: `${base}?action=${a.id}`,
      target: BACKGROUND.has(a.id) ? `mottokar:${a.id}:${connId}/${vehicle.id}` : undefined,
    }));
  const openCount = s ? [...Object.values(s.doors ?? {}), ...Object.values(s.windows ?? {})].filter((v) => v === "open").length : 0;
  return {
    id: `${connId}/${vehicle.id}`,
    provider: vehicle.providerId,
    vin: vehicle.vin,
    isPinRequired: vehicle.isPinRequired,
    name: vehicle.name,
    isDefault: vehicle.isDefault,
    range: s?.rangeKm != null ? `${Math.round(s.rangeKm)} km` : undefined,
    energy:
      s?.batteryPercent != null
        ? `${Math.round(s.batteryPercent)}% battery`
        : s?.fuelLitres != null
          ? `${Math.round(s.fuelLitres)} L fuel`
          : s?.fuelPercent != null
            ? `${Math.round(s.fuelPercent)}% fuel`
            : undefined,
    isLocked: s?.lock === "locked" ? true : s?.lock === "unlocked" ? false : null,
    warning: s?.warnings?.[0],
    mileage: s?.odometerKm != null ? `${Math.round(s.odometerKm).toLocaleString()} km` : undefined,
    doors: s?.doors || s?.windows ? (openCount ? `${openCount} open` : "All closed") : undefined,
    updated: stored ? `Reported ${new Date(stored.updatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : undefined,
    url: base,
    rangeValue: s?.rangeKm != null ? String(Math.round(s.rangeKm)) : undefined,
    energyValue:
      s?.batteryPercent != null
        ? String(Math.round(s.batteryPercent))
        : s?.fuelLitres != null
          ? String(Math.round(s.fuelLitres))
          : s?.fuelPercent != null
            ? String(Math.round(s.fuelPercent))
            : undefined,
    energyLabel: s?.batteryPercent != null ? "Battery (%)" : s?.fuelLitres != null ? "Fuel (L)" : "Fuel (%)",
    image: vehicle.imageUrl ? cachedImage(vehicle.imageUrl) : undefined,
    timerEndsAt: getCommandTimers(connId, vehicle.id)[0]?.endsAt,
    actions,
    energyFraction: fraction(s, vehicle),
    openings: s?.doors || s?.windows ? openingsText(s) : undefined,
    isAnyOpen: openCount > 0,
    tyres: s?.tyres
      ? {
          fl: kpa(s.tyres.frontLeft),
          fr: kpa(s.tyres.frontRight),
          rl: kpa(s.tyres.rearLeft),
          rr: kpa(s.tyres.rearRight),
        }
      : undefined,
    isTyreWarning: Object.values(s?.tyreWarnings ?? {}).some(Boolean),
  };
}

const kpa = (v?: number) => (v != null ? String(Math.round(v)) : undefined);

function fraction(s: VehicleStatus | undefined, vehicle: Vehicle) {
  const pct = s?.batteryPercent ?? s?.fuelPercent;
  if (pct != null) return Math.max(0, Math.min(1, pct / 100));
  if (s?.fuelLitres != null && vehicle.fuelTankLitres) return Math.max(0, Math.min(1, s.fuelLitres / vehicle.fuelTankLitres));
  return undefined;
}

function openingsText(s: VehicleStatus) {
  const doors = Object.entries(s.doors ?? {}).filter(([, v]) => v === "open").map(([k]) => k);
  const windows = Object.entries(s.windows ?? {}).filter(([, v]) => v === "open").map(([k]) => k);
  const names: Record<string, string> = { trunk: "Boot", hood: "Bonnet", sunroof: "Sunroof" };
  const all = [...doors, ...windows];
  if (!all.length) return "All closed";
  if (all.length === 1) {
    const k = all[0];
    return `${names[k] ?? (windows.includes(k) ? "A window" : "A door")} open`;
  }
  if (!windows.length) return `${doors.length} doors open`;
  if (!doors.length) return `${windows.length} windows open`;
  return `${all.length} open`;
}
