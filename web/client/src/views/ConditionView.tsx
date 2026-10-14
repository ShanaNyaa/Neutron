import { ChevronLeft, CircleGauge, DoorClosed, Fuel, Gauge, type LucideIcon, MapPin, Navigation, Power, Signal, Snowflake, Thermometer, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import type { DataUsage, WebStatus, WebVehicle } from "../api.ts";
import { MapView } from "../components/MapView.tsx";
import { km, number, temp } from "../format.ts";
import { navigate, useAddress, useDataUsage, useStatus } from "../hooks.ts";
import { pressure, setPref, TYRE_UNITS, unitLabel, usePrefs } from "../prefs.ts";

export const PLACES: Record<string, string> = {
  frontLeft: "front left",
  frontRight: "front right",
  rearLeft: "rear left",
  rearRight: "rear right",
  trunk: "boot",
  hood: "bonnet",
  sunroof: "sunroof",
};

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Everything the car reports, beyond what the home screen shows. Its own screen on phones. */
export function ConditionPanel({ vehicle }: { vehicle: WebVehicle }) {
  const { data: s, error } = useStatus(vehicle.vin);
  const usage = useDataUsage(vehicle.vin);
  if (error) return <p className="error">{error.message}</p>;
  if (!s) return <div className="skeleton" style={{ minHeight: 320 }} />;
  return (
    <div className="stack">
      <StatusTiles status={s} tankLitres={vehicle.fuelTankLitres} />
      {usage.data && <DataCard usage={usage.data} />}
      {s.location && <LocationCard location={s.location} name={vehicle.name} />}
    </div>
  );
}

export function ConditionView({ vehicle }: { vehicle: WebVehicle }) {
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div>
        <button className="btn ghost small" onClick={() => navigate({ name: "car" })}>
          <ChevronLeft size={16} /> {vehicle.name}
        </button>
      </div>
      <ConditionPanel vehicle={vehicle} />
    </div>
  );
}

