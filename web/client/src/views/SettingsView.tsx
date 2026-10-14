import { Download, LogOut, Monitor, Smartphone, TabletSmartphone, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { WebVehicle } from "../api.ts";
import { COMMANDS } from "../commands.ts";
import { Picker } from "../components/Picker.tsx";
import { AppearanceSettings } from "../components/ThemePicker.tsx";
import { PICKER_STYLES, setPref, TYRE_UNITS, usePrefs } from "../prefs.ts";

type InstallPrompt = Event & { prompt: () => Promise<void> };

// One row per platform, so each person can find theirs at a glance.
const INSTALL_STEPS: { icon: LucideIcon; platform: string; browser: string; steps: string }[] = [
  { icon: Smartphone, platform: "iPhone and iPad", browser: "Safari", steps: "Tap Share, then Add to Home Screen." },
  { icon: TabletSmartphone, platform: "Android", browser: "Chrome", steps: "Tap the ⋮ menu, then Install app (or Add to Home screen)." },
  { icon: Monitor, platform: "Desktop", browser: "Chrome, Edge or Helium", steps: "Click the install icon at the right of the address bar." },
];

export function SettingsView({ account, vehicles, onSignOut }: { account: string | null; vehicles: WebVehicle[]; onSignOut: () => void }) {
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

      <section className="card">
        <h3 className="card-title">Proton Link account</h3>
        <p>{account ?? "Signed in"}</p>
        <p className="muted small" style={{ marginTop: 4 }}>
          Your session is kept on the Neutron server, not in this browser. Signing out removes it.
        </p>
        <button className="btn danger" style={{ marginTop: 12 }} onClick={onSignOut}>
          <LogOut size={18} /> Sign out
        </button>
      </section>

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
