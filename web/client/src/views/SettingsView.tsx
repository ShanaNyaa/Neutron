import { Download, LogOut, Monitor, Smartphone, TabletSmartphone, Trash2, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { WebVehicle } from "../api.ts";
import { COMMANDS } from "../commands.ts";
import { Picker } from "../components/Picker.tsx";
import { AppearanceSettings } from "../components/ThemePicker.tsx";
import { useCommandLog } from "../hooks.ts";
import { PICKER_STYLES, setPref, TYRE_UNITS, usePrefs } from "../prefs.ts";

type InstallPrompt = Event & { prompt: () => Promise<void> };

// One row per platform, so each person can find theirs at a glance.
const INSTALL_STEPS: { icon: LucideIcon; platform: string; browser: string; steps: string }[] = [
  { icon: Smartphone, platform: "iPhone and iPad", browser: "Safari", steps: "Tap Share, then Add to Home Screen." },
  { icon: TabletSmartphone, platform: "Android", browser: "Chrome", steps: "Tap the ⋮ menu, then Install app (or Add to Home screen)." },
  { icon: Monitor, platform: "Desktop", browser: "Chrome, Edge or Helium", steps: "Click the install icon at the right of the address bar." },
];

export function SettingsView({
  account,
  vehicles,
  onSignOut,
  onDeleteData,
}: {
  account: string | null;
  vehicles: WebVehicle[];
  onSignOut: () => void;
  onDeleteData: () => Promise<void>;
}) {
  // Chrome, Edge and Android offer installing the app; Safari doesn't fire this.
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const installed = typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches;
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <div className="page-head desktop-only">
        <h1>Settings</h1>
      </div>

      <AppearanceSettings />

      <UnitsCard />

      <PickerCard />

      <AccountCard account={account} vehicles={vehicles} onSignOut={onSignOut} onDeleteData={onDeleteData} />

      <CommandLogCard vehicles={vehicles} />

      <section className="card">
        <h3 className="card-title">Cars</h3>
        <ul className="list">
          {vehicles.map((v) => (
            <li key={v.vin} className="list-row" style={{ padding: "10px 0" }}>
              <span className="list-body">
                <strong>{v.name}</strong>
                <span className="muted small">{[v.plate, v.model, v.color].filter(Boolean).join(" · ")}</span>
                <span className="muted tiny">
                  VIN {v.vin}
                  {v.ownedSince ? ` · Owned since ${new Date(v.ownedSince).toLocaleDateString(undefined, { month: "long", year: "numeric" })}` : ""}
                  {v.isPinRequired ? " · Commands need your PIN" : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3 className="card-title">Use it like an app</h3>
        {installed ? (
          <p className="muted small">Neutron is installed on this device.</p>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {install && (
              <button className="btn primary" onClick={() => install.prompt().then(() => setInstall(null))}>
                <Download size={18} /> Install Neutron
              </button>
            )}
            <ul className="list">
              {INSTALL_STEPS.map(({ icon: Icon, platform, browser, steps }) => (
                <li key={platform} className="list-row" style={{ padding: "10px 0" }}>
                  <span className="list-icon"><Icon size={18} /></span>
                  <span className="list-body">
                    <strong>{platform} <span className="muted small" style={{ fontWeight: 400 }}>· {browser}</span></strong>
                    <span className="small muted">{steps}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <p className="muted tiny">
        Neutron is unofficial and not affiliated with Proton. It uses the same service as Proton Link, so Proton can change or block it at any time.
        It's built on <a href="https://github.com/zekr89/mottokar" target="_blank" rel="noreferrer">Mottokar</a> by Zackry Rosli and is licensed under GPL-3.0.
      </p>
    </div>
  );
}

function AccountCard({
  account,
  vehicles,
  onSignOut,
  onDeleteData,
}: {
  account: string | null;
  vehicles: WebVehicle[];
  onSignOut: () => void;
  onDeleteData: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section className="card">
      <h3 className="card-title">Proton Link account</h3>
      <p>{account ?? "Signed in"}</p>
      <p className="muted small" style={{ marginTop: 4 }}>
        Your Proton session is kept on the Neutron server, not in this browser, and only you can use it. Signing out ends it
        on this device; signing out of the last device removes it from the server.
      </p>
      <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
        <button className="btn" onClick={onSignOut}>
          <LogOut size={18} /> Sign out
        </button>
        {!confirming && (
          <button className="btn danger" onClick={() => setConfirming(true)}>
            <Trash2 size={18} /> Delete my data
          </button>
        )}
      </div>
      {confirming && (
        <div className="banner warn small" role="alertdialog" style={{ marginTop: 12 }}>
          <p>
            This removes your Proton session, your sign-ins on every device and your command log from the server. Nothing changes on
            Proton's side{vehicles.length ? " or on your car" : ""}. You can sign in again at any time.
          </p>
          <div className="row" style={{ marginTop: 8, gap: 8 }}>
            <button
              className="btn danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onDeleteData();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Deleting…" : "Delete everything"}
            </button>
            <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** What this person has sent to their car through this server, newest first. */
function CommandLogCard({ vehicles }: { vehicles: WebVehicle[] }) {
  const log = useCommandLog();
  const nameOf = (vin: string) => vehicles.find((v) => v.vin === vin)?.name ?? vin;
  const labelOf = (id: string) => COMMANDS.find((c) => c.id === id)?.label ?? id;
  return (
    <section className="card">
      <h3 className="card-title">Command log</h3>
      <p className="muted small" style={{ marginBottom: 8 }}>
        Commands you've sent through Neutron. The server keeps this log with your account; nobody else can see it.
      </p>
      {log.isLoading && <div className="skeleton" style={{ minHeight: 48 }} />}
      {log.error && <p className="error small">{(log.error as Error).message}</p>}
      {log.data?.length === 0 && <p className="muted small">No commands sent yet.</p>}
      {!!log.data?.length && (
        <ul className="list">
          {log.data.slice(0, 50).map((e, i) => (
            <li key={`${e.time}-${i}`} className="list-row" style={{ padding: "8px 0" }}>
              <span className="list-body">
                <strong>
                  {labelOf(e.command)}
                  {vehicles.length > 1 ? <span className="muted small" style={{ fontWeight: 400 }}> · {nameOf(e.vin)}</span> : null}
                </strong>
                <span className={`small ${e.result === "ok" ? "muted" : "error"}`}>
                  {new Date(e.time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  {e.result === "ok" ? "" : ` · ${e.result}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function UnitsCard() {
  const { tyreUnit } = usePrefs();
  return (
    <section className="card">
      <h3 className="card-title">Units</h3>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <span>
          Tyre pressure
          <br />
          <span className="muted small">Proton reports kPa. You can also tap the Tyres tile to switch.</span>
        </span>
        <div className="segmented" role="radiogroup" aria-label="Tyre pressure unit">
          {TYRE_UNITS.map((u) => (
            <button key={u.value} role="radio" aria-checked={tyreUnit === u.value} className={tyreUnit === u.value ? "active" : ""} onClick={() => setPref("tyreUnit", u.value)}>
              {u.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** How temperature and run time are picked in command sheets, with a live preview to try. */
function PickerCard() {
  const { pickerStyle } = usePrefs();
  const sample = COMMANDS.find((c) => c.id === "climate_on")!.params![0];
  const [value, setValue] = useState(sample.default);
  const current = PICKER_STYLES.find((p) => p.value === pickerStyle)!;
  return (
    <section className="card">
      <h3 className="card-title">Option picker</h3>
      <p className="muted small" style={{ marginBottom: 12 }}>How you choose a temperature or run time before sending a command.</p>
      <div className="segmented" role="radiogroup" aria-label="Option picker style">
        {PICKER_STYLES.map((p) => (
          <button key={p.value} role="radio" aria-checked={pickerStyle === p.value} className={pickerStyle === p.value ? "active" : ""} onClick={() => setPref("pickerStyle", p.value)}>
            {p.label}
          </button>
        ))}
      </div>
      <p className="muted small" style={{ margin: "8px 0 12px" }}>{current.hint}. Try it:</p>
      <div className={`pickers pickers-${pickerStyle}`} style={{ ["--cols" as string]: 1, maxWidth: 320, marginInline: "auto" }}>
        <div className="picker-field">
          <span className="section-label" style={{ margin: 0 }}>{sample.label}</span>
          <Picker key={pickerStyle} style={pickerStyle} param={sample} value={value} onChange={setValue} />
        </div>
      </div>
    </section>
  );
}