const size = (bytes?: number) => {
  if (bytes == null) return "—";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${number(gb, 2)} GB` : `${number(bytes / 1024 ** 2)} MB`;
};

function DataCard({ usage }: { usage: DataUsage }) {
  const total = (usage.usedBytes ?? 0) + (usage.remainingBytes ?? 0);
  const pct = total ? ((usage.usedBytes ?? 0) / total) * 100 : undefined;
  return (
    <section className="card">
      <h3 className="card-title"><Signal size={18} /> Car's mobile data</h3>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span><strong>{size(usage.usedBytes)}</strong> <span className="muted small">used</span></span>
        <span><strong>{size(usage.remainingBytes)}</strong> <span className="muted small">left</span></span>
      </div>
      {pct != null && <div className={`meter ${pct > 85 ? "low" : ""}`} style={{ marginTop: 8 }}><div style={{ width: `${pct}%` }} /></div>}
    </section>
  );
}

export function StatusTiles({ status: s, tankLitres }: { status: WebStatus; tankLitres?: number }) {
  const fuelPct = s.fuelPercent ?? (s.fuelLitres != null && tankLitres ? Math.min(100, (s.fuelLitres / tankLitres) * 100) : undefined);
  const doorsOpen = Object.entries(s.doors ?? {}).filter(([, v]) => v === "open").map(([k]) => PLACES[k] ?? k);
  const windowsOpen = Object.entries(s.windows ?? {}).filter(([, v]) => v === "open").map(([k]) => PLACES[k] ?? k);
  const tyreWarn = Object.values(s.tyreWarnings ?? {}).some(Boolean);
  const serviceOverdue = (s.serviceDueKm ?? 0) < 0 || (s.serviceDueDays ?? 0) < 0;

  return (
    <section className="tiles" aria-label="Car status">
      <Tile icon={Fuel} title="Fuel" value={s.fuelLitres != null ? `${number(s.fuelLitres, 1)} L` : fuelPct != null ? `${Math.round(fuelPct)}%` : "—"}>
        {fuelPct != null && (
          <div className={`meter ${fuelPct < 15 ? "low" : ""}`} role="meter" aria-valuenow={Math.round(fuelPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Fuel level">
            <div style={{ width: `${fuelPct}%` }} />
          </div>
        )}
        <span className="muted small">{s.rangeKm != null ? `${km(s.rangeKm)} range` : "Range unknown"}</span>
      </Tile>
      <Tile icon={DoorClosed} title="Doors & windows" value={s.lock === "locked" ? "Locked" : s.lock === "unlocked" ? "Unlocked" : "—"} tone={s.lock === "unlocked" ? "warn" : "ok"}>
        <span className="muted small">{doorsOpen.length ? `Open: ${doorsOpen.join(", ")}` : "Doors closed"}</span>
        <span className={`small ${windowsOpen.length ? "warn" : "muted"}`}>
          {windowsOpen.length ? `Windows open: ${windowsOpen.join(", ")}` : "Windows closed"}
        </span>
      </Tile>
      <Tile icon={Power} title="Engine" value={s.isEngineOn == null ? "—" : s.isEngineOn ? "Running" : "Off"} tone={s.isEngineOn ? "warn" : undefined}>
        {s.isParkingBrakeOn != null && <span className="muted small">Parking brake {s.isParkingBrakeOn ? "on" : "off"}</span>}
      </Tile>
      <Tile icon={s.climate?.isOn ? Snowflake : Thermometer} title="Climate" value={s.climate?.isOn ? `On${s.climate.targetTempC ? ` · ${temp(s.climate.targetTempC)}` : ""}` : "Off"}>
        <span className="muted small">
          {[s.climate?.cabinTempC != null && `Inside ${temp(s.climate.cabinTempC)}`, s.climate?.outsideTempC != null && `Outside ${temp(s.climate.outsideTempC)}`].filter(Boolean).join(" · ") || "No temperature reported"}
        </span>
      </Tile>
      <Tile icon={Gauge} title="Odometer" value={km(s.odometerKm)}>
        {s.avgFuelLPer100km != null && <span className="muted small">Average {number(s.avgFuelLPer100km, 1)} L/100 km</span>}
      </Tile>
      <TyreTile tyres={s.tyres} warn={tyreWarn} />
      {(s.serviceDueKm != null || s.serviceDueDays != null) && (
        <Tile
          icon={Wrench}
          title="Next service"
          tone={serviceOverdue ? "warn" : undefined}
          value={s.serviceDueKm != null ? (s.serviceDueKm < 0 ? `${km(-s.serviceDueKm)} overdue` : `In ${km(s.serviceDueKm)}`) : `In ${s.serviceDueDays} days`}
        >
          {s.serviceDueKm != null && s.serviceDueDays != null && <span className="muted small">or {s.serviceDueDays} days</span>}
        </Tile>
      )}
    </section>
  );
}

/** Shown in the unit picked in Settings (PSI unless changed); tapping the tile cycles through them. */
function TyreTile({ tyres, warn }: { tyres: WebStatus["tyres"]; warn: boolean }) {
  const { tyreUnit } = usePrefs();
  const next = TYRE_UNITS[(TYRE_UNITS.findIndex((u) => u.value === tyreUnit) + 1) % TYRE_UNITS.length];
  const p = (kpa?: number) => pressure(kpa, tyreUnit);
  return (
    <button className="card tile tile-button" onClick={() => setPref("tyreUnit", next.value)} title={`Show in ${next.label}`} aria-label={`Tyre pressure in ${unitLabel(tyreUnit)}. Show in ${next.label}`}>
      <span className="tile-head"><CircleGauge size={16} /> Tyres <span className="unit-chip">{unitLabel(tyreUnit)}</span></span>
      <span className={`tile-value ${warn ? "warn" : ""}`}>{warn ? "Check pressure" : "OK"}</span>
      <span className="tyre-grid small">
        <span className="muted">Front</span><span>{p(tyres?.frontLeft)} · {p(tyres?.frontRight)}</span>
        <span className="muted">Rear</span><span>{p(tyres?.rearLeft)} · {p(tyres?.rearRight)}</span>
      </span>
    </button>
  );
}

function Tile({ icon: Icon, title, value, tone, children }: { icon: LucideIcon; title: string; value: string; tone?: "ok" | "warn"; children?: ReactNode }) {
  return (
    <div className="card tile">
      <span className="tile-head"><Icon size={16} /> {title}</span>
      <span className={`tile-value ${tone ?? ""}`}>{value}</span>
      {children}
    </div>
  );
}

function LocationCard({ location, name }: { location: NonNullable<WebStatus["location"]>; name: string }) {
  const q = `${location.latitude},${location.longitude}`;
  const address = useAddress(location);
  return (
    <section className="card">
      <h3 className="card-title" style={{ marginBottom: 4 }}><MapPin size={18} /> Parked here</h3>
      <p className="muted small" style={{ marginBottom: 12 }}>{address.data ?? (address.isLoading ? "Finding the address…" : `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`)}</p>
      <MapView markers={[{ ...location, kind: "car", label: name }]} zoom={16} />
      <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
        <a className="btn small" href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noreferrer">
          <MapPin size={16} /> Google Maps
        </a>
        <a className="btn small" href={`https://www.google.com/maps/dir/?api=1&destination=${q}`} target="_blank" rel="noreferrer">
          <Navigation size={16} /> Directions
        </a>
        <a className="btn small" href={`https://waze.com/ul?ll=${q}&navigate=yes`} target="_blank" rel="noreferrer">
          Waze
        </a>
      </div>
    </section>
  );
}

