import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import { getProvider } from "@/core/registry";
import { useIsAppActive } from "@/lib/app-active";
import { useConnections, type Connection } from "@/core/connections";
import * as store from "@/core/store";
import { log, logError } from "@/lib/log";
import { alertNewNotices } from "@/lib/notice-alerts";
import { syncWidgets } from "@/widgets/sync";
import { ProviderError, type CommandOptions, type ProviderClient } from "@/core/provider";
import type { CommandId, Coordinate, Notice, PaintOption, Trip, Vehicle, VehicleLocation, VehicleStatus } from "@/core/types";

export const keys = {
  vehicles: (connId: string) => ["vehicles", connId] as const,
  status: (connId: string, vehicleId: string) => ["status", connId, vehicleId] as const,
  location: (connId: string, vehicleId: string) => ["location", connId, vehicleId] as const,
  trips: (connId: string, vehicleId: string) => ["trips", connId, vehicleId] as const,
  notices: (connId: string) => ["notices", connId] as const,
};

function useCall() {
  const { getClient, updateConnection } = useConnections(useShallow((s) => ({ getClient: s.getClient, updateConnection: s.updateConnection })));
  return async <T,>(connId: string, fn: (c: ProviderClient) => Promise<T>): Promise<T> => {
    try {
      return await fn(await getClient(connId));
    } catch (e) {
      if (e instanceof ProviderError && e.isReauthRequired) await updateConnection(connId, { isReauthRequired: true });
      throw e;
    }
  };
}

/** A connection's vehicles, stamped with its provider. The stored copy keeps cars visible when the session expires. */
function vehiclesQuery(connId: string, providerId: string | undefined, call: ReturnType<typeof useCall>) {
  return {
    queryKey: keys.vehicles(connId),
    queryFn: () =>
      call(connId, (client) => client.listVehicles())
        .then((list) => list.map((v) => ({ ...v, providerId })))
        .then((v) => (store.saveVehicles(connId, v), syncWidgets(), v)),
    initialData: () => store.loadVehicles(connId)?.data,
    initialDataUpdatedAt: () => store.loadVehicles(connId)?.updatedAt,
    staleTime: 5 * 60_000,
  };
}

export type GarageVehicle = { connection: Connection; vehicle: Vehicle };

export function useGarage() {
  const { connections, ready } = useConnections(useShallow((s) => ({ connections: s.connections, ready: s.isReady })));
  const call = useCall();
  const results = useQueries({
    queries: connections.map((c) => ({ ...vehiclesQuery(c.id, c.providerId, call), enabled: ready && !c.isReauthRequired })),
  });
  const vehicles: GarageVehicle[] = [];
  results.forEach((r, i) => r.data?.forEach((vehicle) => vehicles.push({ connection: connections[i], vehicle })));
  const errors = results
    // A dead session already surfaces as isReauthRequired; don't also report the error that caused it.
    .map((r, i) => (r.error && !connections[i].isReauthRequired ? { connection: connections[i], error: r.error as Error } : null))
    .filter((x): x is { connection: Connection; error: Error } => !!x);
  return {
    vehicles,
    errors,
    isLoading: !ready || results.some((r) => r.isLoading),
    isRefetching: results.some((r) => r.isRefetching),
    refetch: () => Promise.all(results.map((r) => r.refetch())),
  };
}

export function useVehicle(connId: string, vehicleId: string) {
  const { connections, ready } = useConnections(useShallow((s) => ({ connections: s.connections, ready: s.isReady })));
  const call = useCall();
  const connection = connections.find((c) => c.id === connId);
  const q = useQuery({ ...vehiclesQuery(connId, connection?.providerId, call), enabled: !!connection && !connection.isReauthRequired });
  return {
    connection,
    provider: connection ? getProvider(connection.providerId) : undefined,
    vehicle: q.data?.find((v) => v.id === vehicleId),
    // Until the saved connections have loaded, a missing car isn't missing yet.
    loading: !ready || q.isLoading,
    query: q,
  };
}

