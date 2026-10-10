import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolveClassNames, useUniwind } from "uniwind";

import { Text } from "@/components/text";
import { Icon, SHADOW, type IconName } from "@/components/ui";

export type ProgressStage = "phone" | "cloud" | "car" | "done" | "queued" | "failed";
export type CommandProgressState = { label: string; stage: ProgressStage; message?: string; failedAt?: 0 | 1 | 2 };

const NODES: { icon: IconName; name: string }[] = [
  { icon: "phone-portrait-outline", name: "Phone" },
  { icon: "cloud-outline", name: "Cloud" },
  { icon: "car-outline", name: "Car" },
];

const REACHED: Record<Exclude<ProgressStage, "failed">, number> = { phone: 0, cloud: 1, car: 2, done: 3, queued: 2 };

const STATUS: Record<Exclude<ProgressStage, "failed">, string> = {
  phone: "Sending to the cloud...",
  cloud: "Waiting for the car...",
  car: "The car received it...",
  done: "Completed.",
  queued: "We have sent the command to the car.",
};

export function CommandProgress({ state }: { state: CommandProgressState | null }) {
  const insets = useSafeAreaInsets();
  const { theme } = useUniwind();
  const page = useResolveClassNames("bg-background").backgroundColor as string;
  const [shown] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(0));
  const [last, setLast] = useState(state);
  if (state && state !== last) setLast(state);

  useEffect(() => {
    Animated.timing(shown, { toValue: state ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [state, shown]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const s = state ?? last;
  if (!s) return null;
  const failed = s.stage === "failed";
  const stage = s.stage as Exclude<ProgressStage, "failed">;
  const reached = failed ? (s.failedAt ?? 1) : REACHED[stage];
  const status = failed ? (s.message ?? "The car couldn’t do that") : (s.message ?? STATUS[stage]);
  const settled = failed || s.stage === "done" || s.stage === "queued";

  return (
    <>
    <Animated.View pointerEvents="none" className="absolute left-0 right-0 bottom-0" style={{ opacity: shown, height: insets.bottom + 150 }}>
      <LinearGradient colors={[`${page}00`, page]} locations={[0, 0.6]} style={StyleSheet.absoluteFill} />
    </Animated.View>
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${s.label}: ${status}`}
      className="absolute left-4 right-4 rounded-3xl"
      style={{
        bottom: insets.bottom + 4,
        opacity: shown,
        transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        ...SHADOW,
      }}
    >
      <View className="rounded-3xl overflow-hidden border border-border p-4 gap-3">
        <BlurView tint={theme === "light" ? "light" : "dark"} intensity={80} style={StyleSheet.absoluteFill} />
        <View className="absolute inset-0 bg-background/85" />
        <View className="flex-row items-center">
          {NODES.map((n, i) => {
            const done = i < reached;
            const active = i === reached && !settled;
            const bad = failed && i === reached;
            return [
              <View key={n.name} className="items-center justify-center">
                {active ? (
                  <Animated.View
                    className="absolute size-12 rounded-full bg-foreground/15"
                    style={{ opacity: pulse, transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] }) }] }}
                  />
                ) : null}
                <View className={`size-10 rounded-full items-center justify-center ${bad ? "bg-danger/15" : done ? "bg-foreground" : "bg-foreground/10"}`}>
                  <Icon
                    name={bad ? "close" : done && i === 2 ? "checkmark" : n.icon}
                    size={18}
                    colorClassName={bad ? "accent-danger" : done ? "accent-background" : active ? "accent-foreground" : "accent-muted"}
                  />
                </View>
              </View>,
              i < NODES.length - 1 ? <Leg key={`${n.name}-line`} isDone={i < reached} isTravelling={i === reached && !settled} /> : null,
            ];
          })}
        </View>
        <View>
          <Text className="text-foreground text-sm font-semibold">{s.label}</Text>
          <Text className={`text-sm ${failed ? "text-danger" : "text-muted"}`} numberOfLines={2}>
            {status}
          </Text>
        </View>
      </View>
    </Animated.View>
    </>
  );
}

function Leg({ isDone: done, isTravelling: travelling }: { isDone: boolean; isTravelling: boolean }) {
  const [width, setWidth] = useState(0);
  const [fill] = useState(() => new Animated.Value(done ? 1 : 0));
  const [flow] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(fill, { toValue: done ? 1 : 0, duration: done ? 320 : 0, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [done, fill]);

  useEffect(() => {
    if (!travelling) return;
    flow.setValue(0);
    const loop = Animated.loop(Animated.timing(flow, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [travelling, flow]);

  const segment = width * 0.35;
  return (
    <View className="flex-1 h-0.5 mx-2 rounded-full bg-foreground/10 overflow-hidden" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {travelling && width ? (
        <Animated.View
          className="absolute top-0 bottom-0 left-0 rounded-full bg-foreground/60"
          style={{ width: segment, transform: [{ translateX: flow.interpolate({ inputRange: [0, 1], outputRange: [-segment, width] }) }] }}
        />
      ) : null}
      {width ? (
        <Animated.View
          className="absolute top-0 bottom-0 left-0 bg-foreground"
          style={{
            width,
            transform: [
              { translateX: fill.interpolate({ inputRange: [0, 1], outputRange: [-width / 2, 0] }) },
              { scaleX: fill },
            ],
          }}
        />
      ) : null}
    </View>
  );
}
