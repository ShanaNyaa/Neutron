import { mkdir, readFile, writeFile } from "node:fs/promises";

/**
 * Coordinates → a short street address, through OpenStreetMap's Nominatim. Its usage policy
 * asks for at most one request a second, an identifying User-Agent and caching, so requests
 * are queued one at a time and every answer is kept in the data volume. Keys are rounded to
 * 4 decimals (about 11 m), so a car parked in the same spot is looked up once.
 */
const ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "Mottokar/1.0 (self-hosted personal car app; https://github.com/ShanaNyaa/mottokar)";
const SPACING_MS = 1100;

type Nominatim = {
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
};

/** "110 Jalan Delima 13, Bandar Bukit Tinggi 3, Klang": number and street, area, town. */
function shortAddress(r: Nominatim) {
  const a = r.address ?? {};
  const street = [a.house_number, a.road ?? a.pedestrian ?? a.footway].filter(Boolean).join(" ");
  // A named place (a shop, a mall) reads better than its street.
  const place = r.name && r.name !== a.road ? r.name : undefined;
  const area = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.residential ?? a.hamlet;
  const town = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county;
  const parts = [place, street, area, town].filter((p, i, all): p is string => !!p && all.indexOf(p) === i);
  return parts.length ? parts.slice(0, 3).join(", ") : (r.display_name?.split(",").slice(0, 3).join(",").trim() ?? null);
}

export function geocoder(dataDir: string) {
  const path = `${dataDir}/geocode.json`;
  let cache: Record<string, string | null> | null = null;
  const pending = new Map<string, Promise<string | null>>();
  let queue: Promise<unknown> = Promise.resolve();
  let lastCall = 0;
  let saveTimer: NodeJS.Timeout | undefined;

  const load = async () => {
    if (cache) return cache;
    try {
      cache = JSON.parse(await readFile(path, "utf8"));
    } catch {
      cache = {};
    }
    return cache!;
  };

  // Writes are batched: a trip list asks for many addresses in a row.
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await mkdir(dataDir, { recursive: true });
      await writeFile(path, JSON.stringify(cache));
    }, 2000);
  };

  const lookup = async (key: string, lat: number, lng: number): Promise<string | null> => {
    const wait = lastCall + SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const url = `${ENDPOINT}?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const address = shortAddress((await res.json()) as Nominatim);
      (await load())[key] = address;
      save();
      return address;
    } catch (e) {
      // Not cached: the next request tries again.
      console.warn(`[geocode] ${key} failed: ${(e as Error).message}`);
      return null;
    }
  };

  return {
    async address(lat: number, lng: number): Promise<string | null> {
      const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
      const known = (await load())[key];
      if (known !== undefined) return known;
      let p = pending.get(key);
      if (!p) {
        p = queue.then(() => lookup(key, Number(lat.toFixed(5)), Number(lng.toFixed(5))));
        queue = p.catch(() => {});
        pending.set(key, p);
        p.finally(() => pending.delete(key));
      }
      return p;
    },
  };
}
