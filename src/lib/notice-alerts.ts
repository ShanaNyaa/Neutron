import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

import { useConnections, type Connection } from "@/core/connections";
import * as kv from "@/core/secure-kv";
import type { Notice } from "@/core/types";
import { log, logError } from "@/lib/log";
import { postNotification } from "@/lib/notify";

/**
 * Turns new provider messages into notifications. Every fetch of a connection's notices goes
 * through `alertNewNotices`: the in-app list, a provider's live push (ProviderClient.watchNotices)
 * and the periodic background check below.
 */

const SEEN_MAX = 300;
const seenKey = (connId: string) => `notices.seen.${connId}`;

// One at a time per connection, so overlapping fetches can't alert the same message twice.
const queues = new Map<string, Promise<void>>();

export function alertNewNotices(conn: Connection, notices: Notice[]) {
  const next = (queues.get(conn.id) ?? Promise.resolve()).then(() => alert(conn, notices)).catch(() => {});
  queues.set(conn.id, next);
  return next;
}

async function alert(conn: Connection, notices: Notice[]) {
  const raw = await kv.getItem(seenKey(conn.id)).catch(() => null);
  // The first fetch only records what's there: old messages aren't news.
  const seen = raw ? new Set(JSON.parse(raw) as string[]) : null;
  const unseen = notices.filter((n) => !seen?.has(n.id));
  if (seen && !unseen.length) return;
  const ids = [...new Set([...notices.map((n) => n.id), ...(seen ?? [])])].slice(0, SEEN_MAX);
  await kv.setItem(seenKey(conn.id), JSON.stringify(ids));
  if (!seen) return;
  // Command receipts are seen in the app as the command runs; alerting them again is noise.
  const fresh = unseen.filter((n) => !n.isRead && n.kind !== "command").sort((a, b) => a.createdAt - b.createdAt);
  // A backlog (e.g. after days offline) becomes one summary instead of a burst.
  if (fresh.length > 3) {
    await postNotification({ title: conn.label, body: `${fresh.length} new messages`, path: "/inbox" });
    return;
  }
  for (const n of fresh) await postNotification({ title: n.title, subtitle: conn.label, body: n.body, path: "/inbox" });
}

// A removed connection's record goes with it.
useConnections.subscribe((s, prev) => {
  for (const c of prev.connections) {
    if (s.connections.some((x) => x.id === c.id)) continue;
    queues.delete(c.id);
    kv.removeItem(seenKey(c.id)).catch(() => {});
  }
});

// Background checks. Loaded lazily for builds without the native modules.
const TASK = "notice-check";
const Background = (
  Platform.OS !== "web" && requireOptionalNativeModule("ExpoBackgroundTask") && requireOptionalNativeModule("ExpoTaskManager")
    ? {
        /* eslint-disable @typescript-eslint/no-require-imports */
        task: require("expo-background-task") as typeof import("expo-background-task"),
        manager: require("expo-task-manager") as typeof import("expo-task-manager"),
        /* eslint-enable @typescript-eslint/no-require-imports */
      }
    : null
);

/** The background check, run now; for the Simulator. */
export async function checkAll() {
  // A background launch starts with an empty store; wait for it to load.
  if (!useConnections.getState().isReady) {
    await new Promise<void>((resolve) => {
      const off = useConnections.subscribe((s) => s.isReady && (off(), resolve()));
    });
  }
  const { connections, getClient } = useConnections.getState();
  await Promise.all(
    connections
      .filter((c) => !c.isReauthRequired)
      .map(async (c) => {
        const client = await getClient(c.id);
        if (client.getNotices) await alertNewNotices(c, await client.getNotices());
      }),
  );
}

// Must run at import, before the OS hands a background launch to the task.
Background?.manager.defineTask(TASK, async () => {
  try {
    await checkAll();
    return Background.task.BackgroundTaskResult.Success;
  } catch (e) {
    logError("app", `Background message check failed: ${(e as Error)?.message ?? String(e)}`, e);
    return Background.task.BackgroundTaskResult.Failed;
  }
});

/** Checks for messages every so often while the app is closed; the OS picks the exact times. */
export async function scheduleNoticeChecks() {
  if (!Background) return;
  try {
    if ((await Background.task.getStatusAsync()) !== Background.task.BackgroundTaskStatus.Available) return;
    if (await Background.manager.isTaskRegisteredAsync(TASK)) return;
    await Background.task.registerTaskAsync(TASK, { minimumInterval: 30 });
    log("app", "Scheduled background message checks");
  } catch (e) {
    logError("app", `Couldn’t schedule background message checks: ${(e as Error)?.message ?? String(e)}`, e);
  }
}
