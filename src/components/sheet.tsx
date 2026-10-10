import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Keyboard, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  LinearTransition,
  useAnimatedKeyboard,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { Text } from "@/components/text";
import { Icon } from "@/components/ui";

// Opening decelerates into place; closing eases away like a UIKit dismissal, not braking at the edge.
const EASE = Easing.bezier(0.32, 0.72, 0, 1);
const EASE_CLOSE = Easing.inOut(Easing.cubic);
const OPEN_MS = 550;
export const SHEET_CLOSE_MS = 320;

/** How far the app has receded behind an open sheet, 0 to 1. */
const Depth = createContext<SharedValue<number> | null>(null);
const Opened = createContext(false);

/** Focuses once the sheet has opened: autoFocus raises the keyboard mid-slide, which shoves the sheet around. */
export function useSheetFocus<T extends { focus(): void }>() {
  const opened = useContext(Opened);
  const ref = useRef<T>(null);
  useEffect(() => {
    if (opened) ref.current?.focus();
  }, [opened]);
  return ref;
}

/** iOS only: Android resizes the sheet's window for the keyboard. */
function KeyboardHeight({ into }: { into: SharedValue<number> }) {
  const keyboard = useAnimatedKeyboard();
  useAnimatedReaction(
    () => keyboard.height.get(),
    (h) => into.set(h),
  );
  return null;
}

export function SheetProvider({ children }: { children: ReactNode }) {
  const depth = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    borderRadius: depth.get() * 24,
    transform: [{ scale: 1 - depth.get() * 0.07 }],
  }));
  return (
    <Depth.Provider value={depth}>
      <View className="flex-1 bg-black">
        <Animated.View className="flex-1 overflow-hidden" style={style}>
          {children}
        </Animated.View>
      </View>
    </Depth.Provider>
  );
}

/** For a 'transparentModal' route: leaves the route (back by default) once the sheet has slid away. */
export function useRouteSheet() {
  const [leave, setLeave] = useState<(() => void) | null>(null);
  return {
    visible: !leave,
    close: (then: () => void = () => router.back()) => setLeave(() => then),
    onClosed: () => leave?.(),
  };
}

