import {
  ArrowDown,
  ArrowUp,
  BatteryMedium,
  ChevronLeft,
  CircleGauge,
  Cog,
  DoorClosed,
  Droplet,
  Fuel,
  Gauge,
  ListChecks,
  type LucideIcon,
  Minus,
  Plus,
  MapPin,
  Navigation,
  Plug,
  Power,
  RectangleHorizontal,
  RotateCcw,
  Signal,
  Square,
  SlidersHorizontal,
  Snowflake,
  Thermometer,
  UserCheck,
  Wrench,
} from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";

import type { DataUsage, WebStatus, WebVehicle } from "../api.ts";
import { MapView } from "../components/MapView.tsx";
import { useArrange } from "../components/useArrange.ts";
import { km, number, temp } from "../format.ts";
import { navigate, useAddress, useDataUsage, useStatus } from "../hooks.ts";
import { pressure, setPref, TYRE_UNITS, unitLabel, usePrefs, type WidgetSize } from "../prefs.ts";

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

/**
 * Resting 12V readings: about 12.6 V is full and below 12.2 V is getting low. The car reports
 * more while the engine runs (the alternator charges at 13 to 14.5 V).
 */
export function battery(v: number): { tone?: "ok" | "warn"; level: "ok" | "warn" | "error"; text: string } {
  if (v < 11.8) return { tone: "warn", level: "error", text: "Low: the car may not start" };
  if (v < 12.2) return { tone: "warn", level: "warn", text: "Getting low" };
  if (v > 13.2) return { tone: "ok", level: "ok", text: "Charging" };
  return { tone: "ok", level: "ok", text: "Healthy" };
}

type Experimental = Partial<Record<"seatBeltDriver" | "seatBeltPassenger" | "gear" | "coolantTemp" | "coolantValid" | "powerMode" | "powerSource" | "engineSpeed" | "speed", string | number>>;
type Status = WebStatus & { experimental?: Experimental };
type Ctx = { s: Status; vehicle: WebVehicle; usage?: DataUsage | null };

/**
 * Everything the Car condition screen can show. Each widget can be small (one slot, two to a
 * row on a phone) or wide (a whole row); people pick per widget in Customise. A plain tile
 * lays itself out for either size (see Tile); widgets with more to show render differently
 * per size. `available` hides a widget when the car doesn't report it.
 */
type Widget = {
  id: string;
  name: string;
  hint: string;
  icon: LucideIcon;
  /** Small unless said otherwise. */
  defaultSize?: WidgetSize;
  experimental?: boolean;
  available?: (c: Ctx) => boolean;
  render: (c: Ctx, size: WidgetSize) => ReactNode;
};

/** The size of the slot a tile is in, so tiles needn't be told one by one. */
const SizeContext = createContext<WidgetSize>("small");

