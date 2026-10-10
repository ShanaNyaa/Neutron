import type { CommandId } from "@/core/types";

/** SF Symbols for the well-known commands; a brand's own commands get a car. */
const SYMBOLS: Record<string, string> = {
  lock: "lock.fill",
  unlock: "lock.open.fill",
  climate_on: "fanblades.fill",
  climate_off: "fanblades.slash.fill",
  horn_lights: "speaker.wave.2.fill",
  lights: "headlight.low.beam.fill",
  windows_close: "arrowtriangle.up.square.fill",
  windows_open: "arrowtriangle.down.square.fill",
  trunk_open: "car.side.rear.open.fill",
  engine_start: "power",
  engine_stop: "stop.circle.fill",
};

export const commandSymbol = (id: CommandId) => SYMBOLS[id] ?? "car.fill";
