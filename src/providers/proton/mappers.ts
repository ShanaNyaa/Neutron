import type { Coordinate, LockState, OpenState, Trip, Vehicle, VehicleStatus } from "@/core/types";

/** Atlas `basic/user/vehicle/list` item. */
export type AtlasVehicleInfo = {
  vin: string;
  userId?: string;
  vehicleName?: string;
  plateNo?: string;
  customPlateNo?: string;
  vehicleModelUrl?: string;
  isDefault?: boolean;
  enablePin?: boolean;
  setPinStatus?: boolean;
  matCode?: string;
  matName?: string;
  modelCode?: string;
  modelName?: string;
  brandName?: string;
  bodyColorCode?: string;
  topColorCode?: string;
};

/** Atlas `iot/function/getVehicleStatus` (only the fields we use; most are strings). */
export type AtlasVehicleStatus = Partial<{
  updateTime: number;
  latitude: string;
  longitude: string;
  direction: string;
  speed: string;
  engineStatus: string;
  electricParkBrakeStatus: string;
  aveFuelConsumption: string;
  avgSpeed: string;
  handBrakeStatus: string;
  fuelLevel: string;
  distanceToEmpty: number;
  distanceToEmptyOnBatteryOnly: number;
  powerBatteryLevel: number;
  chargerState: number;
  odometer: string;
  distanceToService: string;
  daysToService: string;
  centralLockingStatus: number;
  doorOpenStatusLeftFront: number;
  doorOpenStatusLeftRear: number;
  doorOpenStatusRightFront: number;
  doorOpenStatusRightRear: number;
  doorLockStatusLeftFront: number;
  doorLockStatusLeftRear: number;
  doorLockStatusRightFront: number;
  doorLockStatusRightRear: number;
  trunkOpenStatus: number;
  trunkLockStatus: number;
  engineHoodOpenStatus: number;
  winStatusLeftFront: number;
  winStatusLeftRear: number;
  winStatusRightFront: number;
  winStatusRightRear: number;
  sunroofOpenStatus: number;
  dcOrAcDcChargeLidStatus: number;
  preClimateActive: string;
  airConditionTemperature: number;
  interiorTemp: string;
  exteriorTemp: string;
  tyreStatusLeftFront: number;
  tyreStatusLeftRear: number;
  tyreStatusRightFront: number;
  tyreStatusRightRear: number;
  tyrePreWarningLeftFront: number;
  tyrePreWarningLeftRear: number;
  tyrePreWarningRightFront: number;
  tyrePreWarningRightRear: number;
}> &
  Record<string, unknown>;

export type AtlasTrip = Partial<{
  avgSpeed: string | number;
  tripUseMiles: string | number;
  tripUseTimes: string;
  tripPowerCns: string | number;
  tripStartTime: number;
  tripEndTime: number;
  tripStartLatitude: string | number;
  tripStartLongitude: string | number;
  tripEndLatitude: string | number;
  tripEndLongitude: string | number;
}>;

const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// Status codes arrive as strings ("2").
const int = (v: unknown): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// Code tables from acosdk VehicleStatus helpers: null means "normal".
const door = (v: unknown): OpenState => (int(v) == null || int(v) === 2 ? "closed" : "open");
const hatch = door;
const win = (v: unknown): OpenState => (int(v) == null || int(v) === 0 ? "closed" : "open");
const doorLocked = (v: unknown) => {
  const n = int(v);
  return n == null || n === 2 || n === 3;
};

function lockState(s: AtlasVehicleStatus): LockState {
  // Mirrors VehicleStatus.isLocked(): only the four door-lock fields count (2, 3 or absent =
  // locked); centralLockingStatus is ignored, since the SDK treats its value 1 as "not locked".
  const locked = [
    s.doorLockStatusLeftFront,
    s.doorLockStatusLeftRear,
    s.doorLockStatusRightFront,
    s.doorLockStatusRightRear,
  ].every(doorLocked);
  return locked ? "locked" : "unlocked";
}

