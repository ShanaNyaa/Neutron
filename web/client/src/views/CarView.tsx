import { useEffect, useRef, useState } from "react";
import { ChevronRight, CircleAlert, CircleCheck, Fuel, Lock, LockOpen, Power, RefreshCw, Route as RouteIcon, Snowflake } from "lucide-react";

import type { WebStatus, WebVehicle } from "../api.ts";
import { CarScene } from "../components/CarScene.tsx";
import { useCommands } from "../components/CommandRunner.tsx";
import { commandById, COMMANDS, type CommandDef } from "../commands.ts";
import { ago, km, number, temp } from "../format.ts";
import { href, useMediaQuery, useNow, useStatus, useTrips } from "../hooks.ts";
import { battery, cap, ConditionPanel, PLACES } from "./ConditionView.tsx";

/**
 * The home screen. On a phone it fits one screen, as Proton's own app does: the readings that
 * matter, the car with its lock, a strip of actions, and cards that open the rest. On a wide
 * screen the car's full condition sits alongside.
 */
export function CarView({ vehicle }: { vehicle: WebVehicle }) {
  const wide = useMediaQuery("(min-width: 1100px)");
  const status = useStatus(vehicle.vin);
  const s = status.data;
  const has = (id: string) => !vehicle.commands || vehicle.commands.includes(id);

  const main = (
    <div className="home">
      {/* Phones show the plate in the top bar instead. */}
      <div className="home-title">
        <h2>{vehicle.name}</h2>
        <span className="muted small">{[vehicle.plate, vehicle.model, vehicle.color].filter(Boolean).join(" · ")}</span>
      </div>
      <StatusLine status={s} refreshing={status.isFetching} onRefresh={() => status.refetch()} />
      {status.error && <p className="error small">{status.error.message}</p>}
      <Hero vehicle={vehicle} status={s} />
      <EngineBanner vehicle={vehicle} status={s} />
      <Actions vehicle={vehicle} status={s} />
      <div className="home-cards">
        {has("climate_on") && <ClimateCard vehicle={vehicle} status={s} />}
        <TripsCard vehicle={vehicle} status={s} />
        {!wide && <ConditionCard status={s} />}
      </div>
    </div>
  );

  if (!wide) return main;
  return (
    <div className="dash">
      <section className="card">{main}</section>
      <ConditionPanel vehicle={vehicle} />
    </div>
  );
}

function StatusLine({ status: s, refreshing, onRefresh }: { status?: WebStatus; refreshing: boolean; onRefresh: () => Promise<unknown> }) {
  useNow(30_000);
  // The server usually answers in a few milliseconds; keep spinning long enough to be seen.
  const [spinning, setSpinning] = useState(false);
  const refresh = async () => {
    setSpinning(true);
    await Promise.all([onRefresh().catch(() => {}), new Promise((r) => setTimeout(r, 700))]);
    setSpinning(false);
  };
  const busy = spinning || refreshing;
  const open = [...Object.entries(s?.doors ?? {}), ...Object.entries(s?.windows ?? {})].filter(([, v]) => v === "open").map(([k]) => PLACES[k] ?? k);
  const parts = [s?.isParkingBrakeOn != null && `Parking brake ${s.isParkingBrakeOn ? "on" : "off"}`, s && `Reported ${ago(s.updatedAt)}`].filter(Boolean);
  return (
    <div className="status-line">
      <span className={`dot ${open.length || s?.lock === "unlocked" ? "warn" : "ok"}`} aria-hidden />
      <span className="small">{s ? open.length ? <span className="warn">{cap(open.join(", "))} open</span> : parts.join(" · ") : "Loading…"}</span>
      <span className="spacer" />
      <button className="btn ghost icon refresh" onClick={refresh} disabled={busy} aria-label={busy ? "Refreshing" : "Refresh status"} aria-busy={busy}>
        <RefreshCw size={18} className={busy ? "spin" : ""} />
      </button>
    </div>
  );
}

