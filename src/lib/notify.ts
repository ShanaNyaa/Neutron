import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

import { isIOS } from "@/core/shared";
import { useIsAppActive } from "@/lib/app-active";

// Loaded lazily for builds without expo-notifications.
const Notifications = (
  Platform.OS !== "web" && requireOptionalNativeModule("ExpoNotificationPermissionsModule")
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("expo-notifications")
    : null
) as typeof import("expo-notifications") | null;

const CHANNEL = "inbox";

if (Notifications) {
  // Provider messages show as banners even while the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
  });
  if (Platform.OS === "android") {
    Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "Messages from your car brands",
      importance: Notifications.AndroidImportance.HIGH,
    }).catch(() => {});
  }
}

// Opening the app is reading its notifications: clear the ones still in the tray.
useIsAppActive.subscribe((active) => {
  if (active) Notifications?.dismissAllNotificationsAsync().catch(() => {});
});

let asked = false;

/** Asks once, only while undetermined. Never throws. */
export async function askForNotifications() {
  if (!Notifications || asked) return;
  asked = true;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== "undetermined") return;
    await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } });
  } catch {
    // Never let it break the caller.
  }
}

/**
 * Control Center actions report results as notifications (plugins/native/MottokarCore.swift), but an
 * extension can't request the permission itself.
 */
export async function askForResultNotifications() {
  if (isIOS) await askForNotifications();
}

/** Shows it now; `path` is the in-app route opened when it's tapped. */
export async function postNotification(content: { title: string; subtitle?: string; body?: string; path?: string }) {
  if (!Notifications) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: content.title,
        subtitle: content.subtitle,
        body: content.body,
        data: content.path ? { path: content.path } : undefined,
      },
      trigger: Platform.OS === "android" ? { channelId: CHANNEL } : null,
    });
  } catch {
    // Permission denied or the module is missing: nothing to show.
  }
}

/** Opens the route a tapped notification points at. Returns an unsubscribe. */
export function onNotificationOpened(open: (path: string) => void): () => void {
  if (!Notifications) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((res) => {
    const path = res.notification.request.content.data?.path;
    if (typeof path === "string") open(path);
  });
  return () => sub.remove();
}
