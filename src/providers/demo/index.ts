import type { ProviderDefinition } from "@/core/provider";
import type { Trip, Vehicle, VehicleStatus } from "@/core/types";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let keptPin: string | null = null;

const state: VehicleStatus = {
  lock: "locked",
  fuelPercent: 62,
  rangeKm: 418,
  odometerKm: 23_845,
  isEngineOn: false,
  climate: { isOn: false, cabinTempC: 31, outsideTempC: 33, targetTempC: 22 },
  doors: { frontLeft: "closed", frontRight: "closed", rearLeft: "closed", rearRight: "closed", trunk: "closed", hood: "closed" },
  windows: { frontLeft: "closed", frontRight: "closed", rearLeft: "closed", rearRight: "closed", sunroof: "closed" },
  tyres: { frontLeft: 240, frontRight: 241, rearLeft: 238, rearRight: 236 },
  batteryVoltage: 12.6,
};

const vehicles: Vehicle[] = [
  {
    id: "DEMO00000000001",
    vin: "DEMO00000000001",
    name: "Daily",
    model: "Demo X70",
    color: "Snow White",
    isDefault: true,
    commands: ["lock", "unlock", "climate_on", "climate_off", "horn_lights", "windows_close", "trunk_open"],
  },
];

export const demoProvider: ProviderDefinition = {
  id: "demo",
  name: "Demo car",
  description: "Try the app with a simulated car. No account needed.",
  color: "#6366f1",
  icon: "flask",
  capabilities: ["status", "location", "commands", "trips", "notices"],
  commands: [
    { id: "lock", label: "Lock", icon: "lock-closed" },
    { id: "unlock", label: "Unlock", icon: "lock-open", isPinRequired: true },
    {
      id: "climate_on",
      label: "Climate",
      icon: "snow",
      isPinRequired: true,
      params: [{ key: "temp", label: "Temperature", type: "number", min: 16, max: 30, step: 0.5, default: 22, unit: "°C" }],
      timer: { defaultMinutes: 10, running: "Climate on", ended: "Climate off", stoppedBy: "climate_off", isRunning: (s) => s.climate?.isOn },
  },
    { id: "climate_off", label: "Climate Off", icon: "power" },
    { id: "horn_lights", label: "Find Car", icon: "megaphone" },
    { id: "windows_close", label: "Close Windows", icon: "contract" },
    { id: "trunk_open", label: "Open Trunk", icon: "car", isPinRequired: true },
  ],
  credentialFields: [{ key: "name", label: "Your name", type: "text", placeholder: "Alex", isOptional: true }],

  async signIn(values, challenge) {
    await wait(400);
    if (!challenge) {
      return {
        type: "challenge",
        message: "Enter any 6-digit code (this is how an OTP step looks).",
        fields: [{ key: "otp", label: "Verification code", type: "otp", placeholder: "123456" }],
        state: { name: values.name ?? "" },
      };
    }
    if (!/^\d{6}$/.test(values.otp ?? "")) throw new Error("Code must be 6 digits");
    return { type: "success", session: { token: "demo" }, accountLabel: (challenge.name as string) || "Demo driver" };
  },

  createClient() {
    return {
      async listVehicles() {
        await wait(300);
        return vehicles;
      },
      async getStatus() {
        await wait(300);
        return { ...state, updatedAt: Date.now() };
      },
      async getLocation() {
        return { latitude: 3.139, longitude: 101.6869, address: "Kuala Lumpur City Centre", updatedAt: Date.now() };
      },
      async sendCommand(_v, command, { pin, params }) {
        await wait(900);
        const needsPin = demoProvider.commands.find((c) => c.id === command)?.isPinRequired;
        if (needsPin && pin !== "1234") return { isOk: false, message: "Wrong PIN (demo PIN is 1234)" };
        if (needsPin) keptPin = pin ?? null;
        switch (command) {
          case "lock":
            state.lock = "locked";
            break;
          case "unlock":
            state.lock = "unlocked";
            break;
          case "climate_on":
            state.climate = { ...state.climate, isOn: true, targetTempC: Number(params?.temp ?? 22) };
            break;
          case "climate_off":
            state.climate = { ...state.climate, isOn: false };
            break;
          case "windows_close":
            state.windows = { frontLeft: "closed", frontRight: "closed", rearLeft: "closed", rearRight: "closed", sunroof: "closed" };
            break;
          case "trunk_open":
            state.doors = { ...state.doors, trunk: "open" };
            break;
        }
        return { isOk: true, message: "Command delivered" };
      },
      async savedPin() {
        return keptPin;
      },
      async getTrips() {
        const now = Date.now();
        return Array.from({ length: 12 }, (_, i): Trip => {
          const start = now - (i + 1) * 9 * 3600_000;
          const mins = 12 + ((i * 17) % 50);
          return {
            id: `t${i}`,
            startedAt: start,
            endedAt: start + mins * 60_000,
            durationMin: mins,
            distanceKm: Math.round(mins * 0.7 * 10) / 10,
            avgSpeedKmh: 42,
          };
        });
      },
      async renameVehicle(v, name) {
        const target = vehicles.find((x) => x.id === v.id);
        if (target) target.name = name;
      },
      async getNotices() {
        return [
          { id: "n1", title: "Service due soon", body: "Your next service is in 800 km.", createdAt: Date.now() - 3600_000, kind: "service" },
          { id: "n2", title: "Vehicle locked", body: "Daily was locked remotely.", createdAt: Date.now() - 86_400_000, isRead: true, kind: "security" },
        ];
      },
    };
  },
};
