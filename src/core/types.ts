export type Vehicle = {
  /** Stable id within its connection (usually the VIN). */
  id: string;
  vin?: string;
  name: string;
  /** Stamped by the app from its connection. */
  providerId?: string;
  model?: string;
  color?: string;
  imageUrl?: string;
  gallery?: string[];
  isDefault?: boolean;
  /** When set, overrides each command's `isPinRequired` for this vehicle. */
  isPinRequired?: boolean;
  /** The owner's pick, else the factory paint. */
  paintCode?: string;
  factoryPaintCode?: string;
  fuelTankLitres?: number;
  /** Unset means all of the provider's commands. */
  commands?: CommandId[];
};

export type TyrePosition = "frontLeft" | "frontRight" | "rearLeft" | "rearRight";
export type OpenState = "open" | "closed" | "unknown";
export type LockState = "locked" | "unlocked" | "unknown";

/** Layers draw back to front; one without `when` is always drawn. */
export type VehicleSceneLayer = { uri: string; when?: (status: VehicleStatus) => boolean };
export type VehicleSceneAngle = { id: string; label: string; aspectRatio: number; layers: VehicleSceneLayer[] };
export type VehicleScene = { angles: VehicleSceneAngle[] };

export type VehicleStatus = {
  updatedAt?: number;
  lock?: LockState;
  isParkingBrakeOn?: boolean;
  /** 0-100 */
  fuelPercent?: number;
  /** For providers that report volume instead of a percentage. */
  fuelLitres?: number;
  /** 0-100 */
  batteryPercent?: number;
  isCharging?: boolean;
  isChargePortOpen?: boolean;
  rangeKm?: number;
  odometerKm?: number;
  isEngineOn?: boolean;
  climate?: { isOn: boolean; cabinTempC?: number; outsideTempC?: number; targetTempC?: number };
  doors?: Partial<Record<"frontLeft" | "frontRight" | "rearLeft" | "rearRight" | "trunk" | "hood", OpenState>>;
  /** Trunk latch lock, separate from whether it is open. */
  isTrunkLocked?: boolean;
  windows?: Partial<Record<"frontLeft" | "frontRight" | "rearLeft" | "rearRight" | "sunroof", OpenState>>;
  /** kPa */
  tyres?: Partial<Record<TyrePosition, number>>;
  /** As reported by the car, not derived from `tyres`. */
  tyreWarnings?: Partial<Record<TyrePosition, boolean>>;
  batteryVoltage?: number;
  avgFuelLPer100km?: number;
  avgSpeedKmh?: number;
  /** Live faults worth a chip: open doors, tyre pressure, a low 12V battery. Not maintenance. */
  warnings?: string[];
  /** Km until the next service; negative means overdue. */
  serviceDueKm?: number;
  serviceDueDays?: number;
};

export type PaintOption = { code: string; name: string; swatch?: string };

/** The car's built-in mobile data plan. */
export type DataUsage = { usedBytes?: number; remainingBytes?: number };

export type VehicleLocation = {
  latitude: number;
  longitude: number;
  address?: string;
  updatedAt?: number;
};

export type Trip = {
  id: string;
  startedAt: number;
  endedAt?: number;
  distanceKm?: number;
  durationMin?: number;
  avgSpeedKmh?: number;
  start?: Coordinate;
  end?: Coordinate;
};

export type Coordinate = { latitude: number; longitude: number };

export type Notice = {
  id: string;
  title: string;
  body?: string;
  createdAt: number;
  isRead?: boolean;
  /** Picks the icon; unset is a general message. */
  kind?: NoticeKind;
};

/** `command`: the receipt for a remote command; shown in the inbox, never as a notification. */
export type NoticeKind = "security" | "service" | "command";

/** Well-known commands; providers may add their own ids too. */
export type CommandId =
  | "lock"
  | "unlock"
  | "climate_on"
  | "climate_off"
  | "horn_lights"
  | "lights"
  | "windows_close"
  | "windows_open"
  | "trunk_open"
  | "engine_start"
  | "engine_stop"
  | (string & {});

export type CommandDefinition = {
  id: CommandId;
  label: string;
  /** Ionicons name */
  icon: string;
  isPinRequired?: boolean;
  isDestructive?: boolean;
  /** It keeps running after it's sent (a remote start, a timed climate run); the app counts it down. */
  timer?: {
    /** Param holding the run time in minutes; `minutes` when unset. */
    param?: string;
    /** When the param isn't sent. */
    defaultMinutes?: number;
    /** Shown while it runs, e.g. "Engine running". One line in the Live Activity: a countdown shows beside it. */
    running: string;
    /** Shown once it has ended, e.g. "Engine off" */
    ended: string;
    /** Ends it early, e.g. `engine_stop`. */
    stoppedBy?: CommandId;
    /** false once the car reports it stopped, e.g. `(s) => s.isEngineOn`. */
    isRunning?: (status: VehicleStatus) => boolean | undefined;
  };
  params?: {
    key: string;
    label: string;
    type: "number" | "choice";
    min?: number;
    max?: number;
    step?: number;
    default?: number | string;
    options?: { label: string; value: string | number }[];
    unit?: string;
  }[];
};

export type CommandResult = {
  isOk: boolean;
  message?: string;
  requestId?: string;
  /** The car reported the outcome; unset means only the cloud accepted it. */
  isConfirmed?: boolean;
};