export function useVehicleStatus(connId: string, vehicle?: Vehicle, { live = false } = {}) {
  const call = useCall();
  const isFocused = useIsFocused();
  return useQuery({
    queryKey: keys.status(connId, vehicle?.id ?? ""),
    queryFn: () =>
      call(connId, (c) => (c.getStatus ? c.getStatus(vehicle!) : Promise.resolve<VehicleStatus>({}))).then((st) => {
        store.saveSnapshot(connId, vehicle!.id, "status", st);
        syncWidgets();
        return st;
      }),
    initialData: () => (vehicle ? store.loadSnapshot<VehicleStatus>(connId, vehicle.id, "status")?.data : undefined),
    initialDataUpdatedAt: () => (vehicle ? store.loadSnapshot(connId, vehicle.id, "status")?.updatedAt : undefined),
    enabled: !!vehicle,
    refetchInterval: live ? 10_000 : 60_000,
    // Stop polling while the screen is in the background of the stack.
    subscribed: isFocused,
  });
}

export function useVehicleLocation(connId: string, vehicle?: Vehicle) {
  const call = useCall();
  const isFocused = useIsFocused();
  return useQuery({
    queryKey: keys.location(connId, vehicle?.id ?? ""),
    queryFn: () =>
      call(connId, (c) => (c.getLocation ? c.getLocation(vehicle!) : Promise.resolve<VehicleLocation | null>(null))).then((loc) => {
        if (loc) store.saveSnapshot(connId, vehicle!.id, "location", loc);
        return loc;
      }),
    initialData: () => (vehicle ? store.loadSnapshot<VehicleLocation>(connId, vehicle.id, "location")?.data : undefined),
    initialDataUpdatedAt: () => (vehicle ? store.loadSnapshot(connId, vehicle.id, "location")?.updatedAt : undefined),
    enabled: !!vehicle,
    subscribed: isFocused,
  });
}

export function useVehicleScene(connId: string, vehicle?: Vehicle) {
  const call = useCall();
  return useQuery({
    queryKey: ["scene", connId, vehicle?.id ?? ""],
    queryFn: () => call(connId, (c) => (c.getScene ? c.getScene(vehicle!) : Promise.resolve(null))),
    enabled: !!vehicle,
    staleTime: 24 * 3600_000,
    gcTime: 24 * 3600_000,
  });
}

export function useDataUsage(connId: string, vehicle?: Vehicle) {
  const call = useCall();
  return useQuery({
    queryKey: ["data-usage", connId, vehicle?.id ?? ""],
    queryFn: () => call(connId, (c) => (c.getDataUsage ? c.getDataUsage(vehicle!) : Promise.resolve(null))),
    enabled: !!vehicle,
    staleTime: 3600_000,
  });
}

export function usePaints(connId: string, vehicle: Vehicle | undefined, enabled: boolean) {
  const call = useCall();
  return useQuery({
    queryKey: ["paints", connId, vehicle?.id ?? ""],
    // null: this connection can't list paints (as opposed to [] = the model has no others).
    queryFn: () => call(connId, (c) => (c.getPaints ? c.getPaints(vehicle!) : Promise.resolve<PaintOption[] | null>(null))),
    enabled: enabled && !!vehicle,
    staleTime: 24 * 3600_000,
  });
}

export function useSetPaint(connId: string, vehicle?: Vehicle) {
  const call = useCall();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string | null) =>
      call(connId, async (c) => {
        if (!c.setPaint) throw new Error("This connection cannot change the car colour");
        await c.setPaint(vehicle!, code);
      }),
    // Vehicles first: the scene is built from the updated vehicle.
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.vehicles(connId) });
      await qc.invalidateQueries({ queryKey: ["scene", connId, vehicle?.id ?? ""] });
    },
  });
}

export function useTrips(connId: string, vehicle?: Vehicle) {
  const call = useCall();
  return useQuery({
    queryKey: keys.trips(connId, vehicle?.id ?? ""),
    queryFn: () => call(connId, (c) => (c.getTrips ? c.getTrips(vehicle!) : Promise.resolve<Trip[]>([]))),
    enabled: !!vehicle,
  });
}

