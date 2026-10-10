import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";

import { CommandProgress, type CommandProgressState } from "@/components/command-progress";
import { Group, PanelRow } from "@/components/panel";
import { Page, Section, type IconName } from "@/components/ui";
import { log } from "@/lib/log";
import { checkAll } from "@/lib/notice-alerts";
import { askForNotifications, postNotification } from "@/lib/notify";
import { startCommandActivity } from "@/widgets/activity";
import type { CommandActivityProps } from "@/widgets/command-activity";

/** Plays every state of the command UI without sending anything to a car. */

const CAR = "Simulated car";
const TIMER = { running: "Engine running", ended: "Engine off" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Activity = ReturnType<typeof startCommandActivity>;

const ACTIVITY_STATES: { label: string; icon: IconName; props: Omit<CommandActivityProps, "car">; until?: () => number }[] = [
  { label: "Sending to the cloud", icon: "cloud-upload-outline", props: { label: "Lock", symbol: "lock.fill", stage: "cloud" } },
  { label: "Waiting for the car", icon: "car-outline", props: { label: "Lock", symbol: "lock.fill", stage: "car" } },
  { label: "Done", icon: "checkmark-circle-outline", props: { label: "Lock", symbol: "lock.fill", stage: "done", message: "Locked" } },
  { label: "Sent, not confirmed", icon: "paper-plane-outline", props: { label: "Lock", symbol: "lock.fill", stage: "queued" } },
  {
    label: "Failed",
    icon: "close-circle-outline",
    props: { label: "Start Engine", symbol: "power", stage: "failed", message: "Remote start limit reached. Drive the car once, then try again." },
  },
  {
    label: "Countdown (2 min)",
    icon: "timer-outline",
    props: { label: "Start Engine", symbol: "power", stage: "done" },
    until: () => Date.now() + 2 * 60_000,
  },
  {
    label: "Countdown ended",
    icon: "stop-circle-outline",
    props: { label: "Start Engine", symbol: "power", stage: "done" },
    until: () => Date.now() - 1000,
  },
];

const PROGRESS_STATES: { label: string; icon: IconName; state: CommandProgressState }[] = [
  { label: "On the phone", icon: "phone-portrait-outline", state: { label: "Lock", stage: "phone" } },
  { label: "Sent to the cloud", icon: "cloud-outline", state: { label: "Lock", stage: "cloud" } },
  { label: "Reached the car", icon: "car-outline", state: { label: "Lock", stage: "car" } },
  { label: "Done", icon: "checkmark-circle-outline", state: { label: "Lock", stage: "done" } },
  { label: "Sent, not confirmed", icon: "paper-plane-outline", state: { label: "Lock", stage: "queued" } },
  {
    label: "Failed before the cloud",
    icon: "cloud-offline-outline",
    state: { label: "Lock", stage: "failed", message: "No internet connection", failedAt: 1 },
  },
  {
    label: "Refused by the car",
    icon: "close-circle-outline",
    state: { label: "Start Engine", stage: "failed", message: "Remote start limit reached.", failedAt: 2 },
  },
];

export default function Debug() {
  const activity = useRef<Activity | null>(null);
  const [progress, setProgress] = useState<CommandProgressState | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(hide.current), []);

  const startActivity = (props: Omit<CommandActivityProps, "car">, until?: number) => {
    activity.current?.end({});
    const timer = until != null ? { startedAt: Date.now(), endsAt: until, ...TIMER } : undefined;
    const a = startCommandActivity({ car: CAR, ...props, timer });
    if (timer) a.hold({ timer }, Math.max(until!, Date.now()));
    activity.current = a;
    Haptics.selectionAsync();
    log("app", `Simulated Live Activity: ${props.stage}${timer ? " with a countdown" : ""}`);
    return a;
  };

  const playActivity = async (countdown: boolean) => {
    const a = startActivity({ label: countdown ? "Start Engine" : "Lock", symbol: countdown ? "power" : "lock.fill", stage: "cloud" });
    await wait(1500);
    a.update({ stage: "car" });
    await wait(2500);
    if (!countdown) return a.end({ stage: "done", message: "Locked" });
    const endsAt = Date.now() + 60_000;
    a.hold({ stage: "done", timer: { startedAt: Date.now(), endsAt, ...TIMER } }, endsAt);
  };

  const showProgress = (state: CommandProgressState) => {
    clearTimeout(hide.current);
    setProgress(state);
    // Final states clear themselves, like after a real command.
    if (state.stage === "done" || state.stage === "queued" || state.stage === "failed") {
      hide.current = setTimeout(() => setProgress((p) => (p === state ? null : p)), 2500);
    }
  };

  const playProgress = async () => {
    for (const stage of ["phone", "cloud", "car"] as const) {
      showProgress({ label: "Lock", stage });
      await wait(1200);
    }
    showProgress({ label: "Lock", stage: "done" });
  };

  const notify = async (content: Parameters<typeof postNotification>[0]) => {
    await askForNotifications();
    await postNotification(content);
  };

  return (
    <>
      <Page title="Simulator" isBackVisible>
        <Section title="Live Activity (iOS)">
          <Group>
            <PanelRow icon="play-outline" label="Play a command" detail="Lock Screen and Dynamic Island: cloud, then car, then done." onPress={() => playActivity(false)} />
            <PanelRow icon="play-forward-outline" label="Play a timed command" detail="Ends in a 1 minute countdown." onPress={() => playActivity(true)} />
            {ACTIVITY_STATES.map((s) => (
              <PanelRow key={s.label} icon={s.icon} label={s.label} onPress={() => startActivity(s.props, s.until?.())} />
            ))}
            <PanelRow
              icon="trash-outline"
              label="End Live Activity"
              isDestructive
              onPress={() => {
                activity.current?.end({});
                activity.current = null;
              }}
            />
          </Group>
        </Section>

        <Section title="Command Progress" className="mt-3">
          <Group>
            <PanelRow icon="play-outline" label="Play a command" detail="The in-app bar shown while a command runs." onPress={playProgress} />
            {PROGRESS_STATES.map((s) => (
              <PanelRow key={s.label} icon={s.icon} label={s.label} onPress={() => showProgress(s.state)} />
            ))}
          </Group>
        </Section>

        <Section title="Notifications" className="mt-3">
          <Group>
            <PanelRow
              icon="notifications-outline"
              label="New brand message"
              onPress={() => notify({ title: "Service reminder", subtitle: CAR, body: "Your next service is due in 800 km.", path: "/inbox" })}
            />
            <PanelRow icon="albums-outline" label="Several new messages" onPress={() => notify({ title: CAR, body: "5 new messages", path: "/inbox" })} />
            <PanelRow
              icon="refresh-outline"
              label="Run the background message check"
              detail="Fetches every connection's messages now and alerts any new ones."
              onPress={() => checkAll().catch((e) => log("app", `Message check failed: ${(e as Error).message}`, e, "error"))}
            />
          </Group>
        </Section>
      </Page>
      <CommandProgress state={progress} />
    </>
  );
}
