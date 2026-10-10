import "../global.css";
// Registers the providers with core before any screen or background task asks for one.
import "@/providers";

import { QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { useResolveClassNames, useUniwind } from "uniwind";

import { SheetProvider } from "@/components/sheet";
import { createQueryClient } from "@/core/query-client";
import { useAppStateFocus } from "@/lib/refresh";
// Also defines the background message check, which has to happen at startup.
import { scheduleNoticeChecks } from "@/lib/notice-alerts";
import { onNotificationOpened } from "@/lib/notify";

// Deep links (widgets, Shortcuts, Control Center) open over the tabs, so Back has somewhere to go.
export const unstable_settings = { anchor: "(tabs)" };

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  useAppStateFocus();
  useEffect(() => {
    scheduleNoticeChecks();
    return onNotificationOpened((path) => router.push(path as never));
  }, []);
  const { theme } = useUniwind();
  const content = useResolveClassNames("bg-background");
  const tint = useResolveClassNames("text-foreground");
  const background = content.backgroundColor as string;
  // Navigators paint the theme's background behind screens (during transitions, before a tab
  // first renders); without this it's React Navigation's white.
  const base = theme === "light" ? DefaultTheme : DarkTheme;
  const navTheme = { ...base, colors: { ...base.colors, background, card: background, text: tint.color as string } };
  // Routes that draw their own sheet (components/sheet.tsx) over the screen they came from.
  const sheetRoute = { presentation: "transparentModal", animation: "none", contentStyle: { backgroundColor: "transparent" } } as const;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="auto" />
      <SheetProvider>
        <ThemeProvider value={navTheme}>
          <Stack
            // Screens draw their own header (components/ui.tsx PageHeader).
            screenOptions={{ headerShown: false, contentStyle: content }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            {/* Edge swipe only: iOS 26's swipe-back from anywhere steals the carousel and switcher drags. */}
            <Stack.Screen name="vehicle/[connectionId]/[vehicleId]/index" options={{ fullScreenGestureEnabled: false }} />
            <Stack.Screen name="connections/add" options={sheetRoute} />
            <Stack.Screen name="connections/new/[providerId]" options={sheetRoute} />
          </Stack>
        </ThemeProvider>
      </SheetProvider>
    </QueryClientProvider>
  );
}
