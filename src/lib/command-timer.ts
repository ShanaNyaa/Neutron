import { useEffect } from "react";
import { create } from "zustand";

import * as store from "@/core/store";
import type { CommandDefinition, CommandId } from "@/core/types";
import { syncWidgets } from "@/widgets/sync";

/**
 * A command that keeps running after it's sent (a remote start, a timed climate run), per car.
 * Kept in the store so the widgets and Live Activity agree.
 */
export type CommandTimer = { command: CommandId; startedAt: number; endsAt: number };

// Mirrors the stored timers so screens re-render when one starts or ends. `now` is a clock shared
// by every countdown on screen, ticking once a second while any of them is running.
const useTimers = create(() => ({ timers: {} as Record<string, CommandTimer[] | undefined>, now: Date.now() }));

let tickers = 0;
let tick: ReturnType<typeof setInterval> | undefined;
function startTicking() {
  if (tickers++ === 0) {
    useTimers.setState({ now: Date.now() });
    tick = setInterval(() => useTimers.setState({ now: Date.now() }), 1000);
  }
  return () => {
    if (--tickers === 0) clearInterval(tick);
  };
}
const keyOf = (connId: string, vehicleId: string) => `${connId}/${vehicleId}`;

function load(connId: string, vehicleId: string): CommandTimer[] {
  const key = keyOf(connId, vehicleId);
  const { timers } = useTimers.getState();
  return (key in timers ? timers[key] : store.loadSnapshot<CommandTimer[]>(connId, vehicleId, "timers")?.data) ?? [];
}

function save(connId: string, vehicleId: string, timers: CommandTimer[]) {
  store.saveSnapshot(connId, vehicleId, "timers", timers);
  useTimers.setState((s) => ({ timers: { ...s.timers, [keyOf(connId, vehicleId)]: timers } }));
  syncWidgets();
}

/** Running ones, soonest to end first. */
export function getCommandTimers(connId: string, vehicleId: string): CommandTimer[] {
  const now = Date.now();
  return load(connId, vehicleId)
    .filter((t) => t.endsAt > now)
    .sort((a, b) => a.endsAt - b.endsAt);
}

/** Minutes the command will run for, from its `timer` and the params it was sent with. */
export function timerMinutes(command: CommandDefinition, params?: Record<string, string | number>) {
  if (!command.timer) return 0;
  const minutes = Number(params?.[command.timer.param ?? "minutes"] ?? command.timer.defaultMinutes ?? 0);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

export function startCommandTimer(connId: string, vehicleId: string, command: CommandId, minutes: number) {
  const now = Date.now();
  const others = getCommandTimers(connId, vehicleId).filter((t) => t.command !== command);
  save(connId, vehicleId, [...others, { command, startedAt: now, endsAt: now + minutes * 60_000 }]);
}

export function stopCommandTimer(connId: string, vehicleId: string, command: CommandId) {
  save(connId, vehicleId, getCommandTimers(connId, vehicleId).filter((t) => t.command !== command));
}

/** Re-renders every second while any is running. */
export function useCommandTimers(connId: string, vehicleId: string) {
  // Subscribes to this car's timers; the values are read through getCommandTimers.
  useTimers((s) => s.timers[keyOf(connId, vehicleId)]);
  const now = useTimers((s) => s.now);
  const timers = getCommandTimers(connId, vehicleId);
  const running = timers.length > 0;
  useEffect(() => (running ? startTicking() : undefined), [running]);
  return timers.filter((t) => t.endsAt > now).map((t) => ({ ...t, remainingMs: t.endsAt - now }));
}

/** "9:32" */
export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
