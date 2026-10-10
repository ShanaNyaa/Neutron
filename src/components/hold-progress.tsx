import { useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { useResolveClassNames } from "uniwind";

/** Use as the Pressable's delayLongPress. */
export const HOLD_MS = 450;

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/** Spread onPressIn/onPressOut onto the Pressable. */
export function useHoldProgress(enabled: boolean) {
  // useState initialiser, not a ref: refs can't be read during render.
  const [progress] = useState(() => new Animated.Value(0));
  const onPressIn = () => {
    if (!enabled) return;
    progress.stopAnimation();
    Animated.timing(progress, { toValue: 1, duration: HOLD_MS, easing: Easing.linear, useNativeDriver: false }).start();
  };
  const onPressOut = () => {
    progress.stopAnimation();
    Animated.spring(progress, { toValue: 0, tension: 180, friction: 12, useNativeDriver: false }).start();
  };
  return { progress, onPressIn, onPressOut };
}

/** Overlays its parent; render it last. */
export function HoldProgress({
  progress,
  radius,
  isInverted: inverted,
  isDanger,
}: {
  progress: Animated.Value;
  radius: number;
  isInverted?: boolean;
  isDanger?: boolean;
}) {
  const [box, setBox] = useState<{ w: number; h: number }>();
  const ink = useResolveClassNames(isDanger ? "text-danger" : inverted ? "text-background" : "text-foreground").color as string;
  const SW = 2;

  let rect = null;
  if (box) {
    const w = box.w - SW;
    const h = box.h - SW;
    const r = Math.max(0, Math.min(radius - SW / 2, w / 2, h / 2));
    const perimeter = 2 * (w + h - 4 * r) + 2 * Math.PI * r;
    rect = (
      <Svg width={box.w} height={box.h}>
        <AnimatedRect
          x={SW / 2}
          y={SW / 2}
          width={w}
          height={h}
          rx={r}
          ry={r}
          fill="none"
          stroke={ink}
          strokeWidth={SW}
          strokeDasharray={`${perimeter} ${perimeter}`}
          // Clamped: the spring's overshoot past 0 must not wrap the dash back into view.
          strokeDashoffset={progress.interpolate({ inputRange: [0, 1], outputRange: [perimeter, 0], extrapolate: "clamp" })}
        />
      </Svg>
    );
  }

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {rect}
    </View>
  );
}