const WIDGETS: Widget[] = [
  { id: "fuel", name: "Fuel", hint: "Litres left and range", icon: Fuel, render: ({ s, vehicle }) => <FuelTile s={s} tank={vehicle.fuelTankLitres} /> },
  { id: "doors", name: "Doors & windows", hint: "Locks and anything left open", icon: DoorClosed, render: ({ s }) => <DoorsTile s={s} /> },
  { id: "tyres", name: "Tyres", hint: "Pressure per wheel; tap to change units", icon: CircleGauge, render: ({ s }) => <TyreTile tyres={s.tyres} warnings={s.tyreWarnings} /> },
  {
    id: "battery",
    name: "12V battery",
    hint: "Voltage and health",
    icon: BatteryMedium,
    available: ({ s }) => s.batteryVoltage != null,
    render: ({ s }) => (
      <Tile icon={BatteryMedium} title="12V battery" value={`${s.batteryVoltage!.toFixed(1)} V`} tone={battery(s.batteryVoltage!).tone}>
        <span className="muted small">{battery(s.batteryVoltage!).text}</span>
      </Tile>
    ),
  },
  {
    id: "engine",
    name: "Engine",
    hint: "Running or off, parking brake",
    icon: Power,
    render: ({ s }) => (
      <Tile icon={Power} title="Engine" value={s.isEngineOn == null ? "—" : s.isEngineOn ? "Running" : "Off"} tone={s.isEngineOn ? "warn" : undefined}>
        {s.isParkingBrakeOn != null && <span className="muted small">Parking brake {s.isParkingBrakeOn ? "on" : "off"}</span>}
      </Tile>
    ),
  },
  {
    id: "climate",
    name: "Climate",
    hint: "A/C and temperatures",
    icon: Thermometer,
    render: ({ s }) => (
      <Tile icon={s.climate?.isOn ? Snowflake : Thermometer} title="Climate" value={s.climate?.isOn ? `On${s.climate.targetTempC ? ` · ${temp(s.climate.targetTempC)}` : ""}` : "Off"}>
        <span className="muted small">
          {[s.climate?.cabinTempC != null && `In ${temp(s.climate.cabinTempC)}`, s.climate?.outsideTempC != null && `Out ${temp(s.climate.outsideTempC)}`].filter(Boolean).join(" · ") || "No temperature"}
        </span>
      </Tile>
    ),
  },
  {
    id: "odometer",
    name: "Odometer",
    hint: "Total distance and average consumption",
    icon: Gauge,
    render: ({ s }) => (
      <Tile icon={Gauge} title="Odometer" value={km(s.odometerKm)}>
        {s.avgFuelLPer100km != null && <span className="muted small">{number(s.avgFuelLPer100km, 1)} L/100 km</span>}
      </Tile>
    ),
  },
  {
    id: "service",
    name: "Next service",
    hint: "Distance or days to the next service, as reported",
    icon: Wrench,
    available: ({ s }) => s.serviceDueKm != null || s.serviceDueDays != null,
    render: ({ s }) => {
      const overdue = (s.serviceDueKm ?? 0) < 0 || (s.serviceDueDays ?? 0) < 0;
      return (
        <Tile icon={Wrench} title="Next service" tone={overdue ? "warn" : undefined} value={s.serviceDueKm != null ? (s.serviceDueKm < 0 ? `${km(-s.serviceDueKm)} over` : km(s.serviceDueKm)) : `${s.serviceDueDays} days`}>
          <span className="muted small">
            {s.serviceDueKm != null && s.serviceDueKm >= 0 ? "to go" : overdue ? "overdue" : ""}
            {s.serviceDueKm != null && s.serviceDueDays != null ? ` · ${s.serviceDueDays} days` : ""}
          </span>
        </Tile>
      );
    },
  },
  {
    id: "oil",
    name: "Oil pressure",
    hint: "The car's oil pressure warning",
    icon: Droplet,
    available: ({ s }) => s.isOilPressureLow != null,
    render: ({ s }) => (
      <Tile icon={Droplet} title="Oil pressure" value={s.isOilPressureLow ? "Warning" : "OK"} tone={s.isOilPressureLow ? "warn" : "ok"}>
        {s.isOilPressureLow && <span className="small warn">Stop and check the oil</span>}
      </Tile>
    ),
  },
  {
    id: "diagnostics",
    name: "System diagnostics",
    hint: "Every system in one list with status dots; small shows just what needs a look",
    icon: ListChecks,
    defaultSize: "wide",
    render: ({ s }, size) => (size === "wide" ? <Diagnostics s={s} /> : <DiagnosticsTile s={s} />),
  },
  {
    id: "data",
    name: "Car's mobile data",
    hint: "The car's data plan, used and left",
    icon: Signal,
    available: ({ usage }) => !!usage,
    render: ({ usage }, size) => (size === "wide" ? <DataCard usage={usage!} /> : <DataTile usage={usage!} />),
  },
  {
    id: "location",
    name: "Parked here",
    hint: "Address and directions; wide adds the map",
    icon: MapPin,
    defaultSize: "wide",
    available: ({ s }) => !!s.location,
    render: ({ s, vehicle }, size) => (size === "wide" ? <LocationCard location={s.location!} name={vehicle.name} /> : <LocationTile location={s.location!} />),
  },
  // Undecoded readings, shown raw (docs/proton-integration.md).
  {
    id: "seatbelts",
    name: "Seat belts",
    hint: "Raw values: what each number means isn't known yet",
    icon: UserCheck,
    experimental: true,
    available: ({ s }) => s.experimental?.seatBeltDriver != null || s.experimental?.seatBeltPassenger != null,
    render: ({ s }) => (
      <Tile icon={UserCheck} title="Seat belts" value={`${raw(s.experimental?.seatBeltDriver)} · ${raw(s.experimental?.seatBeltPassenger)}`} experimental>
        <span className="muted small">Driver · passenger</span>
      </Tile>
    ),
  },
  {
    id: "gear",
    name: "Gear",
    hint: "Raw value: 1 while parked, probably P",
    icon: Cog,
    experimental: true,
    available: ({ s }) => s.experimental?.gear != null,
    render: ({ s }) => (
      <Tile icon={Cog} title="Gear" value={raw(s.experimental?.gear)} experimental>
        <span className="muted small">{String(s.experimental?.gear) === "1" ? "Probably P" : "Not decoded"}</span>
      </Tile>
    ),
  },
  {
    id: "coolant",
    name: "Coolant",
    hint: "Raw temperature; only valid while the engine runs",
    icon: Thermometer,
    experimental: true,
    available: ({ s }) => s.experimental?.coolantTemp != null,
    render: ({ s }) => {
      const valid = String(s.experimental?.coolantValid) !== "0";
      return (
        <Tile icon={Thermometer} title="Coolant" value={valid ? raw(s.experimental?.coolantTemp) : "—"} experimental>
          <span className="muted small">{valid ? "Unit unconfirmed" : `Not valid now (${raw(s.experimental?.coolantTemp)})`}</span>
        </Tile>
      );
    },
  },
  {
    id: "power",
    name: "Power mode",
    hint: "Raw ignition and power state",
    icon: Plug,
    experimental: true,
    available: ({ s }) => s.experimental?.powerMode != null,
    render: ({ s }) => (
      <Tile icon={Plug} title="Power mode" value={raw(s.experimental?.powerMode)} experimental>
        <span className="muted small">Source {raw(s.experimental?.powerSource)}</span>
      </Tile>
    ),
  },
];

