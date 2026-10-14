import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { api, ApiError } from "./api.ts";

// A dropped session is handled by signedOutEvent; retrying won't help.
const retry = (count: number, e: Error) => !(e instanceof ApiError && e.signedOut) && count < 2;

export const useVehicles = () => useQuery({ queryKey: ["vehicles"], queryFn: api.vehicles, staleTime: 10 * 60_000, retry });

/** The car's last report. Refetched every minute while the page is visible. */
export const useStatus = (vin?: string) =>
  useQuery({
    queryKey: ["status", vin],
    queryFn: () => api.status(vin!),
    enabled: !!vin,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry,
  });

export const useTrips = (vin?: string) =>
  useQuery({ queryKey: ["trips", vin], queryFn: () => api.trips(vin!), enabled: !!vin, staleTime: 5 * 60_000, retry });

export const useTripTrack = (vin: string | undefined, startedAt?: number, endedAt?: number) =>
  useQuery({
    queryKey: ["track", vin, startedAt, endedAt],
    queryFn: () => api.tripTrack(vin!, startedAt!, endedAt!),
    enabled: !!vin && !!startedAt && !!endedAt,
    staleTime: Infinity,
    retry,
  });

export const useScene = (vin?: string) =>
  useQuery({ queryKey: ["scene", vin], queryFn: () => api.scene(vin!), enabled: !!vin, staleTime: Infinity, retry: false });

export const useDataUsage = (vin?: string) =>
  useQuery({ queryKey: ["data-usage", vin], queryFn: () => api.dataUsage(vin!), enabled: !!vin, staleTime: 30 * 60_000, retry: false });

export const useNotices = () =>
  useQuery({ queryKey: ["notices"], queryFn: api.notices, refetchInterval: 5 * 60_000, staleTime: 60_000, retry });

/**
 * The car takes a while to report a command's effect, so status is refetched now and twice more.
 */
export function useRefreshAfterCommand() {
  const client = useQueryClient();
  return useCallback(
    (vin: string) => {
      const refetch = () => client.invalidateQueries({ queryKey: ["status", vin] });
      refetch();
      setTimeout(refetch, 15_000);
      setTimeout(refetch, 45_000);
    },
    [client],
  );
}

// ---------- Routing ----------
// Hash routes (#/trips/123) keep deep links working without server rewrites.

export type Route = { name: "car" } | { name: "condition" } | { name: "trips"; tripId?: string } | { name: "inbox" } | { name: "settings" };

function parse(hash: string): Route {
  const [, first, second] = hash.replace(/^#/, "").split("/");
  if (first === "trips") return { name: "trips", tripId: second ? decodeURIComponent(second) : undefined };
  if (first === "inbox") return { name: "inbox" };
  if (first === "condition") return { name: "condition" };
  if (first === "settings") return { name: "settings" };
  return { name: "car" };
}

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export function useRoute() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parse(hash);
}

export const href = (route: Route) =>
  route.name === "car" ? "#/" : route.name === "trips" && route.tripId ? `#/trips/${encodeURIComponent(route.tripId)}` : `#/${route.name}`;

export const navigate = (route: Route) => {
  window.location.hash = href(route);
};

// ---------- Misc ----------

/** localStorage that tolerates being unavailable (private mode, blocked storage). */
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // not persisted
    }
  }, [key, value]);
  return [value, setValue] as const;
}

/** Re-renders every `ms` while mounted, for countdowns and "5 min ago" labels. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}
