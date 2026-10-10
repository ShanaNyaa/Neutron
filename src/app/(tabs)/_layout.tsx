import type { BottomTabBarProps } from "expo-router/tabs";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Tabs } from "expo-router";
import { LucideBell, LucideCar, LucideLink2, LucideSettings2 } from "lucide-react-native";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PanResponder, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, makeMutable, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolveClassNames, useUniwind, withUniwind } from "uniwind";

import { SHADOW } from "@/components/ui";
import { useAllNotices, useNoticeWatch } from "@/hooks/queries";

const TABS = {
  index: { icon: withUniwind(LucideCar), label: "Garage" },
  inbox: { icon: withUniwind(LucideBell), label: "Inbox" },
  connections: { icon: withUniwind(LucideLink2), label: "Connections" },
  settings: { icon: withUniwind(LucideSettings2), label: "Settings" },
} as const;

const tabDirection = makeMutable(0);

function CustomTabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useUniwind();
  const { notices } = useAllNotices();
  useNoticeWatch();
  const unread = notices.some((n) => !n.isRead);
  const page = useResolveClassNames("bg-background").backgroundColor as string;

  const count = state.routes.length;
  const [bar, setBar] = useState({ x: 0, width: 0 });
  const slot = (bar.width - 12) / count;
  const pos = useSharedValue(state.index);
  const held = useSharedValue(0);
  const hover = useSharedValue(state.index);
  useEffect(() => {
    pos.set(withTiming(state.index, { duration: 300, easing: Easing.bezier(0.32, 0.72, 0, 1) }));
    hover.set(state.index);
  }, [state.index, pos, hover]);

  const { open, scrub } = useMemo(() => {
    const open = (index: number) => {
      const route = state.routes[index];
      if (Platform.OS === "ios") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
      if (index === state.index || event.defaultPrevented) return;
      tabDirection.set(index > state.index ? 1 : -1);
      navigateToTab(route.key);
    };
    const scrub = PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => held.set(withTiming(1, { duration: 150 })),
      onPanResponderMove: (_, g) => {
        const i = Math.min(count - 1, Math.max(0, (g.moveX - bar.x - 6) / slot - 0.5));
        pos.set(i);
        if (Math.round(i) !== hover.get()) {
          hover.set(Math.round(i));
          Haptics.selectionAsync();
        }
      },
      onPanResponderRelease: () => {
        held.set(withTiming(0, { duration: 150 }));
        const i = hover.get();
        pos.set(withTiming(i, { duration: 200 }));
        open(i);
      },
      onPanResponderTerminate: () => {
        held.set(withTiming(0, { duration: 150 }));
        pos.set(withTiming(state.index, { duration: 200 }));
      },
    });
    return { open, scrub };
  }, [count, bar.x, slot, state, emitter, navigateToTab, pos, held, hover]);
  const pill = useAnimatedStyle(() => ({
    width: slot,
    transform: [{ translateX: pos.get() * slot }, { scale: 1 + held.get() * 0.06 }],
  }));

  return (
    <>
    <LinearGradient
      pointerEvents="none"
      colors={[`${page}00`, page]}
      locations={[0, 0.75]}
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: insets.bottom + 72 }}
    />
    <View
      {...scrub.panHandlers}
      onLayout={(e) => setBar({ x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width })}
      className="absolute left-4 right-4 rounded-full"
      style={{ bottom: insets.bottom + 4, ...SHADOW }}
    >
      <View className="flex-row rounded-full overflow-hidden p-1.5 border border-border">
        <BlurView tint={theme === "light" ? "light" : "dark"} intensity={80} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View pointerEvents="none" className="absolute inset-0 bg-background/85" />
        {bar.width ? <Animated.View pointerEvents="none" className="absolute top-1.5 bottom-1.5 left-1.5 rounded-full bg-foreground/15" style={pill} /> : null}

        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const tab = TABS[route.name as keyof typeof TABS];
          if (!tab) return null;
          const Icon = tab.icon;
          return (
            <Pressable
              key={route.key}
              onPress={() => open(index)}
              onLongPress={() => emitter.emit({ type: "tabLongPress", target: route.key })}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={route.name === "inbox" && unread ? `${tab.label}, unread messages` : tab.label}
              className="flex-1 h-14 items-center justify-center rounded-full active:opacity-70"
            >
              <View>
                <Icon size={24} strokeWidth={focused ? 2.2 : 1.8} colorClassName={focused ? "accent-foreground" : "accent-muted"} />
                {route.name === "inbox" && unread ? (
                  <View className="absolute -top-1 -right-1.5 size-2 rounded-full bg-foreground" />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
    </>
  );
}

let tabsShown = false;

type TabNavigation = {
  getState(): { index: number; routes: { key: string }[] };
  addListener(event: "state", listener: () => void): () => void;
};

// The tab's own selection, not useIsFocused: that also goes false under a route pushed over the
// tabs, so the tab behind a transparent sheet would reset. Follows the navigator's state events:
// the screen layout itself isn't re-rendered on every tab switch.
function TabScene({ navigation, routeKey, children }: { navigation: TabNavigation; routeKey: string; children: ReactNode }) {
  const t = useSharedValue(tabsShown ? 0 : 1);
  useEffect(() => {
    tabsShown = true;
    let wasSelected: boolean | undefined;
    const apply = () => {
      const { routes, index } = navigation.getState();
      const isSelected = routes[index]?.key === routeKey;
      if (isSelected === wasSelected) return;
      wasSelected = isSelected;
      if (isSelected) t.set(withTiming(1, { duration: 260, easing: Easing.bezier(0.32, 0.72, 0, 1) }));
      else t.set(0);
    };
    apply();
    return navigation.addListener("state", apply);
  }, [navigation, routeKey, t]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.4 + 0.6 * t.get(),
    transform: [{ translateX: (1 - t.get()) * tabDirection.get() * 24 }],
  }));
  return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>;
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
      screenLayout={({ route, navigation, children }) => (
        <TabScene navigation={navigation as unknown as TabNavigation} routeKey={route.key}>
          {children}
        </TabScene>
      )}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="connections" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
