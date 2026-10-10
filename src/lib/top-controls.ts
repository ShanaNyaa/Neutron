import { create } from "zustand";
import { persist } from "zustand/middleware";

import { persistStorage } from "@/core/secure-kv";
import type { CommandId } from "@/core/types";

/** A control in the vehicle screen's grid: a toggle pair, the climate sheet, or a single command. */
export type TileId = "lock" | "engine" | "climate" | "windows" | "charge" | "trunk" | CommandId;

export const DEFAULT_TILES: TileId[] = ["lock", "engine", "climate"];
/** With More, up to two full rows of four. */
export const MAX_TILES = 7;

/** The user's pick per vehicle, keyed "<connection>/<vehicle>". */
const useStore = create<{ tiles: Record<string, TileId[]> }>()(
  persist((): { tiles: Record<string, TileId[]> } => ({ tiles: {} }), { name: "pref.topControls", storage: persistStorage }),
);

export const useTopControls = (vehicleKey: string) => useStore((s) => s.tiles[vehicleKey]) ?? DEFAULT_TILES;

export function setTopControls(vehicleKey: string, tiles: TileId[]) {
  useStore.setState((s) => ({ tiles: { ...s.tiles, [vehicleKey]: tiles.slice(0, MAX_TILES) } }));
}
