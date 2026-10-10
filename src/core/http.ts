import { log, logError } from "@/lib/log";

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  /** Arrays repeat the key (`a=1&a=2`). */
  query?: Record<string, string | number | boolean | (string | number)[] | undefined | null>;
  /** Objects are sent as JSON; strings/FormData are sent as-is. */
  body?: unknown;
  timeoutMs?: number;
};

export async function httpRequest<T = unknown>(baseUrl: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(path.replace(/^\//, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
    else if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (typeof opts.body === "string" || opts.body instanceof FormData) {
      body = opts.body as BodyInit;
    } else {
      body = JSON.stringify(opts.body);
      headers["Content-Type"] ??= "application/json; charset=UTF-8";
    }
  }

  const method = opts.method ?? "GET";
  const started = Date.now();
  // Host + path only in the title; query and bodies go in the (redacted) detail.
  const label = `${method} ${url.host}${url.pathname}`;
  const request = { query: opts.query, body: opts.body };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(url.toString(), { method, headers, body, signal: controller.signal });
  } catch (e) {
    const message = controller.signal.aborted ? "Request timed out" : `Network error: ${(e as Error).message}`;
    logError("http", `${label} failed: ${message}`, { request, ms: Date.now() - started });
    throw new HttpError(message, 0);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body, keep text
  }
  // Some backends answer HTTP 200 with an error inside the envelope; the body shows which.
  log("http", `${label} → ${res.status} (${Date.now() - started} ms)`, { request, response: parsed }, res.ok ? "info" : "error");
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, parsed);
  return parsed as T;
}
