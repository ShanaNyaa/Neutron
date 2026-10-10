import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { usePullToRefresh } from "@/lib/refresh";
import { Group, Metric, PanelRow } from "@/components/panel";
import { Text } from "@/components/text";
import { Banner, Empty, Loading, Page } from "@/components/ui";
import { useTrips, useVehicle } from "@/hooks/queries";
import { formatDuration, formatTime, groupByDay } from "@/lib/trips";

export default function TripsScreen() {
  const { connectionId, vehicleId } = useLocalSearchParams<{ connectionId: string; vehicleId: string }>();
  const { vehicle } = useVehicle(connectionId, decodeURIComponent(vehicleId));
  const trips = useTrips(connectionId, vehicle);
  const pull = usePullToRefresh(trips.refetch);
  const list = trips.data ?? [];

  const km = list.reduce((a, t) => a + (t.distanceKm ?? 0), 0);
  const minutes = list.reduce((a, t) => a + (t.durationMin ?? 0), 0);

  return (
    <Page title="Trips" isBackVisible refresh={pull}>
      {trips.error ? <Banner>{(trips.error as Error).message}</Banner> : null}
      {trips.isLoading ? (
        <Loading />
      ) : !list.length ? (
        <Empty icon="map-outline" title="No trips yet" body="Trips the car records will appear here." />
      ) : (
        <>
          <View className="flex-row gap-3">
            <Metric label="Trips" value={list.length} icon="git-branch-outline" />
            <Metric label="Distance" value={Math.round(km).toLocaleString()} unit="km" icon="navigate-outline" />
          </View>
          <View className="flex-row gap-3">
            <Metric label="Driving time" value={formatDuration(minutes)} icon="time-outline" />
            {/* Time-weighted, not a mean of per-trip averages. */}
            <Metric label="Average speed" value={minutes > 0 ? Math.round(km / (minutes / 60)) : null} unit="km/h" icon="speedometer-outline" />
          </View>

          {groupByDay(list).map((g) => (
            <View key={g.key} className="gap-3 mt-3">
              <View className="flex-row items-baseline justify-between px-1">
                <Text className="text-foreground text-base font-semibold">{g.label}</Text>
                <Text className="text-muted text-sm">{g.km.toFixed(1)} km</Text>
              </View>
              <Group>
                {g.trips.map((t) => (
                  <PanelRow
                    key={t.id}
                    icon="navigate-circle-outline"
                    label={formatTime(t.startedAt)}
                    detail={[formatDuration(t.durationMin), t.avgSpeedKmh != null ? `${Math.round(t.avgSpeedKmh)} km/h avg` : null].filter(Boolean).join(", ")}
                    value={t.distanceKm != null ? `${t.distanceKm.toFixed(1)} km` : undefined}
                    onPress={() => router.push(`/vehicle/${connectionId}/${vehicleId}/trip/${encodeURIComponent(t.id)}`)}
                  />
                ))}
              </Group>
            </View>
          ))}
        </>
      )}
    </Page>
  );
}