/** Fits about one phone screen: the readings people check most, then where the car is. */
export const DEFAULT_WIDGETS = ["fuel", "doors", "tyres", "battery", "engine", "climate", "odometer", "service", "location"];

const SIZES: { value: WidgetSize; label: string; icon: LucideIcon }[] = [
  { value: "small", label: "Small", icon: Square },
  { value: "wide", label: "Wide", icon: RectangleHorizontal },
];

const raw = (v: unknown) => (v == null || v === "" ? "—" : String(v));
const byId = new Map(WIDGETS.map((w) => [w.id, w]));

/** The saved layout, minus any widget this version no longer has. */
function useLayout() {
  const { conditionWidgets } = usePrefs();
  return (conditionWidgets ?? DEFAULT_WIDGETS).filter((id) => byId.has(id));
}

const saveLayout = (ids: string[]) => setPref("conditionWidgets", ids);

function useSizes() {
  const { conditionSizes } = usePrefs();
  return (w: Widget): WidgetSize => conditionSizes?.[w.id] ?? w.defaultSize ?? "small";
}

const setSize = (id: string, size: WidgetSize, sizes: Record<string, WidgetSize> | null) => setPref("conditionSizes", { ...sizes, [id]: size });

/**
 * Everything the car reports, beyond what the home screen shows. Its own screen on phones.
 * Press and hold any widget to arrange them; Customise lists every widget with switches.
 */