// Tyre units aren't documented in the app; values below ~10 are almost certainly bar.
const kpa = (v: unknown) => {
  const n = num(v);
  if (n == null || n <= 0) return undefined;
  return n < 10 ? n * 100 : n;
};

const tyreWarn = (v: unknown) => (int(v) != null ? int(v) !== 0 : undefined);

const positive = (n?: number) => (n != null && n > 0 ? n : undefined);
const nonzero = (n?: number) => (n != null && n !== 0 ? n : undefined);

const CHARGING = new Set([2, 5, 15, 24, 28, 30]);

export function mapStatus(s: AtlasVehicleStatus): VehicleStatus {
  const doors = {
    frontLeft: door(s.doorOpenStatusLeftFront),
    frontRight: door(s.doorOpenStatusRightFront),
    rearLeft: door(s.doorOpenStatusLeftRear),
    rearRight: door(s.doorOpenStatusRightRear),
    trunk: hatch(s.trunkOpenStatus),
    hood: hatch(s.engineHoodOpenStatus),
  };
  const windows = {
    frontLeft: win(s.winStatusLeftFront),
    frontRight: win(s.winStatusRightFront),
    rearLeft: win(s.winStatusLeftRear),
    rearRight: win(s.winStatusRightRear),
    sunroof: win(s.sunroofOpenStatus),
  };
  const label = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();

  const warnings: string[] = [];
  Object.entries(doors).forEach(([k, v]) => v === "open" && warnings.push(`${label(k === "hood" ? "bonnet" : k)} open`));
  Object.entries(windows).forEach(([k, v]) => v === "open" && warnings.push(`${label(k)} open`));
  (["LeftFront", "RightFront", "LeftRear", "RightRear"] as const).forEach((pos) => {
    const w = int(s[`tyrePreWarning${pos}`]);
    if (w != null && w !== 0) warnings.push(`Tyre pressure: ${label(pos).toLowerCase()}`);
  });

  const battery = num(s.powerBatteryLevel);
  // MainStatusUtils: electricParkBrakeStatus "1" means engaged.
  const parkingBrake = s.electricParkBrakeStatus != null ? s.electricParkBrakeStatus === "1" : undefined;
  const lock = lockState(s);
  return {
    updatedAt: num(s.updateTime),
    lock,
    isParkingBrakeOn: parkingBrake,
    // fuelLevel is litres, not %: the Proton app clamps it to 0.5-172, and range fits
    // litres (274 km on 23 L is ~8 L/100km; on 23% of a ~47 L tank it would be ~4).
    fuelLitres: num(s.fuelLevel),
    batteryPercent: battery != null && battery > 0 ? Math.min(100, battery) : undefined,
    isCharging: int(s.chargerState) != null ? CHARGING.has(int(s.chargerState)!) : undefined,
    isChargePortOpen: int(s.dcOrAcDcChargeLidStatus) != null ? hatch(s.dcOrAcDcChargeLidStatus) === "open" : undefined,
    rangeKm: num(s.distanceToEmpty) ?? num(s.distanceToEmptyOnBatteryOnly),
    odometerKm: num(s.odometer),
    // 0 means no data yet.
    avgFuelLPer100km: positive(num(s.aveFuelConsumption)),
    avgSpeedKmh: positive(num(s.avgSpeed)),
    // Inverted: "0" means running.
    isEngineOn: s.engineStatus != null ? s.engineStatus === "0" : undefined,
    climate: {
      isOn: s.preClimateActive === "true",
      cabinTempC: num(s.interiorTemp),
      outsideTempC: num(s.exteriorTemp),
      // 0 while climate is off.
      targetTempC: positive(num(s.airConditionTemperature)),
    },
    doors,
    // VehicleStatus.java: trunkLockStatus 2 = locked. Often unreported (null means "normal");
    // the trunk then follows the central locking.
    isTrunkLocked:
      int(s.trunkLockStatus) != null ? int(s.trunkLockStatus) === 2 : lock === "locked" ? true : lock === "unlocked" ? false : undefined,
    windows,
    tyres: {
      frontLeft: kpa(s.tyreStatusLeftFront),
      frontRight: kpa(s.tyreStatusRightFront),
      rearLeft: kpa(s.tyreStatusLeftRear),
      rearRight: kpa(s.tyreStatusRightRear),
    },
    tyreWarnings: {
      frontLeft: tyreWarn(s.tyrePreWarningLeftFront),
      frontRight: tyreWarn(s.tyrePreWarningRightFront),
      rearLeft: tyreWarn(s.tyrePreWarningLeftRear),
      rearRight: tyreWarn(s.tyrePreWarningRightRear),
    },
    warnings,
    // "0" is the car's "not set" (as with airConditionTemperature), reported after a service until
    // the next interval is programmed; only a negative value means overdue.
    serviceDueKm: nonzero(num(s.distanceToService)),
    serviceDueDays: nonzero(num(s.daysToService)),
  };
}

