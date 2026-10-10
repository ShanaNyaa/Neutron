import { create } from "zustand";

// In-memory, capped at MAX entries; everything is redacted on the way in.
export type LogLevel = "info" | "warn" | "error";
/** `push`: live messages from a provider (sockets, MQTT, etc.). */
export type LogCategory = "http" | "push" | "command" | "data" | "app";
export type LogEntry = { id: number; at: number; level: LogLevel; category: LogCategory; message: string; detail?: string };

const MAX = 500;
const DETAIL_MAX = 6000;
const useEntries = create(() => ({ entries: [] as LogEntry[] }));
let seq = 0;

const SECRET_KEY = /token|password|passwd|secret|authori[sz]ation|pin(code)?$|^pin|mqpassword|cookie|mobile|phone|msisdn/i;
const VIN = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
// International format only: bare digit runs are too often timestamps or ids.
const PHONE = /\+\d{8,15}\b/g;
const BEARER = /(Bearer\s+)[\w\-.~+/=]+/gi;

function redactString(s: string) {
  return s.replace(BEARER, "$1[redacted]").replace(VIN, (v) => `...${v.slice(-4)}`).replace(PHONE, "[phone]");
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "...";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

function format(detail: unknown): string | undefined {
  if (detail === undefined) return undefined;
  let text: string;
  if (typeof detail === "string") {
    // JSON text is parsed so its keys can be redacted too.
    try {
      text = JSON.stringify(redact(JSON.parse(detail)), null, 2);
    } catch {
      text = redactString(detail);
    }
  } else if (detail instanceof Error) {
    text = redactString(`${detail.name}: ${detail.message}`);
  } else {
    try {
      text = JSON.stringify(redact(detail), null, 2);
    } catch {
      text = String(detail);
    }
  }
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}\n... (${text.length - DETAIL_MAX} more characters)` : text;
}

export function log(category: LogCategory, message: string, detail?: unknown, level: LogLevel = "info") {
  try {
    const entry: LogEntry = { id: ++seq, at: Date.now(), level, category, message: redactString(message), detail: format(detail) };
    useEntries.setState((s) => ({ entries: [...s.entries.slice(-(MAX - 1)), entry] }));
    if (__DEV__) {
      console.log(`[${category}] ${message}${level !== "info" && entry.detail ? `\n${entry.detail}` : ""}`);
    }
  } catch {
    // Logging must never break the app.
  }
}

export const logWarn = (category: LogCategory, message: string, detail?: unknown) => log(category, message, detail, "warn");
export const logError = (category: LogCategory, message: string, detail?: unknown) => log(category, message, detail, "error");

export function clearLogs() {
  useEntries.setState({ entries: [] });
}

export const useLogs = () => useEntries((s) => s.entries);

export function exportLogs() {
  return useEntries
    .getState()
    .entries.map((e) => `${new Date(e.at).toISOString()} ${e.level.toUpperCase()} [${e.category}] ${e.message}${e.detail ? `\n${e.detail}` : ""}`)
    .join("\n\n");
}
