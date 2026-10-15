import { useEffect, useMemo, useState } from "react";

import { applyTheme, isDark, loadStoredTheme, saveTheme, type ThemeChoice } from "../theme.ts";

type Theme = { n: string; c: string[] };
type Filter = "dark" | "light" | "all";

const PAGE = 100;
const DOTS = [3, 4, 5, 6, 7, 8]; // red, green, yellow, blue, purple, cyan

let cache: Promise<Theme[]> | undefined;
const loadThemes = () =>
  (cache ??= fetch("/themes.json")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<Theme[]>;
    })
    .catch((e) => {
      cache = undefined;
      throw e;
    }));

function Preview({ c }: { c: string[] }) {
  return (
    <span aria-hidden style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 8, background: `#${c[0]}`, border: "1px solid var(--border)", flex: "none" }}>
      <span style={{ color: `#${c[1]}`, fontWeight: 700, fontSize: "0.85rem" }}>Aa</span>
      {DOTS.map((i) => (
        <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: `#${c[i]}` }} />
      ))}
    </span>
  );
}

function ThemeList({ current, onPick }: { current: string | undefined; onPick: (t: Theme) => void }) {
  const [themes, setThemes] = useState<Theme[]>();
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    loadThemes().then(setThemes, () => setFailed(true));
  }, []);

  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (themes ?? []).filter(
      (t) =>
        words.every((w) => t.n.toLowerCase().includes(w)) &&
        (filter === "all" || isDark(t.c[0]) === (filter === "dark")),
    );
  }, [themes, query, filter]);

  useEffect(() => setShown(PAGE), [query, filter]);

  return (
    <div className="stack">
      <label className="field">
        <span className="small muted">Search themes</span>
        <input type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. dracula, solarized light" />
      </label>
      <div className="segmented" role="group" aria-label="Brightness">
        {(["all", "dark", "light"] as const).map((f) => (
          <button key={f} type="button" className={filter === f ? "active" : undefined} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "dark" ? "Dark" : "Light"}
          </button>
        ))}
      </div>
      {failed ? (
        <p className="small muted">Couldn't load the theme list.</p>
      ) : !themes ? (
        <p className="small muted">Loading themes…</p>
      ) : (
        <>
          <p className="small muted" aria-live="polite">
            {query || filter !== "all" ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}` : `${themes.length} themes`}
          </p>
          <ul className="list" style={{ maxHeight: 420, overflowY: "auto" }}>
            {matches.slice(0, shown).map((t) => (
              <li key={t.n}>
                <button type="button" className="list-row" style={{ alignItems: "center" }} aria-current={t.n === current ? "true" : undefined} onClick={() => onPick(t)}>
                  <Preview c={t.c} />
                  <span className="list-body" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.n}
                  </span>
                  {t.n === current && <span aria-hidden>✓</span>}
                </button>
              </li>
            ))}
          </ul>
          {matches.length > shown && (
            <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({matches.length - shown} left)
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function AppearanceSettings() {
  const [choice, setChoice] = useState<ThemeChoice>(loadStoredTheme);
  const [browsing, setBrowsing] = useState(false);

  const set = (next: ThemeChoice) => {
    setChoice(next);
    applyTheme(next);
    saveTheme(next);
  };

  const options: { id: ThemeChoice["kind"]; label: string }[] = [
    { id: "system", label: "System" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
    { id: "scheme", label: "Terminal theme" },
  ];

  const choose = (id: ThemeChoice["kind"]) => {
    if (id === "scheme") {
      setBrowsing(true);
      if (choice.kind !== "scheme") return; // wait for a pick; nothing to apply yet
      return;
    }
    setBrowsing(false);
    set({ kind: id });
  };

  return (
    <section className="card stack">
      <h2 className="card-title">Appearance</h2>
      <div className="segmented wrap" role="group" aria-label="Theme">
        {options.map((o) => (
          <button key={o.id} type="button" className={choice.kind === o.id || (o.id === "scheme" && browsing) ? "active" : undefined} aria-pressed={choice.kind === o.id} onClick={() => choose(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      {choice.kind === "scheme" && (
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span className="small">
            Current: <strong>{choice.name}</strong>
          </span>
          <button type="button" className="btn small" onClick={() => setBrowsing((b) => !b)} aria-expanded={browsing}>
            {browsing ? "Hide themes" : "Browse themes"}
          </button>
        </div>
      )}
      {browsing && (
        <ThemeList current={choice.kind === "scheme" ? choice.name : undefined} onPick={(t) => set({ kind: "scheme", name: t.n, c: t.c })} />
      )}
      <p className="small muted">
        Terminal colour schemes from <a href="https://iterm2colorschemes.com/" target="_blank" rel="noreferrer">iTerm2-Color-Schemes</a> (MIT).
      </p>
    </section>
  );
}
