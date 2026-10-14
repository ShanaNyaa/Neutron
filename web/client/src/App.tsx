import { useQueryClient } from "@tanstack/react-query";
import { CarFront, Inbox, LoaderCircle, type LucideIcon, Route as RouteIcon, Settings } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { api, signedOutEvent, type Session, type WebVehicle } from "./api.ts";
import { CommandProvider } from "./components/CommandRunner.tsx";
import { href, useNotices, useRoute, useStored, useVehicles, type Route } from "./hooks.ts";
import { CarView } from "./views/CarView.tsx";
import { ConditionView } from "./views/ConditionView.tsx";
import { InboxView } from "./views/InboxView.tsx";
import { SettingsView } from "./views/SettingsView.tsx";
import { TripsView } from "./views/TripsView.tsx";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Why the last session ended, shown on the sign-in screen.
  const [notice, setNotice] = useState<string | null>(null);
  const client = useQueryClient();

  useEffect(() => {
    api.session().then(setSession, (e) => setError((e as Error).message));
    const onSignedOut = (e: Event) => {
      client.clear();
      setNotice((e as CustomEvent<string | undefined>).detail ?? null);
      setSession({ signedIn: false, account: null });
    };
    signedOutEvent.addEventListener("signedout", onSignedOut);
    return () => signedOutEvent.removeEventListener("signedout", onSignedOut);
  }, [client]);

  if (error) return <main className="center"><p className="error">Can’t reach the Mottokar server: {error}</p></main>;
  if (!session) return <main className="center"><LoaderCircle className="spin muted" /></main>;
  if (!session.signedIn)
    return (
      <SignIn
        notice={notice}
        onDone={(s) => {
          // Drop anything fetched while signed out, so nothing shows a stale error.
          client.clear();
          setNotice(null);
          setSession(s);
        }}
      />
    );
  return (
    <CommandProvider>
      <Home
        account={session.account}
        onSignOut={async () => {
          setSession(await api.logout());
          client.clear();
        }}
      />
    </CommandProvider>
  );
}

function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo">
      <rect width="64" height="64" rx="16" fill="#1f6feb" />
      <path d="M14 38l5-12a5 5 0 0 1 4.6-3h16.8a5 5 0 0 1 4.6 3l5 12v8a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-2H21v2a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2z" fill="#fff" />
      <circle cx="22" cy="38" r="3" fill="#1f6feb" />
      <circle cx="42" cy="38" r="3" fill="#1f6feb" />
    </svg>
  );
}

function SignIn({ notice, onDone }: { notice: string | null; onDone: (s: Session) => void }) {
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
        <Logo size={52} />
        <div>
          <h1>Mottokar</h1>
          <p className="muted">Sign in with your Proton Link account.</p>
        </div>
        {notice && <p className="banner warn small" role="status">{notice}</p>}
        <label className="field">
          Mobile number
          <input type="tel" autoComplete="tel" placeholder="012-345 6789" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          <small className="muted">Your Malaysian number. The +60 is added for you.</small>
        </label>
        <label className="field">
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {busy && <LoaderCircle size={18} className="spin" />} {busy ? "Signing in…" : "Sign in"}
        </button>
        <small className="muted">Your password goes only to this server, which passes it to Proton and keeps just the session tokens.</small>
      </form>
    </main>
  );
}

const NAV: { route: Route; label: string; icon: LucideIcon }[] = [
  { route: { name: "car" }, label: "Car", icon: CarFront },
  { route: { name: "trips" }, label: "Trips", icon: RouteIcon },
  { route: { name: "inbox" }, label: "Inbox", icon: Inbox },
  { route: { name: "settings" }, label: "Settings", icon: Settings },
];

function Home({ account, onSignOut }: { account: string | null; onSignOut: () => void }) {
  const route = useRoute();
  const vehicles = useVehicles();
  const notices = useNotices();
  const [savedVin, setVin] = useStored<string | null>("mottokar.vin", null);
  const list = vehicles.data ?? [];
  const vehicle: WebVehicle | undefined = list.find((v) => v.vin === savedVin) ?? list[0];
  const unread = notices.data?.filter((n) => !n.isRead).length ?? 0;
  // Proton's app titles the home screen with the plate; the sidebar already says Mottokar.
  const title =
    route.name === "car" ? (vehicle?.plate ?? vehicle?.name ?? "Mottokar") : route.name === "condition" ? "Car condition" : NAV.find((n) => n.route.name === route.name)!.label;

  useEffect(() => {
    document.title = route.name === "car" ? "Mottokar" : `${title} · Mottokar`;

  }, [route.name, title]);

  const picker = list.length > 1 && (
    <select value={vehicle?.vin} onChange={(e) => setVin(e.target.value)} aria-label="Car" style={{ width: "auto" }}>
      {list.map((v) => <option key={v.vin} value={v.vin}>{v.name}</option>)}
    </select>
  );

  const navItems = (withLabels: boolean) =>
    NAV.map((n) => {
      const Icon = n.icon;
      const active = n.route.name === route.name || (n.route.name === "car" && route.name === "condition");
      return (
        <a key={n.label} href={href(n.route)} className={`nav-item ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
          <Icon size={22} />
          <span>{n.label}</span>
          {withLabels && n.route.name === "inbox" && unread > 0 && <span className="badge" aria-label={`${unread} unread`}>{unread}</span>}
        </a>
      );
    });

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><Logo /> Mottokar</div>
        {picker}
        <nav className="stack" style={{ gap: 2 }} aria-label="Main">{navItems(true)}</nav>
        <div className="sidebar-foot small muted">{account}</div>
      </aside>

      <header className="mobile-top">
        <h1>{title}</h1>
        <span className="spacer" />
        {picker}
      </header>

      <main className="content">
        {vehicles.error && <p className="error">{(vehicles.error as Error).message} <button className="btn small" onClick={() => vehicles.refetch()}>Retry</button></p>}
        {vehicles.isLoading && <div className="skeleton" style={{ minHeight: 360 }} />}
        {vehicles.data?.length === 0 && <div className="card empty">No cars on this Proton Link account.</div>}
        {vehicle && route.name === "car" && <CarView key={vehicle.vin} vehicle={vehicle} />}
        {vehicle && route.name === "condition" && <ConditionView vehicle={vehicle} />}
        {vehicle && route.name === "trips" && <TripsView key={vehicle.vin} vin={vehicle.vin!} tripId={route.tripId} />}
        {route.name === "inbox" && <InboxView />}
        {route.name === "settings" && <SettingsView account={account} vehicles={list} onSignOut={onSignOut} />}
      </main>

      <nav className="tabbar" aria-label="Main">{navItems(true)}</nav>
    </div>
  );
}
