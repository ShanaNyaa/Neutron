import { create } from "zustand";
import { persist } from "zustand/middleware";

import { getProvider } from "@/core/registry";
import type { Credentials, ProviderClient, Session } from "@/core/provider";
import * as kv from "@/core/secure-kv";
import * as store from "@/core/store";
import { syncWidgets } from "@/widgets/sync";

export type Connection = {
  id: string;
  providerId: string;
  /** User-editable name, e.g. "Family car". */
  label: string;
  /** What the provider reported (phone/email/name). */
  accountLabel?: string;
  createdAt: number;
  isReauthRequired?: boolean;
};

type Secrets = { credentials: Credentials; session: Session | null };

const secretsKey = (id: string) => `connections.${id}.secrets`;

type ConnectionsState = {
  isReady: boolean;
  connections: Connection[];
  addConnection: (input: {
    providerId: string;
    label: string;
    accountLabel?: string;
    credentials: Credentials;
    session: Session;
  }) => Promise<Connection>;
  updateConnection: (id: string, patch: Partial<Pick<Connection, "label" | "isReauthRequired">>) => Promise<void>;
  reauthenticate: (id: string, credentials: Credentials, session: Session) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  getClient: (id: string) => Promise<ProviderClient>;
};

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const readSecrets = async (id: string): Promise<Secrets> => {
  const raw = await kv.getItem(secretsKey(id));
  if (!raw) throw new Error("Connection secrets missing");
  return JSON.parse(raw) as Secrets;
};
const writeSecrets = (id: string, s: Secrets) => kv.setItem(secretsKey(id), JSON.stringify(s));

const clients = new Map<string, ProviderClient>();

/**
 * Cars and snapshots stored for connections that no longer exist (e.g. from before an update that
 * changed how connections are saved) would show up twice in the widgets and pickers.
 */
function forgetOrphans() {
  const known = new Set(useConnections.getState().connections.map((c) => c.id));
  const orphans = new Set(store.allVehicles().map((v) => v.connId).filter((id) => !known.has(id)));
  if (!orphans.size) return;
  orphans.forEach(store.forgetConnection);
  syncWidgets();
}

export const useConnections = create<ConnectionsState>()(
  persist(
    (set, get) => {
      const update = (fn: (list: Connection[]) => Connection[]) => set({ connections: fn(get().connections) });

      return {
        isReady: false,
        connections: [],

        async addConnection({ providerId, label, accountLabel, credentials, session }) {
          const conn: Connection = { id: newId(), providerId, label, accountLabel, createdAt: Date.now() };
          await writeSecrets(conn.id, { credentials, session });
          update((list) => [...list, conn]);
          return conn;
        },

        async updateConnection(id, patch) {
          update((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
        },

        async reauthenticate(id, credentials, session) {
          await writeSecrets(id, { credentials, session });
          clients.delete(id);
          update((list) => list.map((c) => (c.id === id ? { ...c, isReauthRequired: false } : c)));
        },

        async removeConnection(id) {
          const client = clients.get(id);
          clients.delete(id);
          await client?.signOut?.().catch(() => {});
          await kv.removeItem(secretsKey(id));
          store.forgetConnection(id);
          syncWidgets();
          update((list) => list.filter((c) => c.id !== id));
        },

        async getClient(id) {
          const cached = clients.get(id);
          if (cached) return cached;
          const conn = get().connections.find((c) => c.id === id);
          if (!conn) throw new Error(`Unknown connection ${id}`);
          const provider = getProvider(conn.providerId);
          if (!provider) throw new Error(`Provider "${conn.providerId}" is not installed`);
          const secrets = await readSecrets(id);
          const client = provider.createClient({
            credentials: secrets.credentials,
            session: secrets.session,
            saveSession: async (session) => {
              secrets.session = session;
              await writeSecrets(id, secrets);
            },
          });
          clients.set(id, client);
          return client;
        },
      };
    },
    {
      name: "connections",
      storage: kv.persistStorage,
      partialize: (s) => ({ connections: s.connections }),
      // Also on a failed load, so the app doesn't wait forever.
      onRehydrateStorage: () => (_, error) => {
        useConnections.setState({ isReady: true });
        if (!error) forgetOrphans();
      },
    },
  ),
);