export function ConditionPanel({ vehicle, title }: { vehicle: WebVehicle; title?: ReactNode }) {
  const { data: s, error } = useStatus(vehicle.vin);
  const usage = useDataUsage(vehicle.vin);
  const layout = useLayout();
  const sizeOf = useSizes();
  const { conditionSizes } = usePrefs();
  const [editing, setEditing] = useState(false);
  const arrange = useArrange(layout, saveLayout);

  const head = (
    <div className="row">
      {title}
      <span className="spacer" />
      {arrange.arranging ? (
        <>
          <button className="btn small" onClick={() => { arrange.setArranging(false); setEditing(true); }}>
            <Plus size={16} /> Add widgets
          </button>
          <button className="btn small primary" onClick={() => arrange.setArranging(false)}>Done</button>
        </>
      ) : (
        !editing && (
          <button className="btn small" onClick={() => setEditing(true)}>
            <SlidersHorizontal size={16} /> Customise
          </button>
        )
      )}
    </div>
  );

  if (error) return <p className="error">{error.message}</p>;
  if (!s) return <div className="skeleton" style={{ minHeight: 320 }} />;
  const ctx: Ctx = { s: s as Status, vehicle, usage: usage.data };

  if (editing) return (
    <div className="stack">
      {head}
      <Customise ctx={ctx} layout={layout} onDone={() => setEditing(false)} />
    </div>
  );

  // One grid for every widget: tiles take a cell, wide widgets a whole row. Keeping them in a
  // single parent means dragging one never remounts the rest (the map would reload).
  const shown = arrange.order.map((id) => byId.get(id)!).filter((w) => w && (!w.available || w.available(ctx)));
  return (
    <div className={`stack condition ${arrange.arranging ? "arranging" : ""}`}>
      {head}
      {arrange.arranging ? (
        <p className="muted small arrange-hint">Drag widgets to reorder. Tap − to remove one, or ⤢ to make it wide or small.</p>
      ) : (
        shown.length > 1 && <p className="muted tiny arrange-hint">Tip: press and hold a widget to rearrange.</p>
      )}
      {!shown.length && <div className="card empty">Nothing to show. Use Customise to pick what this screen shows.</div>}
      <section className="widgets" aria-label="Car status">
        {shown.map((w) => {
          const size = sizeOf(w);
          const other: WidgetSize = size === "wide" ? "small" : "wide";
          return (
            <div
              key={w.id}
              ref={arrange.slotRef(w.id)}
              className={`slot ${size} ${arrange.dragId === w.id ? "dragging" : ""}`}
              onPointerDown={arrange.onPointerDown(w.id)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <SizeContext.Provider value={size}>
                <div className="slot-inner">{w.render(ctx, size)}</div>
              </SizeContext.Provider>
              {arrange.arranging && (
                <>
                  <button className="slot-remove" onClick={() => saveLayout(layout.filter((id) => id !== w.id))} aria-label={`Remove ${w.name}`}>
                    <Minus size={14} />
                  </button>
                  <button className="slot-resize" onClick={() => setSize(w.id, other, conditionSizes)} aria-label={`Make ${w.name} ${other}`}>
                    {other === "wide" ? <RectangleHorizontal size={14} /> : <Square size={14} />}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

/** Pick and order widgets. Changes apply as you make them; Done just closes the editor. */
function Customise({ ctx, layout, onDone }: { ctx: Ctx; layout: string[]; onDone: () => void }) {
  const save = (ids: string[]) => setPref("conditionWidgets", ids);
  const sizeOf = useSizes();
  const { conditionSizes } = usePrefs();
  const hidden = WIDGETS.filter((w) => !layout.includes(w.id));
  const move = (i: number, by: number) => {
    const next = [...layout];
    const [w] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, w);
    save(next);
  };
  const row = (w: Widget, on: boolean, i: number) => {
    const Icon = w.icon;
    const unavailable = w.available && !w.available(ctx);
    return (
      <li key={w.id} className="custom-row">
        <label className="custom-toggle">
          <input type="checkbox" checked={on} onChange={() => save(on ? layout.filter((id) => id !== w.id) : [...layout, w.id])} />
          <span className="list-icon"><Icon size={18} /></span>
          <span className="list-body">
            <strong>
              {w.name}
              {w.experimental && <span className="chip-mini">Experimental</span>}
            </strong>
            <span className="muted small">{unavailable ? "Your car doesn't report this right now" : w.hint}</span>
          </span>
        </label>
        {on && (
          <span className="custom-move">
            <span className="segmented mini" role="radiogroup" aria-label={`${w.name} size`}>
              {SIZES.map(({ value, label, icon: SizeIcon }) => (
                <button key={value} type="button" role="radio" aria-checked={sizeOf(w) === value} className={sizeOf(w) === value ? "active" : ""} onClick={() => setSize(w.id, value, conditionSizes)} aria-label={`${label} ${w.name}`} title={label}>
                  <SizeIcon size={16} />
                </button>
              ))}
            </span>
            <button className="btn ghost icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${w.name} up`}><ArrowUp size={18} /></button>
            <button className="btn ghost icon" disabled={i === layout.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${w.name} down`}><ArrowDown size={18} /></button>
          </span>
        )}
      </li>
    );
  };
  return (
    <section className="card stack" style={{ gap: 12 }}>
      <div>
        <h3 className="card-title" style={{ marginBottom: 4 }}>Customise Car condition</h3>
        <p className="muted small">Turn widgets on or off, move them up or down, and pick a size: small widgets sit two to a row, wide ones take the row and show more. You can also press and hold a widget on the Car condition screen to drag it.</p>
      </div>
      <div className="section-label" style={{ margin: 0 }}>Showing ({layout.length})</div>
      <ul className="list">{layout.map((id, i) => row(byId.get(id)!, true, i))}</ul>
      {hidden.length > 0 && (
        <>
          <div className="section-label" style={{ margin: 0 }}>More widgets</div>
          <ul className="list">{hidden.map((w) => row(w, false, -1))}</ul>
        </>
      )}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="btn ghost small" onClick={() => { setPref("conditionWidgets", null); setPref("conditionSizes", null); }}>
          <RotateCcw size={16} /> Reset to default
        </button>
        <button className="btn primary" onClick={onDone}>Done</button>
      </div>
    </section>
  );
}

export function ConditionView({ vehicle }: { vehicle: WebVehicle }) {
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <ConditionPanel
        vehicle={vehicle}
        title={
          <button className="btn ghost small" onClick={() => navigate({ name: "car" })}>
            <ChevronLeft size={16} /> {vehicle.name}
          </button>
        }
      />
    </div>
  );
}

const size = (bytes?: number) => {
  if (bytes == null) return "—";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${number(gb, 2)} GB` : `${number(bytes / 1024 ** 2)} MB`;
};

/** The small form: what's left, with the bar. */
function DataTile({ usage }: { usage: DataUsage }) {
  const total = (usage.usedBytes ?? 0) + (usage.remainingBytes ?? 0);
  const pct = total ? ((usage.usedBytes ?? 0) / total) * 100 : undefined;
  return (
    <Tile icon={Signal} title="Mobile data" value={usage.remainingBytes != null ? `${size(usage.remainingBytes)} left` : size(usage.usedBytes)}>
      {pct != null && <div className={`meter ${pct > 85 ? "low" : ""}`}><div style={{ width: `${pct}%` }} /></div>}
      <span className="muted small">{usage.remainingBytes != null ? `${size(usage.usedBytes)} used` : "used"}</span>
    </Tile>
  );
}

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

type Level = "ok" | "warn" | "error" | "none";

function diagnosticRows(s: Status) {
  const windowsOpen = Object.values(s.windows ?? {}).filter((v) => v === "open").length;
  const open = (v?: string) => (v === "open" ? "Open" : v === "closed" ? "Closed" : "—");
  const rows: { label: string; value: string; level: Level }[] = [
    { label: "Door locks", value: s.lock === "locked" ? "Locked" : s.lock === "unlocked" ? "Unlocked" : "—", level: s.lock === "unlocked" ? "warn" : s.lock ? "ok" : "none" },
    { label: "Windows", value: windowsOpen ? `${windowsOpen} open` : "Closed", level: windowsOpen ? "warn" : "ok" },
    { label: "Boot", value: open(s.doors?.trunk), level: s.doors?.trunk === "open" ? "warn" : "ok" },
    { label: "Bonnet", value: open(s.doors?.hood), level: s.doors?.hood === "open" ? "warn" : "ok" },
    { label: "Engine", value: s.isEngineOn == null ? "—" : s.isEngineOn ? "Running" : "Off", level: s.isEngineOn ? "warn" : "ok" },
    { label: "A/C", value: s.climate?.isOn ? "On" : "Off", level: "ok" },
    { label: "Oil pressure", value: s.isOilPressureLow == null ? "—" : s.isOilPressureLow ? "Warning" : "OK", level: s.isOilPressureLow ? "error" : s.isOilPressureLow == null ? "none" : "ok" },
    ...(s.batteryVoltage != null ? [{ label: "Battery voltage", value: `${s.batteryVoltage.toFixed(1)} V`, level: battery(s.batteryVoltage).level }] : []),
    { label: "Odometer", value: km(s.odometerKm), level: "none" },
    { label: "Distance to service", value: s.serviceDueKm != null ? km(s.serviceDueKm) : "—", level: (s.serviceDueKm ?? 0) < 0 ? "warn" : "none" },
  ];
  return rows;
}

/** The small form: how many systems need a look, and which. */
function DiagnosticsTile({ s }: { s: Status }) {
  const flagged = diagnosticRows(s).filter((r) => r.level === "warn" || r.level === "error");
  return (
    <Tile icon={ListChecks} title="Diagnostics" value={flagged.length ? `${flagged.length} to check` : "All OK"} tone={flagged.some((r) => r.level === "error") ? "warn" : flagged.length ? undefined : "ok"}>
      <span className={`small ${flagged.length ? "warn" : "muted"}`}>{flagged.length ? flagged.map((r) => r.label).join(", ") : "Nothing needs a look"}</span>
    </Tile>
  );
}

/** One row per system with a status dot, for a quick scan of everything the car reports. */
function Diagnostics({ s }: { s: Status }) {
  const rows = diagnosticRows(s);
  return (
    <section className="card" style={{ padding: "6px 16px" }} aria-label="System diagnostics">
      <h3 className="section-label" style={{ margin: "10px 0 4px" }}>System diagnostics</h3>
      <ul className="list diag">
        {rows.map((r) => (
          <li key={r.label}>
            <span className="muted">{r.label}</span>
            <span className="diag-value">
              {r.level !== "none" && <span className={`dot ${r.level}`} aria-hidden />}
              {r.value}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FuelTile({ s, tank }: { s: Status; tank?: number }) {
  const pct = s.fuelPercent ?? (s.fuelLitres != null && tank ? Math.min(100, (s.fuelLitres / tank) * 100) : undefined);
  return (
    <Tile icon={Fuel} title="Fuel" value={s.fuelLitres != null ? `${number(s.fuelLitres, 1)} L` : pct != null ? `${Math.round(pct)}%` : "—"}>
      {pct != null && (
        <div className={`meter ${pct < 15 ? "low" : ""}`} role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Fuel level">
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
      <span className="muted small">{s.rangeKm != null ? `${km(s.rangeKm)} range` : "Range unknown"}</span>
    </Tile>
  );
}

function DoorsTile({ s }: { s: Status }) {
  const doorsOpen = Object.entries(s.doors ?? {}).filter(([, v]) => v === "open").map(([k]) => PLACES[k] ?? k);
  const windowsOpen = Object.entries(s.windows ?? {}).filter(([, v]) => v === "open").map(([k]) => PLACES[k] ?? k);
  const open = [...doorsOpen, ...windowsOpen.map((w) => `${w} window`)];
  return (
    <Tile icon={DoorClosed} title="Doors & windows" value={s.lock === "locked" ? "Locked" : s.lock === "unlocked" ? "Unlocked" : "—"} tone={s.lock === "unlocked" ? "warn" : "ok"}>
      <span className={`small ${open.length ? "warn" : "muted"}`}>{open.length ? `Open: ${open.join(", ")}` : "All closed"}</span>
    </Tile>
  );
}

/**
 * A top-down car with each tyre's pressure beside its wheel, so left, right, front and rear
 * read at a glance. A tyre the car warns about turns amber. Tap to cycle units.
 */
function TyreTile({ tyres, warnings }: { tyres: WebStatus["tyres"]; warnings: WebStatus["tyreWarnings"] }) {
  const { tyreUnit } = usePrefs();
  const next = TYRE_UNITS[(TYRE_UNITS.findIndex((u) => u.value === tyreUnit) + 1) % TYRE_UNITS.length];
  const warn = Object.values(warnings ?? {}).some(Boolean);
  const cell = (pos: "frontLeft" | "frontRight" | "rearLeft" | "rearRight") => (
    <span className={`tyre-value ${pos.endsWith("Left") ? "left" : "right"} ${warnings?.[pos] ? "warn" : ""}`}>{pressure(tyres?.[pos], tyreUnit)}</span>
  );
  return (
    <button className={`card tile tile-button ${useContext(SizeContext)}`} onClick={() => setPref("tyreUnit", next.value)} title={`Show in ${next.label}`} aria-label={`Tyre pressure in ${unitLabel(tyreUnit)}: front left ${pressure(tyres?.frontLeft, tyreUnit)}, front right ${pressure(tyres?.frontRight, tyreUnit)}, rear left ${pressure(tyres?.rearLeft, tyreUnit)}, rear right ${pressure(tyres?.rearRight, tyreUnit)}. Show in ${next.label}`}>
      <span className="tile-head"><CircleGauge size={16} /> Tyres {warn && <span className="warn small">Check</span>}<span className="unit-chip">{unitLabel(tyreUnit)}</span></span>
      <span className="tyre-car" aria-hidden>
        {cell("frontLeft")}
        <TopDownCar warnings={warnings} />
        {cell("frontRight")}
        {cell("rearLeft")}
        {cell("rearRight")}
      </span>
    </button>
  );
}

/** Body outline with four wheels; the front is at the top. */
function TopDownCar({ warnings }: { warnings: WebStatus["tyreWarnings"] }) {
  const wheel = (x: number, y: number, on?: boolean) => <rect x={x} y={y} width="6" height="13" rx="2" className={on ? "wheel warn" : "wheel"} />;
  return (
    <svg className="tyre-svg" viewBox="0 0 36 64" width="38" height="68">
      {wheel(1, 9, warnings?.frontLeft)}
      {wheel(29, 9, warnings?.frontRight)}
      {wheel(1, 42, warnings?.rearLeft)}
      {wheel(29, 42, warnings?.rearRight)}
      <rect x="5" y="2" width="26" height="60" rx="9" className="body" />
      <rect x="9" y="15" width="18" height="10" rx="3" className="glass" />
      <rect x="9" y="44" width="18" height="7" rx="3" className="glass" />
    </svg>
  );
}

/** A reading with a heading and extras. In a wide slot the extras sit beside a bigger value. */
function Tile({ icon: Icon, title, value, tone, experimental, children }: { icon: LucideIcon; title: string; value: string; tone?: "ok" | "warn"; experimental?: boolean; children?: ReactNode }) {
  const size = useContext(SizeContext);
  return (
    <div className={`card tile ${size}`}>
      <span className="tile-head">
        <Icon size={16} /> {title}
        {experimental && <span className="chip-mini" title="Not decoded yet: raw value">Raw</span>}
      </span>
      <span className={`tile-value ${tone ?? ""}`}>{value}</span>
      {children != null && <span className="tile-extra">{children}</span>}
    </div>
  );
}

/** The small form: the address, and a link to open it. */
function LocationTile({ location }: { location: NonNullable<WebStatus["location"]> }) {
  const q = `${location.latitude},${location.longitude}`;
  const address = useAddress(location);
  return (
    <Tile icon={MapPin} title="Parked here" value={address.data ?? (address.isLoading ? "Finding…" : `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`)}>
      <a className="small" href={`https://www.google.com/maps/dir/?api=1&destination=${q}`} target="_blank" rel="noreferrer">
        Directions
      </a>
    </Tile>
  );
}

function LocationCard({ location, name }: { location: NonNullable<WebStatus["location"]>; name: string }) {
  const q = `${location.latitude},${location.longitude}`;
  const address = useAddress(location);
  return (
    <section className="card">
      <h3 className="card-title" style={{ marginBottom: 4 }}><MapPin size={18} /> Parked here</h3>
      <p className="muted small" style={{ marginBottom: 10 }}>{address.data ?? (address.isLoading ? "Finding the address…" : `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`)}</p>
      <MapView markers={[{ ...location, kind: "car", label: name }]} zoom={16} className="map short" />
      <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
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
