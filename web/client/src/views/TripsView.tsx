import { ChevronLeft, ChevronRight, Clock, Gauge, MapPin, Navigation, Route } from "lucide-react";
import { useState } from "react";

import type { Coordinate, Trip } from "../api.ts";
import { MapView } from "../components/MapView.tsx";
import { dateTime, km, minutes, number } from "../format.ts";
import { href, navigate, useAddress, useMediaQuery, useTrips, useTripTrack } from "../hooks.ts";

const DAY_MS = 86_400_000;
const PERIODS = [1, 7, 30] as const;

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const speed = (n?: number) => (n == null ? "—" : `${number(n)} km/h`);
const mapsUrl = (c: Coordinate) => `https://www.google.com/maps/search/?api=1&query=${c.latitude},${c.longitude}`;
const routeUrl = (a: Coordinate, b: Coordinate) =>
  `https://www.google.com/maps/dir/?api=1&origin=${a.latitude},${a.longitude}&destination=${b.latitude},${b.longitude}&travelmode=driving`;

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

const dayKey = (ms: number) => new Date(ms).toDateString();

function dayLabel(ms: number) {
  const key = dayKey(ms);
  if (key === dayKey(Date.now())) return "Today";
  if (key === dayKey(Date.now() - DAY_MS)) return "Yesterday";
  return new Date(ms).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function groupByDay(trips: Trip[]) {
  const days: { key: string; startedAt: number; trips: Trip[] }[] = [];
  for (const trip of trips) {
    const key = dayKey(trip.startedAt);
    const last = days.at(-1);
    if (last?.key === key) last.trips.push(trip);
    else days.push({ key, startedAt: trip.startedAt, trips: [trip] });
  }
  return days;
}

const sum = (trips: Trip[], pick: (t: Trip) => number | undefined) => trips.reduce((total, t) => total + (pick(t) ?? 0), 0);

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card tile">
      <div className="tile-head">
        {icon} {label}
      </div>
      <div className="tile-value">{value}</div>
    </div>
  );
}

function Summary({ trips }: { trips: Trip[] }) {
  const distance = sum(trips, (t) => t.distanceKm);
  const duration = sum(trips, (t) => t.durationMin);
  return (
    <div className="stats">
      <Tile icon={<Route size={16} />} label="Trips" value={String(trips.length)} />
      <Tile icon={<Navigation size={16} />} label="Distance" value={km(distance)} />
      <Tile icon={<Clock size={16} />} label="Driving time" value={minutes(duration)} />
      <Tile icon={<Gauge size={16} />} label="Avg speed" value={duration > 0 ? speed(distance / (duration / 60)) : "—"} />
    </div>
  );
}

/** Where a trip started and ended, as Proton Link shows it. Addresses fill in as the server finds them. */
function Places({ trip, full }: { trip: Trip; full?: boolean }) {
  const from = useAddress(trip.start);
  const to = useAddress(trip.end);
  if (!trip.start && !trip.end) return null;
  const line = (label: "A" | "B", q: typeof from, c?: Coordinate) => {
    if (!c) return null;
    const text = q.data ?? (q.isLoading ? "…" : `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}`);
    const dot = <span className={`place-dot ${label === "A" ? "start" : "end"}`} aria-hidden>{full ? label : ""}</span>;
    // In the detail each end opens on a map; in the list the whole row is already a link.
    if (full) {
      return (
        <a className="place full" href={mapsUrl(c)} target="_blank" rel="noreferrer">
          {dot}
          <span className="place-text">
            <span className="muted tiny">{label === "A" ? "From" : "To"}</span>
            <br />
            {text}
          </span>
          <MapPin size={16} className="muted" aria-label="Show on map" />
        </a>
      );
    }
    return (
      <span className="place">
        {dot}
        <span className="place-text">{text}</span>
      </span>
    );
  };
  return (
    <span className="places">
      {line("A", from, trip.start)}
      {line("B", to, trip.end)}
    </span>
  );
}

