export type CommandDef = {
  id: string;
  label: string;
  /** Asked before sending. */
  confirm?: string;
  param?: { key: string; label: string; options: { label: string; value: number }[]; default: number };
};

/** Same ids as the server's CONTROLS; a car only shows the ones its capability list allows. */
export const COMMANDS: CommandDef[] = [
  { id: "lock", label: "Lock" },
  { id: "unlock", label: "Unlock", confirm: "Unlock the car?" },
  {
    id: "engine_start",
    label: "Start engine",
    confirm: "Start the engine remotely?",
    // Proton Link's engine dialog choices; the car may refuse others.
    param: { key: "minutes", label: "Run for", default: 10, options: [3, 5, 8, 10].map((m) => ({ label: `${m} min`, value: m })) },
  },
  { id: "engine_stop", label: "Stop engine" },
  {
    id: "climate_on",
    label: "Climate on",
    param: {
      key: "temp",
      label: "Temperature",
      default: 22,
      options: [16, 18, 20, 21, 22, 23, 24, 26, 28].map((t) => ({ label: `${t} °C`, value: t })),
    },
  },
  { id: "climate_off", label: "Climate off" },
  { id: "defrost_on", label: "Defrost" },
  { id: "horn_lights", label: "Honk and flash" },
  { id: "lights", label: "Flash lights" },
  { id: "windows_close", label: "Close windows" },
  { id: "windows_open", label: "Open windows", confirm: "Open all windows?" },
  { id: "sunroof_close", label: "Close sunroof" },
  { id: "trunk_open", label: "Unlock boot", confirm: "Unlock the boot?" },
  { id: "trunk_lock", label: "Lock boot" },
  { id: "charge_start", label: "Start charging" },
  { id: "charge_stop", label: "Stop charging" },
];