export function mapVehicle(v: AtlasVehicleInfo, imageUrl?: string): Vehicle {
  return {
    id: v.vin,
    vin: v.vin,
    name: v.vehicleName?.trim() || "Proton",
    // A raw model code, e.g. P380-1.5-7DCT2WD-P-MH0.
    model: v.modelName ?? v.matName,
    imageUrl: imageUrl ?? (looksLikeImage(v.vehicleModelUrl) ? v.vehicleModelUrl : undefined),
    isDefault: v.isDefault,
    isPinRequired: !!v.enablePin,
    fuelTankLitres: tankFor(v),
  };
}

/**
 * Proton never reports the tank size. Matched on the marketing name or the project code at
 * the start of modelName.
 */
const TANKS: [RegExp, number][] = [
  [/\bS70\b|^P380/i, 50],
];

function tankFor(v: AtlasVehicleInfo) {
  const names = [v.matName, v.modelName, v.vehicleName].filter(Boolean).join(" ");
  return TANKS.find(([re]) => re.test(names) || re.test(v.modelName ?? ""))?.[1];
}

const looksLikeImage = (u?: string) => !!u && /^https?:\/\/.+\.(png|jpe?g|webp)(\?|$)/i.test(u);

/**
 * Trip durations come back as milliseconds (e.g. "2059502" for an 11.3 km trip at
 * 20 km/h, i.e. ~34 min), occasionally as "hh:mm(:ss)". Returned in minutes.
 */
function minutes(v?: string) {
  if (!v) return undefined;
  if (v.includes(":")) {
    const [h, m, s] = v.split(":").map(Number);
    return h * 60 + (m || 0) + (s || 0) / 60;
  }
  const ms = num(v);
  return ms != null ? ms / 60_000 : undefined;
}

/** (0, 0) means no fix. */
export function coord(lat: unknown, lng: unknown): Coordinate | undefined {
  const latitude = num(lat);
  const longitude = num(lng);
  if (latitude == null || longitude == null || (latitude === 0 && longitude === 0)) return undefined;
  return { latitude, longitude };
}

export function mapTrip(t: AtlasTrip, i: number): Trip | null {
  const start = num(t.tripStartTime);
  if (start == null) return null;
  const end = num(t.tripEndTime);
  return {
    id: `${start}-${i}`,
    startedAt: start,
    endedAt: end,
    distanceKm: num(t.tripUseMiles),
    durationMin: minutes(t.tripUseTimes) ?? (end ? (end - start) / 60_000 : undefined),
    avgSpeedKmh: num(t.avgSpeed),
    start: coord(t.tripStartLatitude, t.tripStartLongitude),
    end: coord(t.tripEndLatitude, t.tripEndLongitude),
  };
}
