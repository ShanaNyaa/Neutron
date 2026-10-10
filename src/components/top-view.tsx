import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { useResolveClassNames } from "uniwind";

import type { VehicleScene, VehicleStatus } from "@/core/types";

export function TopView({ scene, status, size }: { scene?: VehicleScene | null; status?: VehicleStatus; size: number }) {
  // undefined: still loading, so hold the space rather than flash the outline. null: no renders.
  if (scene === undefined) return <View style={{ width: size, height: size }} />;
  const angle = scene?.angles.find((a) => a.id === "top");
  if (!angle) return <Outline size={size} />;
  const s = status ?? {};
  return (
    <View style={{ width: size, height: size }}>
      {angle.layers
        .filter((l) => !l.when || l.when(s))
        .map((l, i) => (
          <Image
            key={l.uri}
            source={l.uri}
            contentFit="contain"
            transition={i === 0 ? 150 : 0}
            cachePolicy="disk"
            style={StyleSheet.absoluteFill}
          />
        ))}
    </View>
  );
}

/** Where the wheels are, as fractions of the top view: centre lines down, outer edges across. */
export const WHEELS = { frontY: 0.245, rearY: 0.745, leftX: 0.26, rightX: 0.74 };
const WHEEL = { width: 4, height: 13 };

function Outline({ size }: { size: number }) {
  const body = useResolveClassNames("bg-surface-2").backgroundColor as string;
  const line = useResolveClassNames("bg-border").backgroundColor as string;
  const glass = useResolveClassNames("bg-foreground").backgroundColor as string;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {[WHEELS.leftX * 100, WHEELS.rightX * 100 - WHEEL.width].flatMap((x) =>
        [WHEELS.frontY, WHEELS.rearY].map((y) => (
          <Rect key={`${x}${y}`} x={x} y={y * 100 - WHEEL.height / 2} width={WHEEL.width} height={WHEEL.height} rx={1.5} fill={glass} opacity={0.5} />
        )),
      )}
      <Rect x={29} y={6} width={42} height={88} rx={16} fill={body} stroke={line} strokeWidth={0.8} />
      <Rect x={34} y={27} width={32} height={12} rx={4} fill={glass} opacity={0.75} />
      <Rect x={36} y={42} width={28} height={30} rx={3} fill={glass} opacity={0.12} />
      <Rect x={35} y={76} width={30} height={7} rx={3} fill={glass} opacity={0.6} />
    </Svg>
  );
}
