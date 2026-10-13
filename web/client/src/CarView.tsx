import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { api, ApiError, type CommandResult, type Stage, type WebStatus, type WebVehicle } from "./api.ts";
import { COMMANDS, type CommandDef } from "./commands.ts";
import { ago, bar, km, number, temp } from "./format.ts";

export function CarView({ vehicle }: { vehicle: WebVehicle }) {
  const [status, setStatus] = useState<WebStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .status(vehicle.vin!)
      .then(setStatus, (e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [vehicle.vin]);
  useEffect(refresh, [refresh]);

  return (
    <>
      <section className="card hero">
        {vehicle.imageUrl && <img src={vehicle.imageUrl} alt="" />}
        <div>
          <h2>{vehicle.name}</h2>
          <p className="muted small">{[vehicle.plate, vehicle.color, vehicle.model].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="hero-meta">
          <span className="muted small">Updated {ago(status?.updatedAt)}</span>
          <button className="ghost small" onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}
      {status && <StatusPanel status={status} tankLitres={vehicle.fuelTankLitres} />}
      <Controls vehicle={vehicle} onDone={refresh} />
    </>
  );
}

function StatusPanel({ status: s, tankLitres }: { status: WebStatus; tankLitres?: number }) {
  const fuelPct = s.fuelPercent ?? (s.fuelLitres != null && tankLitres ? Math.min(100, (s.fuelLitres / tankLitres) * 100) : undefined);
  const open = (o?: string) => o === "open";
  const doorsOpen = Object.entries(s.doors ?? {}).filter(([, v]) => open(v)).map(([k]) => k);
  const windowsOpen = Object.entries(s.windows ?? {}).filter(([, v]) => open(v)).map(([k]) => k);
  const label = (k: string) => ({ frontLeft: "front left", frontRight: "front right", rearLeft: "rear left", rearRight: "rear right", trunk: "boot", hood: "bonnet" })[k] ?? k;

  return (
    <>
      {!!s.warnings?.length && (
        <section className="chips">
          {s.warnings.map((w) => <span key={w} className="chip warn">{w}</span>)}
        </section>
      )}

      <section className="grid">
        <Tile title="Doors" value={s.lock === "locked" ? "Locked" : s.lock === "unlocked" ? "Unlocked" : "—"} tone={s.lock === "unlocked" ? "warn" : "ok"}
          detail={doorsOpen.length ? `Open: ${doorsOpen.map(label).join(", ")}` : "All closed"} />
        <Tile title="Fuel" value={s.fuelLitres != null ? `${number(s.fuelLitres, 1)} L` : fuelPct != null ? `${Math.round(fuelPct)}%` : "—"}
          detail={`Range ${km(s.rangeKm)}`} meter={fuelPct} />
        <Tile title="Engine" value={s.isEngineOn == null ? "—" : s.isEngineOn ? "Running" : "Off"} tone={s.isEngineOn ? "warn" : undefined}
          detail={s.isParkingBrakeOn == null ? undefined : `Parking brake ${s.isParkingBrakeOn ? "on" : "off"}`} />
        <Tile title="Climate" value={s.climate?.isOn ? `On${s.climate.targetTempC ? `, ${temp(s.climate.targetTempC)}` : ""}` : "Off"}
          detail={`Inside ${temp(s.climate?.cabinTempC)} · Outside ${temp(s.climate?.outsideTempC)}`} />
        <Tile title="Windows" value={windowsOpen.length ? `${windowsOpen.length} open` : "Closed"} tone={windowsOpen.length ? "warn" : undefined}
          detail={windowsOpen.length ? windowsOpen.map(label).join(", ") : undefined} />
        <Tile title="Odometer" value={km(s.odometerKm)}
          detail={s.avgFuelLPer100km ? `Average ${number(s.avgFuelLPer100km, 1)} L/100 km` : undefined} />
        <Tile title="Tyres"
          value={Object.values(s.tyreWarnings ?? {}).some(Boolean) ? "Check pressure" : "OK"}
          tone={Object.values(s.tyreWarnings ?? {}).some(Boolean) ? "warn" : undefined}
          detail={`FL ${bar(s.tyres?.frontLeft)} · FR ${bar(s.tyres?.frontRight)} · RL ${bar(s.tyres?.rearLeft)} · RR ${bar(s.tyres?.rearRight)}`} />
        {(s.serviceDueKm != null || s.serviceDueDays != null) && (
          <Tile title="Next service"
            value={s.serviceDueKm != null ? (s.serviceDueKm < 0 ? `${km(-s.serviceDueKm)} overdue` : `in ${km(s.serviceDueKm)}`) : `in ${s.serviceDueDays} days`}
            tone={(s.serviceDueKm ?? 0) < 0 || (s.serviceDueDays ?? 0) < 0 ? "warn" : undefined}
            detail={s.serviceDueKm != null && s.serviceDueDays != null ? `or ${s.serviceDueDays} days` : undefined} />
        )}
        {s.location && (
          <Tile title="Location" value={`${s.location.latitude.toFixed(5)}, ${s.location.longitude.toFixed(5)}`}
            detail={<a href={`https://www.google.com/maps/search/?api=1&query=${s.location.latitude},${s.location.longitude}`} target="_blank" rel="noreferrer">Open in Google Maps</a>} />
        )}
      </section>
    </>
  );
}

function Tile({ title, value, detail, tone, meter }: { title: string; value: string; detail?: ReactNode; tone?: "ok" | "warn"; meter?: number }) {
  return (
    <div className="card tile">
      <span className="muted small">{title}</span>
      <strong className={tone}>{value}</strong>
      {meter != null && <div className="meter"><div style={{ width: `${meter}%` }} /></div>}
      {detail && <span className="muted small">{detail}</span>}
    </div>
  );
}

type Running = { def: CommandDef; stage: Stage | "sending"; result?: CommandResult; error?: string };

function Controls({ vehicle, onDone }: { vehicle: WebVehicle; onDone: () => void }) {
  const available = COMMANDS.filter((c) => !vehicle.commands || vehicle.commands.includes(c.id));
  const [picked, setPicked] = useState<CommandDef | null>(null);
  const [running, setRunning] = useState<Running | null>(null);
  // Kept in memory only; asked for again after a reload.
  const [pin, setPin] = useState("");

  const send = async (def: CommandDef, params?: Record<string, number>, enteredPin?: string) => {
    if (enteredPin) setPin(enteredPin);
    setPicked(null);
    setRunning({ def, stage: "sending" });
    try {
      const result = await api.command(vehicle.vin!, def.id, { pin: enteredPin || pin || undefined, params }, (stage) =>
        setRunning((r) => (r && r.def === def ? { ...r, stage } : r)),
      );
      setRunning({ def, stage: "car", result });
      if (result.isOk) onDone();
    } catch (e) {
      // A wrong PIN fails checkPinCode; ask again next time.
      if (vehicle.isPinRequired && !(e instanceof ApiError && e.signedOut)) setPin("");
      setRunning({ def, stage: "sending", error: (e as Error).message });
    }
  };

  const busy = running != null && !running.result && !running.error;

  return (
    <section className="card">
      <h3>Controls</h3>
      <div className="controls">
        {available.map((c) => (
          <button key={c.id} disabled={busy} onClick={() => (c.confirm || c.param || (vehicle.isPinRequired && !pin) ? setPicked(c) : send(c))}>
            {c.label}
          </button>
        ))}
      </div>

      {picked && (
        <Confirm def={picked} needsPin={!!vehicle.isPinRequired && !pin} onCancel={() => setPicked(null)}
          onSend={(params, enteredPin) => void send(picked, params, enteredPin)} />
      )}

      {running && <Progress running={running} onClose={() => setRunning(null)} />}
    </section>
  );
}

function Confirm({ def, needsPin, onCancel, onSend }: {
  def: CommandDef;
  needsPin: boolean;
  onCancel: () => void;
  onSend: (params: Record<string, number> | undefined, pin?: string) => void;
}) {
  const [value, setValue] = useState(def.param?.default);
  const [pin, setPin] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSend(def.param && value != null ? { [def.param.key]: value } : undefined, needsPin ? pin : undefined);
  };
  return (
    <form className="sheet" onSubmit={submit}>
      <strong>{def.confirm ?? def.label}</strong>
      {def.param && (
        <label>
          {def.param.label}
          <select value={value} onChange={(e) => setValue(Number(e.target.value))}>
            {def.param.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      )}
      {needsPin && (
        <label>
          Vehicle PIN
          <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} required autoFocus />
        </label>
      )}
      <div className="row">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button className="primary">{def.label}</button>
      </div>
    </form>
  );
}

function Progress({ running: r, onClose }: { running: Running; onClose: () => void }) {
  const done = !!r.result || !!r.error;
  const text = r.error
    ? r.error
    : r.result
      ? r.result.message
      : r.stage === "sending"
        ? "Sending to Proton…"
        : r.stage === "cloud"
          ? "Proton accepted it. Waiting for the car…"
          : "The car received it. Waiting for it to finish…";
  const tone = r.error || (r.result && !r.result.isOk) ? "error" : r.result?.isConfirmed ? "ok" : "";
  return (
    <div className={`progress ${tone}`} role="status">
      <span>
        <strong>{r.def.label}:</strong> {text}
      </span>
      {done ? <button className="ghost small" onClick={onClose}>Dismiss</button> : <span className="spinner" aria-hidden />}
    </div>
  );
}
