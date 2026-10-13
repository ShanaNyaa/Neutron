import { useCallback, useEffect, useState, type FormEvent } from "react";

import { api, ApiError, signedOutEvent, type Session, type WebVehicle } from "./api.ts";
import { CarView } from "./CarView.tsx";
import { InboxView, TripsView } from "./Lists.tsx";

type Tab = "car" | "trips" | "inbox";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.session().then(setSession, (e) => setError((e as Error).message));
    const onSignedOut = () => setSession({ signedIn: false, account: null });
    signedOutEvent.addEventListener("signedout", onSignedOut);
    return () => signedOutEvent.removeEventListener("signedout", onSignedOut);
  }, []);

  if (error) return <main className="center"><p className="error">Can’t reach the server: {error}</p></main>;
  if (!session) return <main className="center"><p className="muted">Loading…</p></main>;
  if (!session.signedIn) return <SignIn onDone={setSession} />;
  return <Home account={session.account} onSignOut={() => api.logout().then(setSession)} />;
}

function SignIn({ onDone }: { onDone: (s: Session) => void }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await api.login(phone, password));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="center">
      <form className="card signin" onSubmit={submit}>
        <h1>Mottokar</h1>
        <p className="muted">Sign in with your Proton Link account.</p>
        <label>
          Mobile number
          <input type="tel" autoComplete="tel" placeholder="012-345 6789" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          <small className="muted">Your Malaysian number. The +60 is added for you.</small>
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <small className="muted">
          Your password goes only to this server, which passes it to Proton and keeps just the session tokens.
        </small>
      </form>
    </main>
  );
}

function Home({ account, onSignOut }: { account: string | null; onSignOut: () => void }) {
  const [vehicles, setVehicles] = useState<WebVehicle[] | null>(null);
  const [vin, setVin] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("car");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.vehicles().then(
      (list) => {
        setVehicles(list);
        setVin((cur) => cur ?? list[0]?.vin ?? null);
      },
      (e) => !(e instanceof ApiError && e.signedOut) && setError((e as Error).message),
    );
  }, []);
  useEffect(load, [load]);

  const vehicle = vehicles?.find((v) => v.vin === vin);

  return (
    <div className="shell">
      <header className="topbar">
        <strong>Mottokar</strong>
        {vehicles && vehicles.length > 1 && (
          <select value={vin ?? ""} onChange={(e) => setVin(e.target.value)} aria-label="Car">
            {vehicles.map((v) => (
              <option key={v.vin} value={v.vin}>{v.name}</option>
            ))}
          </select>
        )}
        <span className="spacer" />
        <span className="muted small">{account}</span>
        <button className="ghost small" onClick={onSignOut}>Sign out</button>
      </header>

      <nav className="tabs">
        {(["car", "trips", "inbox"] as const).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "car" ? "Car" : t === "trips" ? "Trips" : "Inbox"}
          </button>
        ))}
      </nav>

      <main className="content">
        {error && (
          <p className="error">
            {error} <button className="ghost small" onClick={load}>Retry</button>
          </p>
        )}
        {!vehicles && !error && <p className="muted">Loading your cars…</p>}
        {vehicles?.length === 0 && <p className="muted">No cars on this Proton Link account.</p>}
        {vehicle && tab === "car" && <CarView key={vehicle.vin} vehicle={vehicle} />}
        {vehicle && tab === "trips" && <TripsView key={vehicle.vin} vin={vehicle.vin!} />}
        {tab === "inbox" && <InboxView />}
      </main>
    </div>
  );
}
