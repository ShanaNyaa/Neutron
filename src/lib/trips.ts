import type { Trip } from "@/core/types";

/** "34 min", "1 h 12 min". */
export function formatDuration(min?: number) {
  if (min == null || !Number.isFinite(min)) return undefined;
  const total = Math.round(min);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const formatTime = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "Today", "Yesterday", or "Mon, 21 Sep". */
export function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function groupByDay(trips: Trip[]) {
  const groups: { key: string; label: string; trips: Trip[]; km: number }[] = [];
  for (const t of [...trips].sort((a, b) => b.startedAt - a.startedAt)) {
    const key = new Date(t.startedAt).toDateString();
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, label: dayLabel(t.startedAt), trips: [], km: 0 }));
    g.trips.push(t);
    g.km += t.distanceKm ?? 0;
  }
  return groups;
}
