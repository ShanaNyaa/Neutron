import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { withUniwind } from "uniwind";

import { mapsAvailable, TripMap } from "@/components/location-map";
import { Group, Inset, Metric, PanelRow } from "@/components/panel";
import { Text } from "@/components/text";
import { Empty, Page } from "@/components/ui";
import { useTrips, useTripTrack, useVehicle } from "@/hooks/queries";
import { dayLabel, formatDuration, formatTime } from "@/lib/trips";

const Spinner = withUniwind(ActivityIndicator);

export default function TripScreen() {
  const { connectionId, vehicleId, tripId } = useLocalSearchParams<{ connectionId: string; vehicleId: string; tripId: string }>();
  const { vehicle } = useVehicle(connectionId, decodeURIComponent(vehicleId));
  const trips = useTrips(connectionId, vehicle);
  const trip = trips.data?.find((t) => t.id === decodeURIComponent(tripId));
  const track = useTripTrack(connectionId, vehicle, trip);

  if (!trip)
    return (
      <Page title="Trip" isBackVisible>
        <Empty icon="map-outline" title={trips.isLoading ? "Loading trip..." : "Trip not found"} />
      </Page>
    );

  const hasRoute = (track.data?.length ?? 0) > 1 || (trip.start && trip.end);

  return (
    <>
      <Page title={`${dayLabel(trip.startedAt)}, ${formatTime(trip.startedAt)}`} isBackVisible>
        {mapsAvailable ? (
          <Inset className="p-0 overflow-hidden h-80">
            {track.isLoading ? (
              <View className="flex-1 items-center justify-center">
                <Spinner colorClassName="accent-muted" />
              </View>
            ) : hasRoute ? (
              <TripMap track={track.data ?? []} start={trip.start} end={trip.end} />
            ) : (
              <View className="flex-1 items-center justify-center px-6">
                <Text className="text-muted text-sm text-center">No route was recorded for this trip.</Text>
              </View>
            )}
          </Inset>
        ) : null}

        <View className="flex-row gap-3">
          <Metric label="Distance" value={trip.distanceKm != null ? trip.distanceKm.toFixed(1) : null} unit="km" icon="navigate-outline" />
          <Metric label="Duration" value={formatDuration(trip.durationMin)} icon="time-outline" />
        </View>
        {trip.avgSpeedKmh != null ? <Metric label="Average speed" value={Math.round(trip.avgSpeedKmh)} unit="km/h" icon="speedometer-outline" /> : null}

        <Group>
          <PanelRow icon="radio-button-on-outline" label="Started" value={formatTime(trip.startedAt)} />
          {trip.endedAt ? <PanelRow icon="flag-outline" label="Ended" value={formatTime(trip.endedAt)} /> : null}
          {track.data && track.data.length > 1 ? <PanelRow icon="analytics-outline" label="GPS points" value={String(track.data.length)} /> : null}
        </Group>
      </Page>
    </>
  );
}
