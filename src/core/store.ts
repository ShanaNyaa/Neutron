import { requireOptionalNativeModule } from "expo";
import type { SQLiteDatabase } from "expo-sqlite";
import { Paths } from "expo-file-system";

import { APP_GROUP, isIOS } from "@/core/shared";

import type { Vehicle } from "@/core/types";

// Every call is best-effort: a storage failure must never break the app.

// Loaded lazily: a build made before expo-sqlite was added has no native module, and a
// top-level import would crash it at launch.
const SQLite = (
  requireOptionalNativeModule("ExpoSQLite")
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("expo-sqlite")
    : null
) as typeof import("expo-sqlite") | null;

/** iOS App Group container, so the Siri/Control Center extension can read the cars; undefined uses the default location. */
function sharedDirectory(): string | undefined {
  if (!isIOS) return undefined;
  try {
    const uri = Paths.appleSharedContainers[APP_GROUP]?.uri;
    return uri ? decodeURI(uri.replace(/^file:\/\//, "")) : undefined;
  } catch {
    return undefined;
  }
}

let db: SQLiteDatabase | null = null;
function open() {
  if (db || !SQLite) return db;
  try {
    db = SQLite.openDatabaseSync("garage.db", undefined, sharedDirectory());
    db.execSync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS vehicles (
        conn_id TEXT NOT NULL, vehicle_id TEXT NOT NULL, position INTEGER NOT NULL,
        data TEXT NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (conn_id, vehicle_id)
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        conn_id TEXT NOT NULL, vehicle_id TEXT NOT NULL, kind TEXT NOT NULL,
        data TEXT NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (conn_id, vehicle_id, kind)
      );
    `);
  } catch {
    db = null;
  }
  return db;
}

export type Stored<T> = { data: T; updatedAt: number };
/** `timers`: running timed commands, e.g. a remote start (lib/command-timer.ts). */
export type SnapshotKind = "status" | "location" | "timers";

export function loadVehicles(connId: string): Stored<Vehicle[]> | undefined {
  try {
    const rows = open()?.getAllSync<{ data: string; updated_at: number }>(
      "SELECT data, updated_at FROM vehicles WHERE conn_id = ? ORDER BY position",
      [connId],
    );
    if (!rows?.length) return undefined;
    return { data: rows.map((r) => JSON.parse(r.data) as Vehicle), updatedAt: Math.min(...rows.map((r) => r.updated_at)) };
  } catch {
    return undefined;
  }
}

export function saveVehicles(connId: string, vehicles: Vehicle[]) {
  try {
    const d = open();
    if (!d) return;
    const now = Date.now();
    d.withTransactionSync(() => {
      d.runSync("DELETE FROM vehicles WHERE conn_id = ?", [connId]);
      vehicles.forEach((v, i) =>
        d.runSync("INSERT INTO vehicles (conn_id, vehicle_id, position, data, updated_at) VALUES (?, ?, ?, ?, ?)", [
          connId,
          v.id,
          i,
          JSON.stringify(v),
          now,
        ]),
      );
    });
  } catch {
    // best-effort
  }
}

export function loadSnapshot<T>(connId: string, vehicleId: string, kind: SnapshotKind): Stored<T> | undefined {
  try {
    const row = open()?.getFirstSync<{ data: string; updated_at: number }>(
      "SELECT data, updated_at FROM snapshots WHERE conn_id = ? AND vehicle_id = ? AND kind = ?",
      [connId, vehicleId, kind],
    );
    return row ? { data: JSON.parse(row.data) as T, updatedAt: row.updated_at } : undefined;
  } catch {
    return undefined;
  }
}

export function saveSnapshot(connId: string, vehicleId: string, kind: SnapshotKind, data: unknown) {
  try {
    open()?.runSync(
      "INSERT OR REPLACE INTO snapshots (conn_id, vehicle_id, kind, data, updated_at) VALUES (?, ?, ?, ?, ?)",
      [connId, vehicleId, kind, JSON.stringify(data), Date.now()],
    );
  } catch {
    // best-effort
  }
}

export function allVehicles(): { connId: string; vehicle: Vehicle }[] {
  try {
    const rows = open()?.getAllSync<{ conn_id: string; data: string }>("SELECT conn_id, data FROM vehicles ORDER BY conn_id, position");
    return (rows ?? []).map((r) => ({ connId: r.conn_id, vehicle: JSON.parse(r.data) as Vehicle }));
  } catch {
    return [];
  }
}

export function forgetConnection(connId: string) {
  try {
    const d = open();
    d?.runSync("DELETE FROM vehicles WHERE conn_id = ?", [connId]);
    d?.runSync("DELETE FROM snapshots WHERE conn_id = ?", [connId]);
  } catch {
    // best-effort
  }
}
