import { useEffect, useState } from "react";

import type { Notice, Trip } from "@/core/types";

import { api } from "./api.ts";
import { dateTime, km, minutes, number } from "./format.ts";

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    load().then(setData, (e) => setError((e as Error).message));
  }, deps);
  return { data, error };
}

const mapLink = (c?: { latitude: number; longitude: number }) =>
  c ? `https://www.google.com/maps/search/?api=1&query=${c.latitude},${c.longitude}` : undefined;

export function TripsView({ vin }: { vin: string }) {
  const { data, error } = useLoad(() => api.trips(vin), [vin]);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading trips…</p>;
  if (!data.length) return <p className="muted">No trips in the last 30 days. The trip log may be off in Proton Link.</p>;
  const total = data.reduce((sum, t) => sum + (t.distanceKm ?? 0), 0);
  return (
    <section className="card">
      <h3>Last 30 days</h3>
      <p className="muted small">{data.length} trips · {km(total)}</p>
      <ul className="list">
        {data.map((t: Trip) => (
          <li key={t.id}>
            <div>
              <strong>{dateTime(t.startedAt)}</strong>
              <span className="muted small">
                {km(t.distanceKm)} · {minutes(t.durationMin)}
                {t.avgSpeedKmh ? ` · ${number(t.avgSpeedKmh)} km/h average` : ""}
              </span>
            </div>
            <span className="small links">
              {mapLink(t.start) && <a href={mapLink(t.start)} target="_blank" rel="noreferrer">Start</a>}
              {mapLink(t.end) && <a href={mapLink(t.end)} target="_blank" rel="noreferrer">End</a>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function InboxView() {
  const { data, error } = useLoad(() => api.notices(), []);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading messages…</p>;
  if (!data.length) return <p className="muted">No messages.</p>;
  return (
    <section className="card">
      <h3>Inbox</h3>
      <ul className="list">
        {data.map((n: Notice) => (
          <li key={n.id} className={n.isRead ? "" : "unread"}>
            <div>
              <strong>{n.title}</strong>
              {n.body && <span className="small">{n.body}</span>}
              <span className="muted small">{dateTime(n.createdAt)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
