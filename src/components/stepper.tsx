import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, interpolate, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { Text } from "@/components/text";
import { Icon, type IconName } from "@/components/ui";

/** Formats a stepper value: "22°" for degrees, "10 min" for other units. */
export function formatStep(value: number, unit?: string) {
  const n = value % 1 ? value.toFixed(1) : String(value);
  if (!unit) return n;
  return unit.startsWith("°") ? `${n}°` : `${n} ${unit}`;
}

/** − value + with round buttons; the one number picker in the app (climate, command params). */
export function Stepper({
  value,
  unit,
  min = -Infinity,
  max = Infinity,
  step = 1,
  decreaseLabel = "Decrease",
  increaseLabel = "Increase",
  onChange,
}: {
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  decreaseLabel?: string;
  increaseLabel?: string;
  onChange: (value: number) => void;
}) {
  const nudge = (d: number) => {
    Haptics.selectionAsync();
    onChange(Math.min(max, Math.max(min, Math.round((value + d) * 10) / 10)));
  };
  return (
    <View className="flex-row items-center justify-center gap-6">
      <StepButton icon="remove" label={decreaseLabel} onPress={() => nudge(-step)} isDisabled={value <= min} />
      <RollingText text={formatStep(value, unit)} value={value} />
      <StepButton icon="add" label={increaseLabel} onPress={() => nudge(step)} isDisabled={value >= max} />
    </View>
  );
}

function StepButton({ icon, label, onPress, isDisabled: disabled }: { icon: IconName; label: string; onPress: () => void; isDisabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityLabel={label}
      className={`size-12 rounded-full bg-foreground/10 items-center justify-center active:opacity-60 ${disabled ? "opacity-30" : ""}`}
    >
      <Icon name={icon} size={22} colorClassName="accent-foreground" />
    </Pressable>
  );
}

const ROLL = { duration: 340, easing: Easing.bezier(0.2, 0.9, 0.25, 1) };
const LINE = 56;
// How far a digit travels as it leaves or arrives, and how much it shrinks on the way out.
const SHIFT = LINE * 0.38;
const SHRINK = 0.1;
// Characters that appear or go (the ".5"), and the others gliding to make room.
const GLIDE = LinearTransition.duration(ROLL.duration).easing(ROLL.easing);
const APPEAR = FadeIn.duration(220).delay(80);
const VANISH = FadeOut.duration(140);
const TEXT = "text-foreground text-5xl font-semibold";
// Every digit the same width, so the number doesn't shift as digits change.
const FIGURES = { lineHeight: LINE, fontVariant: ["tabular-nums" as const] };

/**
 * The value changes like SwiftUI's numericText transition: in each place that changed, the old digit
 * lifts away and fades while the new one rises in (the other way when the value goes down).
 * Unchanged digits, "." and "°" stay put.
 */
function RollingText({ text, value }: { text: string; value: number }) {
  // Which way the last change went, updated during render when the value changes.
  const [last, setLast] = useState<{ value: number; direction: 1 | -1 }>({ value, direction: 1 });
  if (value !== last.value) setLast({ value, direction: value > last.value ? 1 : -1 });
  const direction = value !== last.value ? (value > last.value ? 1 : -1) : last.direction;

  const chars = [...text];
  // Keyed from the decimal point, so whole-number digits keep their identity when ".5" comes or goes.
  const point = chars.findIndex((c) => !/\d/.test(c));
  const whole = point < 0 ? chars.length : point;
  const keyOf = (c: string, i: number) => (i < whole ? `w${whole - i}` : /\d/.test(c) ? `f${i - whole}` : c);
  return (
    // Wide enough for "22.5°", so the − and + buttons never move.
    <View className="flex-row justify-center w-40" accessible accessibilityLabel={text} accessibilityLiveRegion="polite">
      {chars.map((c, i) => (
        <Animated.View key={keyOf(c, i)} layout={GLIDE} entering={APPEAR} exiting={VANISH}>
          {/\d/.test(c) ? (
            <Digit digit={c} direction={direction} />
          ) : (
            <Text className={TEXT} style={FIGURES}>
              {c}
            </Text>
          )}
        </Animated.View>
      ))}
    </View>
  );
}

function Digit({ digit, direction }: { digit: string; direction: 1 | -1 }) {
  // The digit shown, the one leaving, and which way they move; `turn` restarts the animation.
  const [shown, setShown] = useState({ current: digit, previous: null as string | null, direction, turn: 0 });
  if (digit !== shown.current) setShown({ current: digit, previous: shown.current, direction, turn: shown.turn + 1 });

  const t = useSharedValue(1);
  useEffect(() => {
    if (shown.turn === 0) return;
    t.set(0);
    t.set(withTiming(1, ROLL));
  }, [shown.turn, t]);

  const dir = shown.direction;
  // Staggered: the old digit is mostly gone before the new one shows, so they never smear together.
  const incoming = useAnimatedStyle(() => ({
    opacity: interpolate(t.get(), [0.25, 1], [0, 1], "clamp"),
    transform: [{ translateY: (1 - t.get()) * dir * SHIFT }, { scale: 1 - (1 - t.get()) * SHRINK }],
  }));
  const outgoing = useAnimatedStyle(() => ({
    opacity: interpolate(t.get(), [0, 0.55], [1, 0], "clamp"),
    transform: [{ translateY: -t.get() * dir * SHIFT }, { scale: 1 - t.get() * SHRINK }],
  }));

  return (
    <View>
      <Animated.View style={incoming}>
        <Text className={TEXT} style={FIGURES}>
          {shown.current}
        </Text>
      </Animated.View>
      {shown.previous != null ? (
        <Animated.View style={[StyleSheet.absoluteFill, outgoing]} pointerEvents="none">
          <Text className={`${TEXT} text-center`} style={FIGURES}>
            {shown.previous}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}
