const number = (n: number, digits = 0) => n.toLocaleString(undefined, { maximumFractionDigits: digits });

// One decimal for short distances (an 11.3 km trip), whole kilometres beyond 100.
export const km = (n?: number) => (n == null ? "—" : `${number(n, Math.abs(n) < 100 ? 1 : 0)} km`);

export function ago(ms?: number) {
  if (!ms) return "unknown";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export const dateTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export const minutes = (m?: number) => {
  if (m == null) return "—";
  const h = Math.floor(m / 60);
  return h ? `${h} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`;
};

export const temp = (c?: number) => (c == null ? "—" : `${number(c, 1)} °C`);


export { number };
