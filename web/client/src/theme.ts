// Theme engine: no React. CSS tokens live on :root; this sets inline overrides when the user picks a theme.

/** `c` is 18 hex colours without "#": bg, fg, black, red, green, yellow, blue, purple, cyan, white, then the 8 bright ones. */
export type ThemeChoice =
  | { kind: "system" }
  | { kind: "light" }
  | { kind: "dark" }
  | { kind: "scheme"; name: string; c: string[] };

const KEY = "neutron.theme";

// Copied from styles.css (:root and its prefers-color-scheme: dark block).
const LIGHT: Record<string, string> = {
  "--bg": "#f3f4f6",
  "--surface": "#ffffff",
  "--surface-2": "#f8f9fb",
  "--text": "#111418",
  "--muted": "#687080",
  "--border": "#e3e6ea",
  "--accent": "#1f6feb",
  "--accent-soft": "#e6efff",
  "--accent-text": "#ffffff",
  "--ok": "#15803d",
  "--ok-soft": "#e7f6ec",
  "--warn": "#b45309",
  "--warn-soft": "#fdf2e2",
  "--error": "#c62828",
  "--error-soft": "#fdecec",
  "--shadow": "0 1px 2px rgb(16 24 40 / 0.05), 0 1px 3px rgb(16 24 40 / 0.06)",
};

const DARK: Record<string, string> = {
  "--bg": "#0c0e11",
  "--surface": "#15181d",
  "--surface-2": "#1b1f25",
  "--text": "#eceef1",
  "--muted": "#949cab",
  "--border": "#262b33",
  "--accent": "#5b9bff",
  "--accent-soft": "#17253d",
  "--accent-text": "#0c0e11",
  "--ok": "#4ade80",
  "--ok-soft": "#12261a",
  "--warn": "#fbbf24",
  "--warn-soft": "#2a2010",
  "--error": "#f87171",
  "--error-soft": "#2c1414",
  "--shadow": "none",
};

// ---------- Colour helpers ----------

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

const toHex = ([r, g, b]: Rgb) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

/** `amount` of `b` mixed into `a` (0..1). */
export function mix(a: string, b: string, amount: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * amount) as Rgb);
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** True when the background is dark. Works on hex with or without "#". */
export const isDark = (bg: string) => luminance(bg.startsWith("#") ? bg : `#${bg}`) < 0.18;

// ---------- Deriving tokens ----------

const best = (candidates: string[], against: string) =>
  candidates.reduce((a, b) => (contrast(b, against) > contrast(a, against) ? b : a));

export function deriveTokens(c: string[]): Record<string, string> {
  const [bg, fg, , red, green, yellow, blue, purple, cyan, , , bRed, bGreen, bYellow, bBlue] = c.map((x) => `#${x}`);
  const dark = isDark(bg);

  let accent = best([blue, bBlue], bg);
  if (contrast(accent, bg) < 3) accent = best([blue, bBlue, cyan, purple, fg], bg);

  const pick = (normal: string, bright: string) => best([normal, bright], bg);
  const ok = pick(green, bGreen);
  const warn = pick(yellow, bYellow);
  const error = pick(red, bRed);

  return {
    "--bg": bg,
    "--text": fg,
    "--surface": mix(bg, fg, 0.05),
    "--surface-2": mix(bg, fg, 0.09),
    "--border": mix(bg, fg, 0.16),
    "--muted": mix(fg, bg, 0.4),
    "--accent": accent,
    "--accent-soft": mix(bg, accent, 0.16),
    "--accent-text": best([bg, fg], accent),
    "--ok": ok,
    "--ok-soft": mix(bg, ok, 0.16),
    "--warn": warn,
    "--warn-soft": mix(bg, warn, 0.16),
    "--error": error,
    "--error-soft": mix(bg, error, 0.16),
    "--shadow": dark ? "none" : LIGHT["--shadow"],
  };
}

// ---------- Applying ----------

function setMeta(bg: string) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  const tokenNames = Object.keys(LIGHT);

  if (choice.kind === "system") {
    for (const name of tokenNames) root.style.removeProperty(name);
    root.removeAttribute("data-scheme");
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.style.colorScheme = dark ? "dark" : "light";
    setMeta(dark ? DARK["--bg"] : LIGHT["--bg"]);
    return;
  }

  let tokens: Record<string, string>;
  if (choice.kind === "light") tokens = LIGHT;
  else if (choice.kind === "dark") tokens = DARK;
  else tokens = deriveTokens(choice.c);

  const bg = tokens["--bg"];
  const dark = choice.kind === "dark" || (choice.kind === "scheme" && isDark(bg));
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
  root.setAttribute("data-scheme", dark ? "dark" : "light");
  root.style.colorScheme = dark ? "dark" : "light";
  setMeta(bg);
}

// ---------- Persistence ----------

const isHex = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{6}$/i.test(x);

export function loadStoredTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { kind: "system" };
    const v = JSON.parse(raw) as Partial<ThemeChoice> & { name?: unknown; c?: unknown };
    if (v.kind === "light" || v.kind === "dark") return { kind: v.kind };
    if (v.kind === "scheme" && typeof v.name === "string" && Array.isArray(v.c) && v.c.length >= 18 && v.c.every(isHex)) {
      return { kind: "scheme", name: v.name, c: v.c as string[] };
    }
  } catch {
    // unavailable storage or bad JSON
  }
  return { kind: "system" };
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(choice));
  } catch {
    // not persisted
  }
}

export function applyStoredTheme(): void {
  applyTheme(loadStoredTheme());
}
