import type { Coordinate, Notice, Trip, Vehicle, VehicleStatus } from "@/core/types";

export type { Coordinate, Notice, Trip };
export type WebVehicle = Vehicle & { plate?: string; ownedSince?: number };
export type WebStatus = VehicleStatus & { location: (Coordinate & { updatedAt?: number }) | null };
export type CommandResult = { isOk: boolean; message: string; requestId?: string; isConfirmed?: boolean };
export type Stage = "cloud" | "car";
export type Session = { signedIn: boolean; account: string | null };
/** Proton's layered car pictures: file token (e.g. "DOOR_LEFT_FRONT_OPEN") → image URL. */
export type SceneAngle = { id: "top" | "fortyFive"; pack: string; layers: Record<string, string> };
export type DataUsage = { usedBytes?: number; remainingBytes?: number };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string | number,
    readonly signedOut = false,
  ) {
    super(message);
  }
}

/** Fired when the server drops the Proton session, so the app can show the sign-in screen. */
export const signedOutEvent = new EventTarget();

function fail(body: { error?: string; code?: string | number; signedOut?: boolean }, status: number): never {
  if (body.signedOut) signedOutEvent.dispatchEvent(new CustomEvent("signedout", { detail: body.error }));
  throw new ApiError(body.error ?? `HTTP ${status}`, body.code, !!body.signedOut);
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) fail(json, res.status);
  return json as T;
}

const vin = (v: string) => encodeURIComponent(v);

export const api = {
  session: () => request<Session>("/session"),
  login: (mobilePhone: string, password: string) => request<Session>("/login", { mobilePhone, password }),
  logout: () => request<Session>("/logout", {}),
  vehicles: () => request<WebVehicle[]>("/vehicles"),
  status: (v: string) => request<WebStatus>(`/vehicles/${vin(v)}/status`),
  trips: (v: string) => request<Trip[]>(`/vehicles/${vin(v)}/trips`),
  /** The route driven, in order; empty when Proton has none. */
  tripTrack: (v: string, startedAt: number, endedAt: number) =>
    request<Coordinate[]>(`/vehicles/${vin(v)}/trips/track?start=${startedAt}&end=${endedAt}`),
  scene: (v: string) => request<{ angles: SceneAngle[] }>(`/vehicles/${vin(v)}/scene`),
  dataUsage: (v: string) => request<DataUsage | null>(`/vehicles/${vin(v)}/data-usage`),
  address: (lat: number, lng: number) => request<{ address: string | null }>(`/geocode?lat=${lat}&lng=${lng}`).then((r) => r.address),
  notices: () => request<Notice[]>("/notices"),
  markRead: (id: string) => request<{ ok: true }>(`/notices/${encodeURIComponent(id)}/read`, {}),

  /** Resolves with the car's answer; `onStage` reports progress while it waits (up to ~45 s). */
  async command(v: string, command: string, body: { pin?: string; params?: Record<string, string | number> }, onStage: (s: Stage) => void) {
    const res = await fetch(`/api/vehicles/${vin(v)}/commands/${command}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) fail(await res.json().catch(() => ({})), res.status);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines.filter(Boolean)) {
        const msg = JSON.parse(line);
        if (msg.stage) onStage(msg.stage);
        if (msg.result) return msg.result as CommandResult;
        if (msg.error) fail(msg, 502);
      }
    }
    throw new ApiError("The server closed the connection before the car answered");
  },
};