function TripList({ trips, selectedId }: { trips: Trip[]; selectedId?: string }) {
  return (
    <div className="stack">
      {groupByDay(trips).map((day) => (
        <section key={day.key} className="stack">
          <div className="row">
            <h3 className="section-label">{dayLabel(day.startedAt)}</h3>
            <span className="spacer" />
            <span className="muted small">{km(sum(day.trips, (t) => t.distanceKm))}</span>
          </div>
          <div className="list">
            {day.trips.map((trip) => (
              <a key={trip.id} className="list-row" href={href({ name: "trips", tripId: trip.id })} aria-current={trip.id === selectedId ? "true" : undefined}>
                <span className={trip.id === selectedId ? "list-icon accent" : "list-icon"}>
                  <Route size={18} />
                </span>
                <span className="list-body">
                  <strong>
                    {time(trip.startedAt)}
                    {trip.endedAt ? ` – ${time(trip.endedAt)}` : ""}
                  </strong>
                  <span className="muted small">
                    {km(trip.distanceKm)} · {minutes(trip.durationMin)} · {speed(trip.avgSpeedKmh)}
                  </span>
                  <Places trip={trip} />
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TripDetail({ vin, trip }: { vin: string; trip: Trip }) {
  const endedAt = trip.endedAt ?? (trip.durationMin != null ? trip.startedAt + trip.durationMin * 60_000 : undefined);
  const track = useTripTrack(vin, trip.startedAt, endedAt);
  const route = track.data ?? [];

  const markers = [
    trip.start && { ...trip.start, kind: "start" as const, label: "Start" },
    trip.end && { ...trip.end, kind: "end" as const, label: "End" },
  ].filter((m) => !!m);

  return (
    <div className="stack">
      <div>
        <h2 className="card-title">{dateTime(trip.startedAt)}</h2>
        {endedAt && <div className="muted small">Ended {time(endedAt)}</div>}
      </div>

      <section className="card" style={{ padding: "12px 14px" }} aria-label="From and to">
        <Places trip={trip} full />
      </section>

      {markers.length > 0 ? (
        <MapView markers={markers} route={route} className="map tall" />
      ) : (
        <div className="empty">No location was recorded for this trip.</div>
      )}
      {track.isLoading && <div className="muted small">Loading route…</div>}
      {track.isError && <div className="error">{message(track.error)}</div>}
      {track.isSuccess && route.length === 0 && <div className="muted small">No route was recorded for this trip.</div>}

      <div className="stats three">
        <Tile icon={<Navigation size={16} />} label="Distance" value={km(trip.distanceKm)} />
        <Tile icon={<Clock size={16} />} label="Duration" value={minutes(trip.durationMin)} />
        <Tile icon={<Gauge size={16} />} label="Avg speed" value={speed(trip.avgSpeedKmh)} />
      </div>

      {trip.start && trip.end && (
        <a className="btn" href={routeUrl(trip.start, trip.end)} target="_blank" rel="noreferrer">
          <Navigation size={18} /> Open this route in Google Maps
        </a>
      )}
    </div>
  );
}

export function TripsView({ vin, tripId }: { vin: string; tripId?: string }) {
  const wide = useMediaQuery("(min-width: 960px)");
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const { data, error, isLoading } = useTrips(vin);

  const header = (
    <div className="page-head desktop-only">
      <h1>Trips</h1>
    </div>
  );

  if (isLoading) {
    return (
      <div className="stack">
        {header}
        <div className="skeleton" style={{ height: 88 }} />
        <div className="skeleton" style={{ height: 64 }} />
        <div className="skeleton" style={{ height: 64 }} />
        <div className="skeleton" style={{ height: 64 }} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="stack">
        {header}
        <div className="error">{message(error)}</div>
      </div>
    );
  }

  const all = data ?? [];
  const cutoff = Date.now() - days * DAY_MS;
  const trips = all.filter((t) => t.startedAt >= cutoff);
  const chosen = all.find((t) => t.id === tripId);

  // On phones the detail replaces the list.
  if (chosen && !wide) {
    return (
      <div className="stack">
        <div>
          <button className="btn ghost small" onClick={() => navigate({ name: "trips" })}>
            <ChevronLeft size={16} /> All trips
          </button>
        </div>
        <TripDetail vin={vin} trip={chosen} />
      </div>
    );
  }

  const selected = chosen ?? (wide ? trips[0] : undefined);

  const top = (
    <>
      <div className="page-head">
        <h1 className="desktop-title">Trips</h1>
        <span className="spacer" />
        <div className="segmented" role="group" aria-label="Period">
          {PERIODS.map((d) => (
            <button key={d} className={d === days ? "active" : undefined} aria-pressed={d === days} onClick={() => setDays(d)}>
              {d === 1 ? "1 day" : `${d} days`}
            </button>
          ))}
        </div>
      </div>
      <Summary trips={trips} />
    </>
  );
  const list =
    trips.length === 0 ? (
      <div className="card empty">No trips were recorded in this period. The trip log can be turned on in Proton Link.</div>
    ) : (
      <section className="card" style={{ padding: "8px 14px" }}>
        <TripList trips={trips} selectedId={selected?.id} />
      </section>
    );

  if (!wide) {
    return (
      <div className="stack">
        {top}
        {list}
      </div>
    );
  }

  return (
    <div className="stack">
      {top}
      <div className="trips-split">
        {list}
        {selected && (
          <section className="card trips-detail">
            <TripDetail key={selected.id} vin={vin} trip={selected} />
          </section>
        )}
      </div>
    </div>
  );
}
