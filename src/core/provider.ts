import type { ImageProps } from "expo-image";

import type {
  CommandDefinition,
  CommandId,
  CommandResult,
  Coordinate,
  DataUsage,
  Notice,
  PaintOption,
  Trip,
  Vehicle,
  VehicleLocation,
  VehicleScene,
  VehicleStatus,
} from "@/core/types";

/**
 * The contract between the app and a provider. The app only ever talks to these types; everything
 * about a brand's backend (hosts, auth, payload shapes, transports) stays inside its provider.
 */

export type CredentialField = {
  key: string;
  label: string;
  type: "text" | "password" | "phone" | "email" | "otp" | "select";
  placeholder?: string;
  help?: string;
  isOptional?: boolean;
  default?: string;
  options?: { label: string; value: string }[];
};

export type Credentials = Record<string, string>;

/** Opaque to the app; must be JSON-serialisable. */
export type Session = Record<string, unknown>;

/** Opaque to the app; passed back to the next `signIn` call. */
export type SignInState = Record<string, unknown>;

export type SignInChallenge = { message: string; fields: CredentialField[]; state: SignInState };

export type SignInResult =
  | { type: "success"; session: Session; accountLabel?: string }
  | ({ type: "challenge" } & SignInChallenge);

export type Capability = "status" | "location" | "commands" | "trips" | "notices" | "imagery";

export type ProviderContext = {
  credentials: Credentials;
  session: Session | null;
  saveSession: (session: Session) => Promise<void>;
};

/** 'cloud': the provider's backend accepted it; 'car': the car received it. */
export type CommandStage = "cloud" | "car";

export type CommandOptions = {
  pin?: string;
  params?: Record<string, string | number>;
  onProgress?: (stage: CommandStage) => void;
};

export interface ProviderClient {
  listVehicles(): Promise<Vehicle[]>;
  getStatus?(vehicle: Vehicle): Promise<VehicleStatus>;
  getLocation?(vehicle: Vehicle): Promise<VehicleLocation | null>;
  sendCommand?(vehicle: Vehicle, command: CommandId, options: CommandOptions): Promise<CommandResult>;
  getTrips?(vehicle: Vehicle): Promise<Trip[]>;
  /** In driving order; empty when the provider has none. */
  getTripTrack?(vehicle: Vehicle, trip: Trip): Promise<Coordinate[]>;
  getNotices?(): Promise<Notice[]>;
  /**
   * Live while the app runs: calls `onChange` when the provider pushes something new (e.g. over a
   * socket), and the app then calls `getNotices`. Returns an unsubscribe.
   */
  watchNotices?(onChange: () => void): () => void;
  markNoticeRead?(notice: Notice): Promise<void>;
  /** A PIN the provider remembered from an earlier command, so the user isn't asked again. */
  savedPin?(): Promise<string | null>;
  getScene?(vehicle: Vehicle): Promise<VehicleScene | null>;
  getPaints?(vehicle: Vehicle): Promise<PaintOption[]>;
  /** Display-only, kept on this device; null restores the factory paint. */
  setPaint?(vehicle: Vehicle, code: string | null): Promise<void>;
  getDataUsage?(vehicle: Vehicle): Promise<DataUsage | null>;
  /** `validUntil`: when the user will have to sign in again, if the provider reports it. */
  sessionInfo?(): Promise<{ validUntil?: number; signedInAt?: number }>;
  renameVehicle?(vehicle: Vehicle, name: string): Promise<void>;
  signOut?(): Promise<void>;
}

/** One per brand or backend. Register it in `src/providers/index.ts`. */
export interface ProviderDefinition {
  id: string;
  name: string;
  description: string;
  /** Hex. */
  color: string;
  /** Ionicons name, used when `logo` isn't set. */
  icon: string;
  logo?: ImageProps["source"];
  /** Zoom for a `logo` asset with padding baked in, so it sits as large as an icon would; 1 when unset. */
  logoScale?: number;
  isComingSoon?: boolean;
  capabilities: Capability[];
  commands: CommandDefinition[];
  credentialFields: CredentialField[];
  signIn(values: Credentials, state?: SignInState): Promise<SignInResult>;
  createClient(ctx: ProviderContext): ProviderClient;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code?: string | number,
    /** The stored session is no longer usable; the user has to sign in again. */
    public readonly isReauthRequired = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