export function useTripTrack(connId: string, vehicle?: Vehicle, trip?: Trip) {
  const call = useCall();
  return useQuery({
    queryKey: ["trip-track", connId, vehicle?.id ?? "", trip?.id ?? ""],
    queryFn: () => call(connId, (c) => (c.getTripTrack ? c.getTripTrack(vehicle!, trip!) : Promise.resolve<Coordinate[]>([]))),
    enabled: !!vehicle && !!trip,
    staleTime: Infinity,
  });
}

export function useAllNotices() {
  const connections = useConnections((s) => s.connections);
  const call = useCall();
  const results = useQueries({
    queries: connections.map((c) => ({
      queryKey: keys.notices(c.id),
      queryFn: async () => {
        const list = await call(c.id, (client) => (client.getNotices ? client.getNotices() : Promise.resolve<Notice[]>([])));
        alertNewNotices(c, list);
        return list;
      },
      enabled: !c.isReauthRequired,
    })),
  });
  return {
    notices: results
      .flatMap((r, i) => (r.data ?? []).map((n) => ({ ...n, connection: connections[i] })))
      .sort((a, b) => b.createdAt - a.createdAt),
    isLoading: results.some((r) => r.isLoading),
    refetch: () => Promise.all(results.map((r) => r.refetch())),
  };
}

/** While the app is open, refetches a connection's notices whenever its provider pushes something. */
export function useNoticeWatch() {
  const ids = useConnections((s) =>
    s.connections
      .filter((c) => !c.isReauthRequired)
      .map((c) => c.id)
      .join(","),
  );
  const getClient = useConnections((s) => s.getClient);
  const qc = useQueryClient();
  const active = useIsAppActive();
  useEffect(() => {
    if (!active || !ids) return;
    let cancelled = false;
    const stops: (() => void)[] = [];
    for (const id of ids.split(",")) {
      getClient(id)
        .then((client) => {
          if (cancelled || !client.watchNotices) return;
          stops.push(client.watchNotices(() => qc.invalidateQueries({ queryKey: keys.notices(id) })));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      stops.forEach((stop) => stop());
    };
  }, [active, ids, getClient, qc]);
}

export function useMarkNoticesRead(connId: string) {
  const call = useCall();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notices: Notice[]) =>
      call(connId, async (c) => {
        if (!c.markNoticeRead) return;
        await Promise.all(notices.map((n) => c.markNoticeRead!(n)));
      }),
    onMutate: (notices) => {
      const ids = new Set(notices.map((n) => n.id));
      qc.setQueryData<Notice[]>(keys.notices(connId), (old) => old?.map((n) => (ids.has(n.id) ? { ...n, isRead: true } : n)));
    },
    onError: () => qc.invalidateQueries({ queryKey: keys.notices(connId) }),
  });
}

export function useRenameVehicle(connId: string, vehicle?: Vehicle) {
  const call = useCall();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      call(connId, (c) => {
        if (!c.renameVehicle) throw new Error("This connection cannot rename vehicles");
        return c.renameVehicle(vehicle!, name.trim());
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.vehicles(connId) }),
  });
}

export function useSavedPin(connId: string) {
  const call = useCall();
  return () => call(connId, (c) => (c.savedPin ? c.savedPin() : Promise.resolve(null))).catch(() => null);
}

export function useSendCommand(connId: string, vehicle?: Vehicle) {
  const call = useCall();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ command, ...options }: CommandOptions & { command: CommandId }) => {
      log("command", `Send ${command}`, { vehicle: vehicle?.id, params: options.params });
      try {
        const res = await call(connId, (c) => {
          if (!c.sendCommand) throw new Error("This connection does not support remote commands");
          return c.sendCommand(vehicle!, command, options);
        });
        log("command", `${command}: ${res.isOk ? (res.message ?? "ok") : `failed, ${res.message ?? "no reason given"}`}`, res, res.isOk ? "info" : "error");
        return res;
      } catch (e) {
        logError("command", `${command} failed: ${(e as Error).message}`);
        throw e;
      }
    },
    onSuccess: (res) => {
      const refresh = () => qc.invalidateQueries({ queryKey: keys.status(connId, vehicle?.id ?? "") });
      if (res.isConfirmed) return refresh();
      // Only queued: no signal when the car acts, so poll across the 40 s command window.
      for (const ms of [4_000, 15_000, 30_000, 45_000]) setTimeout(refresh, ms);
    },
  });
}
