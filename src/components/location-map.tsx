import { requireOptionalNativeModule } from "expo";
import { Platform, StyleSheet } from "react-native";
import { useUniwind } from "uniwind";

import type { Coordinate } from "@/core/types";

/**
 * expo-maps throws at import time when its native module isn't in the binary
 * (Expo Go, or a dev build made before it was added), so load it lazily.
 */
export const mapsAvailable = requireOptionalNativeModule("ExpoMaps") != null;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppleMaps, GoogleMaps } = (mapsAvailable ? require("expo-maps") : {}) as typeof import("expo-maps");

type Props = { latitude: number; longitude: number; title?: string };

/** Gestures are off on Android; iOS has no switch for them, so the caller must overlay it. */
export function LocationMap({ latitude, longitude, title }: Props) {
  const { theme } = useUniwind();
  if (!mapsAvailable) return null;
  const dark = theme === "dark";
  const coordinates = { latitude, longitude };
  const cameraPosition = { coordinates, zoom: 15 };

  if (Platform.OS === "ios") {
    return (
      <AppleMaps.View
        style={StyleSheet.absoluteFill}
        cameraPosition={cameraPosition}
        colorScheme={dark ? AppleMaps.MapColorScheme.DARK : AppleMaps.MapColorScheme.LIGHT}
        markers={[{ coordinates, title, systemImage: "car.fill" }]}
        uiSettings={{ compassEnabled: false, scaleBarEnabled: false, myLocationButtonEnabled: false, togglePitchEnabled: false }}
      />
    );
  }

  return (
    <GoogleMaps.View
      style={StyleSheet.absoluteFill}
      cameraPosition={cameraPosition}
      colorScheme={dark ? GoogleMaps.MapColorScheme.DARK : GoogleMaps.MapColorScheme.LIGHT}
      markers={[{ coordinates, title }]}
      uiSettings={{
        compassEnabled: false,
        mapToolbarEnabled: false,
        myLocationButtonEnabled: false,
        zoomControlsEnabled: false,
        scrollGesturesEnabled: false,
        zoomGesturesEnabled: false,
        rotationGesturesEnabled: false,
        tiltGesturesEnabled: false,
      }}
    />
  );
}

export function TripMap({ track, start, end }: { track: Coordinate[]; start?: Coordinate; end?: Coordinate }) {
  const { theme } = useUniwind();
  if (!mapsAvailable) return null;
  const dark = theme === "dark";
  const line = track.length > 1 ? track : [start, end].filter((c): c is Coordinate => !!c);
  const from = start ?? line[0];
  const to = end ?? line[line.length - 1];
  const points = line.length ? line : [from, to].filter((c): c is Coordinate => !!c);
  if (!points.length) return null;

  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const center = { latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2 };
  const span = Math.max(maxLat - minLat, (maxLng - minLng) * Math.cos((center.latitude * Math.PI) / 180), 0.002);
  const zoom = Math.min(16, Math.max(3, Math.log2(360 / (span * 1.8))));
  const cameraPosition = { coordinates: center, zoom };

  const color = dark ? "#f5f6f8" : "#0b0d12";
  const polylines = line.length > 1 ? [{ id: "route", coordinates: line, color, width: 4 }] : [];

  if (Platform.OS === "ios") {
    return (
      <AppleMaps.View
        style={StyleSheet.absoluteFill}
        cameraPosition={cameraPosition}
        colorScheme={dark ? AppleMaps.MapColorScheme.DARK : AppleMaps.MapColorScheme.LIGHT}
        polylines={polylines}
        markers={[
          ...(from ? [{ id: "start", coordinates: from, title: "Start", systemImage: "circle.fill" }] : []),
          ...(to ? [{ id: "end", coordinates: to, title: "Finish", systemImage: "flag.checkered" }] : []),
        ]}
        uiSettings={{ compassEnabled: false, scaleBarEnabled: false, myLocationButtonEnabled: false, togglePitchEnabled: false }}
      />
    );
  }

  return (
    <GoogleMaps.View
      style={StyleSheet.absoluteFill}
      cameraPosition={cameraPosition}
      colorScheme={dark ? GoogleMaps.MapColorScheme.DARK : GoogleMaps.MapColorScheme.LIGHT}
      polylines={polylines}
      markers={[...(from ? [{ id: "start", coordinates: from, title: "Start" }] : []), ...(to ? [{ id: "end", coordinates: to, title: "Finish" }] : [])]}
      uiSettings={{ compassEnabled: false, mapToolbarEnabled: false, myLocationButtonEnabled: false, zoomControlsEnabled: false }}
    />
  );
}