function Hero({ vehicle, status: s }: { vehicle: WebVehicle; status?: WebStatus }) {
  const { run, busy } = useCommands();
  const fuelPct = s?.fuelPercent ?? (s?.fuelLitres != null && vehicle.fuelTankLitres ? Math.min(100, (s.fuelLitres / vehicle.fuelTankLitres) * 100) : undefined);
  const locked = s?.lock === "locked";
  const toggle = commandById(locked ? "unlock" : "lock");
  const canToggle = toggle && (!vehicle.commands || vehicle.commands.includes(toggle.id));
  return (
    <div className="hero2">
      <div className="hero-numbers">
        <span className="hero-temp" title="Outside temperature">{s?.climate?.outsideTempC != null ? temp(s.climate.outsideTempC) : "—"}</span>
        <span className="hero-range">{s?.rangeKm != null ? number(s.rangeKm) : "—"}</span>
        <span className="muted small">Range (km)</span>
        <span className="hero-fuel">
          <Fuel size={18} /> {s?.fuelLitres != null ? `${number(s.fuelLitres, 1)} L` : fuelPct != null ? `${Math.round(fuelPct)}%` : "—"}
        </span>
        {fuelPct != null && (
          <div className={`meter ${fuelPct < 15 ? "low" : ""}`} role="meter" aria-label="Fuel level" aria-valuenow={Math.round(fuelPct)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${fuelPct}%` }} />
          </div>
        )}
      </div>
      <div className="hero-car">
        <CarScene vehicle={vehicle} status={s} />
        {canToggle && s && (
          <button className={`lock-toggle ${locked ? "locked" : "unlocked"}`} disabled={busy} onClick={() => run(vehicle, toggle)} aria-label={locked ? "Locked. Unlock the car" : "Unlocked. Lock the car"}>
            {locked ? <Lock size={22} /> : <LockOpen size={22} />}
            <span>{locked ? "Locked" : "Unlocked"}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function EngineBanner({ vehicle, status }: { vehicle: WebVehicle; status?: WebStatus }) {
  const { engineRun, run } = useCommands();
  const now = useNow(1000);
  // The car reports the engine off once it stops, early or not.
  const ours = engineRun?.vin === vehicle.vin && status?.isEngineOn !== false ? engineRun : null;
  if (!ours && !status?.isEngineOn) return null;
  const left = ours ? Math.max(0, ours.endsAt - now) : null;
  const stop = commandById("engine_stop");
  return (
    <div className="banner warn" role="status">
      <Power size={20} className="warn" />
      <div className="spacer">
        <strong>Engine running</strong>
        <div className="small muted">
          {left != null ? `Switches off by itself in ${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}` : "Started from the car or another app"}
        </div>
      </div>
      {stop && (!vehicle.commands || vehicle.commands.includes("engine_stop")) && <button className="btn small" onClick={() => run(vehicle, stop)}>Stop</button>}
    </div>
  );
}

const ORDER = ["engine_start", "engine_stop", "horn_lights", "lights", "trunk_open", "windows_close", "windows_open", "ventilate", "sunroof_close", "defrost_on", "charge_start", "charge_stop"];

const SHORT: Record<string, string> = {
  horn_lights: "Horn & lights",
  lights: "Flash",
  trunk_open: "Boot",
  windows_close: "Close windows",
  windows_open: "Open windows",
  ventilate: "Ventilate",
  sunroof_close: "Sunroof",
  defrost_on: "Defrost",
  charge_start: "Charge",
  charge_stop: "Stop charge",
};

/** Round buttons in one swipeable row, like Proton's carousel without the paging. */
function Actions({ vehicle, status: s }: { vehicle: WebVehicle; status?: WebStatus }) {
  const { run, busy } = useCommands();
  // The engine button flips between start and stop with the car's state.
  const hidden = new Set([s?.isEngineOn ? "engine_start" : "engine_stop"]);
  const items = ORDER.map((id) => COMMANDS.find((c) => c.id === id)).filter(
    (c): c is CommandDef => !!c && !hidden.has(c.id) && (!vehicle.commands || vehicle.commands.includes(c.id)),
  );
  // The strip fades its cut-off right edge until it's scrolled to the end.
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ scrolled: false, atEnd: false });
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const check = () => setEdges({ scrolled: el.scrollLeft > 2, atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, [items.length]);
  if (!items.length) return null;
  return (
    <div ref={strip} className={`actions ${edges.scrolled ? "scrolled" : ""} ${edges.atEnd ? "at-end" : ""}`} role="group" aria-label="Remote controls">
      {items.map((c) => {
        const Icon = c.icon;
        const engine = c.id === "engine_start" || c.id === "engine_stop";
        return (
          <button key={c.id} className={`round-action ${c.id === "engine_stop" ? "on" : ""}`} disabled={busy} onClick={() => run(vehicle, c)} aria-label={c.label}>
            <span className="round">{engine ? <span className="round-text">{c.id === "engine_start" ? "START" : "STOP"}</span> : <Icon size={24} />}</span>
            <span className="round-label">{engine ? "Engine" : (SHORT[c.id] ?? c.label)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ClimateCard({ vehicle, status: s }: { vehicle: WebVehicle; status?: WebStatus }) {
  const { run, busy } = useCommands();
  const on = !!s?.climate?.isOn;
  const def = commandById(on ? "climate_off" : "climate_on")!;
  return (
    <button className="home-card" disabled={busy} onClick={() => run(vehicle, def)} aria-label={on ? "Turn climate off" : "Turn climate on"}>
      <span className={`list-icon ${on ? "accent" : ""}`}><Snowflake size={20} /></span>
      <span className="list-body">
        <strong>{on ? `Climate on${s?.climate?.targetTempC ? ` · ${temp(s.climate.targetTempC)}` : ""}` : "Climate"}</strong>
        <span className="muted small">{s?.climate?.cabinTempC != null ? `Cabin ${temp(s.climate.cabinTempC)}` : on ? "Cooling the cabin" : "Cool the cabin before you go"}</span>
      </span>
      <span className={`power ${on ? "on" : ""}`} aria-hidden><Power size={22} /></span>
    </button>
  );
}

function TripsCard({ vehicle, status: s }: { vehicle: WebVehicle; status?: WebStatus }) {
  const trips = useTrips(vehicle.vin);
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const today = trips.data?.filter((t) => t.startedAt >= startOfDay).reduce((sum, t) => sum + (t.distanceKm ?? 0), 0);
  return (
    <a className="home-card" href={href({ name: "trips" })}>
      <span className="list-icon"><RouteIcon size={20} /></span>
      <span className="list-body">
        <strong>Trips</strong>
        <span className="muted small">{today ? `${km(today)} today` : "Driving log and routes"}</span>
      </span>
      <span className="muted small">{km(s?.odometerKm)}</span>
      <ChevronRight size={18} className="muted" />
    </a>
  );
}

function ConditionCard({ status: s }: { status?: WebStatus }) {
  const overdue = (s?.serviceDueKm ?? 0) < 0 || (s?.serviceDueDays ?? 0) < 0;
  const lowBattery = s?.batteryVoltage != null && battery(s.batteryVoltage).level === "error";
  const issues = [...(lowBattery ? [`12V battery low (${s!.batteryVoltage!.toFixed(1)} V)`] : []), ...(s?.warnings ?? []), ...(overdue ? ["Service overdue"] : [])];
  const ok = !issues.length;
  return (
    <a className="home-card" href={href({ name: "condition" })}>
      <span className={`list-icon ${ok ? "" : "accent"}`}>{ok ? <CircleCheck size={20} /> : <CircleAlert size={20} />}</span>
      <span className="list-body">
        <strong>Car condition</strong>
        <span className={`small ${ok ? "muted" : "warn"}`}>{s ? (ok ? "All OK · doors, windows, tyres, battery" : issues.slice(0, 2).join(" · ")) : "Loading…"}</span>
      </span>
      <ChevronRight size={18} className="muted" />
    </a>
  );
}
