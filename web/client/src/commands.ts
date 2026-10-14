import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Fan,
  Lightbulb,
  Lock,
  LockOpen,
  type LucideIcon,
  Megaphone,
  PackageOpen,
  Package,
  Power,
  PowerOff,
  Snowflake,
  SunSnow,
  Wind,
  Zap,
  ZapOff,
} from "lucide-react";

export type CommandParam = { key: string; label: string; options: { label: string; value: number }[]; default: number; unit?: string };

// Proton Link's run-time choices for engine start and climate; the car may refuse others.
const RUN_TIME: CommandParam = { key: "minutes", label: "Run for", default: 10, unit: "min", options: [3, 5, 8, 10].map((m) => ({ label: `${m} min`, value: m })) };

export type CommandDef = {
  id: string;
  label: string;
  icon: LucideIcon;
  group: "doors" | "engine" | "climate" | "windows" | "find" | "charging";
  /** Asked before sending; the car does this in a public place. */
  confirm?: string;
  /** Asked for in the confirmation sheet, in order. */
  params?: CommandParam[];
};

/** Same ids as the server's CONTROLS. A car shows only the ones its capability list allows. */
export const COMMANDS: CommandDef[] = [
  { id: "lock", label: "Lock", icon: Lock, group: "doors" },
  { id: "unlock", label: "Unlock", icon: LockOpen, group: "doors", confirm: "Unlock the car?" },
  { id: "trunk_open", label: "Unlock boot", icon: PackageOpen, group: "doors", confirm: "Unlock the boot?" },
  { id: "trunk_lock", label: "Lock boot", icon: Package, group: "doors" },
  {
    id: "engine_start",
    label: "Start engine",
    icon: Power,
    group: "engine",
    confirm: "Start the engine remotely?",
    params: [RUN_TIME],
  },
  { id: "engine_stop", label: "Stop engine", icon: PowerOff, group: "engine" },
  {
    id: "climate_on",
    label: "Climate on",
    icon: Snowflake,
    group: "climate",
    params: [
      { key: "temp", label: "Temperature", default: 22, unit: "°C", options: [17, 18, 19, 20, 21, 22, 23, 24, 26, 28].map((t) => ({ label: `${t}°`, value: t })) },
      // Minutes, like engine start: tested on an S70, where 3 ran the climate for three minutes.
      RUN_TIME,
    ],
  },
  { id: "climate_off", label: "Climate off", icon: Fan, group: "climate" },
  { id: "defrost_on", label: "Defrost", icon: SunSnow, group: "climate" },
  { id: "windows_close", label: "Close windows", icon: ArrowUpFromLine, group: "windows" },
  { id: "windows_open", label: "Open windows", icon: ArrowDownToLine, group: "windows", confirm: "Open all windows?" },
  { id: "ventilate", label: "Ventilate", icon: Wind, group: "windows", confirm: "Open the windows slightly to let air in?" },
  { id: "sunroof_close", label: "Close sunroof", icon: ArrowUpFromLine, group: "windows" },
  { id: "horn_lights", label: "Honk and flash", icon: Megaphone, group: "find" },
  { id: "lights", label: "Flash lights", icon: Lightbulb, group: "find" },
  { id: "charge_start", label: "Start charging", icon: Zap, group: "charging" },
  { id: "charge_stop", label: "Stop charging", icon: ZapOff, group: "charging" },
];

export const GROUPS: { id: CommandDef["group"]; label: string }[] = [
  { id: "doors", label: "Doors" },
  { id: "engine", label: "Engine" },
  { id: "climate", label: "Climate" },
  { id: "windows", label: "Windows" },
  { id: "find", label: "Find my car" },
  { id: "charging", label: "Charging" },
];

export const commandById = (id: string) => COMMANDS.find((c) => c.id === id);