export function Sheet({
  isVisible: visible,
  onClose,
  onClosed,
  onBack,
  title,
  isScrollable: scroll,
  isLarge: large,
  children,
}: {
  isVisible: boolean;
  onClose: () => void;
  onClosed?: () => void;
  onBack?: () => void;
  title: string;
  isScrollable?: boolean;
  isLarge?: boolean;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height: screen } = useWindowDimensions();
  const depth = useContext(Depth);
  // Stays mounted while it slides away.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const [opened, setOpened] = useState(false);
  if (!visible && opened) setOpened(false);
  const progress = useSharedValue(0);
  const height = useSharedValue(screen);
  // Read by the drag handler, which outlives a render: a drag or tap that ends while the sheet is
  // already sliding away must not snap it back open, since nothing would close it again.
  const wanted = useSharedValue(visible);
  const keyboard = useSharedValue(0);
  // The keyboard's final height, set once per show/hide (iOS). Used for layout, where a per-frame
  // value would re-trigger the sheet's layout animation every frame and make it bounce.
  const [keyboardEnd, setKeyboardEnd] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios" || !mounted) return;
    const show = Keyboard.addListener("keyboardWillShow", (e) => setKeyboardEnd(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboardEnd(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [mounted]);
  // The keyboard lift at the moment the sheet started closing (-1 while open). Held for the slide-out,
  // so the keyboard dropping at the same time doesn't yank the sheet down mid-slide.
  const closingLift = useSharedValue(-1);
  // Space above the sheet, below the status bar: how far it can rise for the keyboard. Measured only
  // while the keyboard is down, so the lift doesn't chase the sheet's own keyboard layout.
  const room = useSharedValue(0);
  const [roomNow, setRoomNow] = useState(0);

  useEffect(() => {
    if (!mounted) return;
    wanted.set(visible);
    if (visible) closingLift.set(-1);
    else {
      closingLift.set(Math.min(Math.max(0, keyboard.get() - insets.bottom), room.get()));
      // A focused field would otherwise keep the keyboard up over the screen underneath.
      Keyboard.dismiss();
    }
    progress.set(withTiming(visible ? 1 : 0, { duration: visible ? OPEN_MS : SHEET_CLOSE_MS, easing: visible ? EASE : EASE_CLOSE }, (finished) => {
      if (!finished) return;
      if (visible) return scheduleOnRN(setOpened, true);
      scheduleOnRN(setMounted, false);
      if (onClosed) scheduleOnRN(onClosed);
    }));
  }, [visible, mounted, progress, onClosed, closingLift, keyboard, room, insets.bottom, wanted]);

  useAnimatedReaction(
    () => progress.get(),
    (p, prev) => {
      if (prev != null) depth?.set(p);
    },
  );
  // Unmounted while open (e.g. its screen went away after a delete): bring the app back to size,
  // since the closing animation that normally does it won't run.
  useEffect(
    () => () => {
      if (progress.get() > 0) depth?.set(withTiming(0, { duration: SHEET_CLOSE_MS, easing: EASE_CLOSE }));
    },
    [depth, progress],
  );

  const pan = useMemo(() => {
    // Settles the sheet where it belongs now: open, or on with the close it interrupted.
    const settle = () =>
      progress.set(
        wanted.get()
          ? withTiming(1, { duration: SHEET_CLOSE_MS, easing: EASE })
          : withTiming(0, { duration: SHEET_CLOSE_MS, easing: EASE_CLOSE }, (finished) => {
              if (!finished) return;
              scheduleOnRN(setMounted, false);
              if (onClosed) scheduleOnRN(onClosed);
            }),
      );
    // Only the handle and title row drag the sheet; the content scrolls or presses as usual.
    return PanResponder.create({
      onStartShouldSetPanResponder: () => wanted.get(),
      // A downward drag steals from the close button.
      onMoveShouldSetPanResponderCapture: (_, g) => wanted.get() && g.dy > 6 && g.dy > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (wanted.get()) progress.set(1 - Math.max(0, g.dy) / height.get());
      },
      onPanResponderRelease: (_, g) => {
        if (wanted.get() && (g.dy > height.get() * 0.3 || g.vy > 1)) onClose();
        else settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [onClose, onClosed, progress, height, wanted]);

  const backdrop = useAnimatedStyle(() => ({ opacity: progress.get() * 0.4 }));
  // Lifted by a transform, not layout, so the height layout animation doesn't fight the keyboard.
  // Capped at the status bar; whatever the keyboard still covers becomes scroll padding (`covered`).
  const bottom = insets.bottom;
  const sheet = useAnimatedStyle(() => {
    const held = closingLift.get();
    const lift = held >= 0 ? held : Math.min(Math.max(0, keyboard.get() - bottom), room.get());
    // Travels the lift as well as its own height, so a sheet raised for the keyboard leaves the screen
    // fully instead of stopping short and popping away on unmount.
    return { transform: [{ translateY: (1 - progress.get()) * (height.get() + lift) - lift }] };
  });
  // Whatever the keyboard still covers after the lift becomes scroll padding, in one step.
  const over = Math.max(0, keyboardEnd - bottom);
  const lifted = Math.min(over, roomNow);
  const covered = { height: over - lifted };

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {/* The receded app sits on black, so the status bar turns light over it. */}
      {visible ? <StatusBar style="light" /> : null}
      <Animated.View className="bg-black" style={[StyleSheet.absoluteFill, backdrop]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      {Platform.OS === "ios" ? <KeyboardHeight into={keyboard} /> : null}
      <View className="flex-1 justify-end" style={{ paddingTop: insets.top + 12 }} pointerEvents="box-none">
        <Animated.View
          layout={LinearTransition.duration(300).easing(EASE)}
          onLayout={(e) => {
            height.set(e.nativeEvent.layout.height);
            if (keyboardEnd === 0) {
              const r = e.nativeEvent.layout.y - insets.top - 12;
              room.set(r);
              setRoomNow(r);
            }
          }}
          className="shrink bg-background rounded-t-3xl pt-2 gap-5"
          style={[
            scroll ? undefined : { paddingBottom: insets.bottom + 16 },
            large ? { minHeight: (screen - insets.top - 12) * 0.66 } : undefined,
            sheet,
          ]}
        >
          <View {...pan.panHandlers} className="gap-5 -mt-2 pt-2">
            <View className="self-center w-9 h-1.5 rounded-full bg-foreground/20" />
            <View className="flex-row items-center gap-2 px-5 -mt-2">
              {onBack ? (
                <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Back" className="-ml-1 active:opacity-60">
                  <Icon name="chevron-back" size={22} colorClassName="accent-foreground" />
                </Pressable>
              ) : null}
              <Text className="text-foreground text-lg font-semibold flex-1" numberOfLines={1}>
                {title}
              </Text>
              <Pressable
                onPress={onClose}
                hitSlop={8}
                accessibilityLabel="Close"
                className="size-8 rounded-full bg-foreground/10 items-center justify-center active:opacity-60"
              >
                <Icon name="close" size={18} colorClassName="accent-foreground" />
              </Pressable>
            </View>
          </View>
          {scroll ? (
            <ScrollView
              className="grow-0 shrink"
              // A bounded height, so long content scrolls instead of pushing the sheet past the top. 96 covers the handle
              // and title. Less the lift: once raised for the keyboard, any growth would go over the top.
              style={{ maxHeight: screen - insets.top - 12 - 96 - lifted }}
              contentContainerClassName="px-5 gap-5"
              contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
              keyboardShouldPersistTaps="handled"
            >
              <Opened.Provider value={opened}>{children}</Opened.Provider>
              {/* -mt-5 cancels the content gap, so it takes no room while the keyboard is down. */}
              <View className="-mt-5" style={covered} />
            </ScrollView>
          ) : (
            <View className="px-5 gap-5">
              <Opened.Provider value={opened}>{children}</Opened.Provider>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}
