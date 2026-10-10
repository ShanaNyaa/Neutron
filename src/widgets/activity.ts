import { requireOptionalNativeModule } from "expo";

import { isIOS } from "@/core/shared";
import type { CommandActivityProps } from "@/widgets/command-activity";

// Loaded lazily: builds without expo-widgets (and Android/web) skip it.
const Factory = (
  isIOS && requireOptionalNativeModule("ExpoWidgets")
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("./command-activity").default
    : null
) as typeof import("@/widgets/command-activity").default | null;

type Handle = {
  update(p: Partial<CommandActivityProps>): void;
  /** Keeps it live but marks it stale at `until`. */
  hold(p: Partial<CommandActivityProps>, until: number): void;
  /** Stays on the Lock Screen until dismissed; iOS removes it after 4 h. */
  end(p: Partial<CommandActivityProps>): void;
  /** Ends its timer now, e.g. the command was stopped early. */
  endTimer(): void;
};
const noop: Handle = { update() {}, hold() {}, end() {}, endTimer() {} };

export function startCommandActivity(props: CommandActivityProps): Handle {
  if (!Factory) return noop;
  try {
    // stageAt: when the current stage began, so the activity can fill that step over time.
    const stamp = (next: CommandActivityProps): CommandActivityProps =>
      next.stage !== current?.stage || next.stageAt == null ? { ...next, stageAt: Date.now() } : next;
    let current: CommandActivityProps | undefined;
    current = stamp(props);
    const activity = Factory.start(current);
    return {
      update(p) {
        current = stamp({ ...current!, ...p });
        activity.update(current).catch(() => {});
      },
      hold(p, until) {
        current = stamp({ ...current!, ...p });
        activity.update(current, new Date(until)).catch(() => {});
      },
      end(p) {
        current = stamp({ ...current!, ...p });
        activity.end("default", current).catch(() => {});
      },
      endTimer() {
        if (current?.timer) current = { ...current, timer: { ...current.timer, endsAt: Date.now() } };
        if (current) activity.end("default", current).catch(() => {});
      },
    };
  } catch {
    // Live Activities switched off in Settings, or too many running.
    return noop;
  }
}

// Timed commands' activities, by "<connection>/<vehicle>/<command>", so they can be ended early.
const timedActivities = new Map<string, Handle>();
export function rememberTimedActivity(key: string, handle: Handle) {
  timedActivities.get(key)?.endTimer();
  timedActivities.set(key, handle);
}
export function endTimedActivity(key: string) {
  timedActivities.get(key)?.endTimer();
  timedActivities.delete(key);
}
