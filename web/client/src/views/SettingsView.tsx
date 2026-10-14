import { Download, LogOut, Monitor, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

import type { WebVehicle } from "../api.ts";
import { AppearanceSettings } from "../components/ThemePicker.tsx";
import { setPref, TYRE_UNITS, usePrefs } from "../prefs.ts";

type InstallPrompt = Event & { prompt: () => Promise<void> };

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

      <section className="card">
        <h3 className="card-title">Proton Link account</h3>
        <p>{account ?? "Signed in"}</p>
        <p className="muted small" style={{ marginTop: 4 }}>
          Your session is kept on the Mottokar server, not in this browser. Signing out removes it.
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
          <p className="muted small">Mottokar is installed on this device.</p>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {install && (
              <button className="btn primary" onClick={() => install.prompt().then(() => setInstall(null))}>
                <Download size={18} /> Install Mottokar
              </button>
            )}
            <p className="row small muted"><Smartphone size={16} /> iPhone: Share, then Add to Home Screen. Android: menu, then Install app.</p>
            <p className="row small muted"><Monitor size={16} /> Desktop Chrome, Edge or Helium: the install icon in the address bar.</p>
          </div>
        )}
      </section>

      <p className="muted tiny">
        Mottokar is unofficial and not affiliated with Proton. It uses the same service as Proton Link, so Proton can change or block it at any time.
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
