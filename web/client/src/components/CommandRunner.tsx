import { CircleAlert, CircleCheck, LoaderCircle, X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type FormEvent, type ReactNode } from "react";

import { api, ApiError, type CommandResult, type Stage, type WebVehicle } from "../api.ts";
import { type CommandDef } from "../commands.ts";
import { useRefreshAfterCommand, useStored } from "../hooks.ts";
import { usePrefs } from "../prefs.ts";
import { Picker } from "./Picker.tsx";

type Running = { def: CommandDef; stage: Stage | "sending"; result?: CommandResult; error?: string };
type EngineRun = { vin: string; endsAt: number } | null;

type Ctx = {
  /** Opens the confirmation sheet when the command needs it, otherwise sends straight away. */
  run: (vehicle: WebVehicle, def: CommandDef) => void;
  busy: boolean;
  /** When a remote start was confirmed: the car turns the engine off by itself at `endsAt`. */
  engineRun: EngineRun;
};

const CommandContext = createContext<Ctx | null>(null);

export const useCommands = () => {
  const ctx = useContext(CommandContext);
  if (!ctx) throw new Error("useCommands outside CommandProvider");
  return ctx;
};

export function CommandProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<{ vehicle: WebVehicle; def: CommandDef } | null>(null);
  const [running, setRunning] = useState<Running | null>(null);
  // Memory only: asked for again after a reload.
  const [pin, setPin] = useState("");
  const [engineRun, setEngineRun] = useStored<EngineRun>("neutron.engineRun", null);
  const refresh = useRefreshAfterCommand();

  const send = useCallback(
    async (vehicle: WebVehicle, def: CommandDef, params?: Record<string, number>, enteredPin?: string) => {
      if (enteredPin) setPin(enteredPin);
      setPicked(null);
      setRunning({ def, stage: "sending" });
      try {
        const result = await api.command(vehicle.vin!, def.id, { pin: enteredPin || pin || undefined, params }, (stage) =>
          setRunning((r) => (r && r.def === def ? { ...r, stage } : r)),
        );
        setRunning({ def, stage: "car", result });
        if (result.isOk) {
          // Remote climate runs the engine too, and both stop by themselves when the time is up.
          if ((def.id === "engine_start" || def.id === "climate_on") && result.isConfirmed) {
            setEngineRun({ vin: vehicle.vin!, endsAt: Date.now() + (params?.minutes ?? 10) * 60_000 });
          }
          if (def.id === "engine_stop") setEngineRun(null);
          refresh(vehicle.vin!);
        }
      } catch (e) {
        // A wrong PIN fails checkPinCode; ask again next time.
        if (vehicle.isPinRequired && !(e instanceof ApiError && e.signedOut)) setPin("");
        setRunning({ def, stage: "sending", error: (e as Error).message });
      }
    },
    [pin, refresh, setEngineRun],
  );

  const run = useCallback(
    (vehicle: WebVehicle, def: CommandDef) => {
      if (def.confirm || def.params?.length || (vehicle.isPinRequired && !pin)) setPicked({ vehicle, def });
      else void send(vehicle, def);
    },
    [pin, send],
  );

  const busy = running != null && !running.result && !running.error;
  // The countdown is meaningless once it has passed.
  const activeRun = engineRun && engineRun.endsAt > Date.now() ? engineRun : null;

  return (
    <CommandContext.Provider value={{ run, busy, engineRun: activeRun }}>
      {children}
      {picked && (
        <ConfirmSheet
          def={picked.def}
          needsPin={!!picked.vehicle.isPinRequired && !pin}
          onCancel={() => setPicked(null)}
          onSend={(params, p) => void send(picked.vehicle, picked.def, params, p)}
        />
      )}
      {running && <Toast running={running} onClose={() => setRunning(null)} />}
    </CommandContext.Provider>
  );
}

function ConfirmSheet({ def, needsPin, onCancel, onSend }: {
  def: CommandDef;
  needsPin: boolean;
  onCancel: () => void;
  onSend: (params: Record<string, number> | undefined, pin?: string) => void;
}) {
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries((def.params ?? []).map((p) => [p.key, p.default])));
  const [pin, setPin] = useState("");
  const { pickerStyle } = usePrefs();
  const Icon = def.icon;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSend(def.params?.length ? values : undefined, needsPin ? pin : undefined);
  };
  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="sheet" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="sheet-title" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
        <div className="row">
          <span className="list-icon accent"><Icon size={20} /></span>
          <h2 id="sheet-title">{def.confirm ?? def.label}</h2>
          <span className="spacer" />
          <button type="button" className="btn ghost icon" onClick={onCancel} aria-label="Cancel"><X size={20} /></button>
        </div>
        {!!def.params?.length && (
          <>
            <div className={`pickers pickers-${pickerStyle}`} style={{ ["--cols" as string]: def.params.length }}>
              {def.params.map((param) => (
                <div key={param.key} className="picker-field">
                  <span className="section-label" style={{ margin: 0 }}>{param.label}</span>
                  <Picker key={pickerStyle} style={pickerStyle} param={param} value={values[param.key]} onChange={(v) => setValues((cur) => ({ ...cur, [param.key]: v }))} />
                </div>
              ))}
            </div>
          </>
        )}
        {needsPin && (
          <label className="field">
            Vehicle PIN
            <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} required autoFocus />
          </label>
        )}
        <button className="btn primary" autoFocus={!needsPin}>{def.label}</button>
      </form>
    </div>
  );
}

function Toast({ running: r, onClose }: { running: Running; onClose: () => void }) {
  const done = !!r.result || !!r.error;
  const failed = !!r.error || (r.result && !r.result.isOk);
  const text = r.error
    ? r.error
    : r.result
      ? r.result.message
      : r.stage === "sending"
        ? "Sending to Proton…"
        : r.stage === "cloud"
          ? "Proton accepted it. Waiting for the car…"
          : "The car received it. Waiting for it to finish…";
  return (
    <div className={`toast ${failed ? "error" : r.result?.isConfirmed ? "ok" : ""}`} role="status" aria-live="polite">
      <span className="toast-icon">
        {!done ? <LoaderCircle size={20} className="spin" /> : failed ? <CircleAlert size={20} /> : <CircleCheck size={20} />}
      </span>
      <span className="toast-text">
        <strong>{r.def.label}</strong>
        <br />
        <span className="small">{text}</span>
      </span>
      {done && <button className="btn small" onClick={onClose}>Dismiss</button>}
    </div>
  );
}
