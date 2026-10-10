import * as SecureStore from "expo-secure-store";
import { createJSONStorage } from "zustand/middleware";

import { isIOS, KEYCHAIN_GROUP } from "@/core/shared";

// Values are chunked: some platforms reject entries above ~2KB, and JWT sessions exceed that.
const CHUNK = 1800;
const local: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};
// iOS: a Keychain group shared with the widget and intents extensions so they can use the session.
// AFTER_FIRST_UNLOCK so they can read it in the background (e.g. from Control Center).
const shared: SecureStore.SecureStoreOptions = isIOS ? { ...local, accessGroup: KEYCHAIN_GROUP } : local;

// Falls back to the app's own Keychain when the group is unavailable (a build without the entitlement).
let opts = shared;
async function withGroup<T>(fn: (o: SecureStore.SecureStoreOptions) => Promise<T>): Promise<T> {
  try {
    return await fn(opts);
  } catch (e) {
    if (opts === local) throw e;
    opts = local;
    return fn(opts);
  }
}

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

export async function getItem(key: string): Promise<string | null> {
  const head = await withGroup((o) => SecureStore.getItemAsync(safe(key), o));
  if (head === null) return null;
  const m = /^chunks:(\d+)$/.exec(head);
  if (!m) return head;
  const parts: string[] = [];
  for (let i = 0; i < Number(m[1]); i++) {
    const part = await withGroup((o) => SecureStore.getItemAsync(safe(`${key}.${i}`), o));
    if (part === null) return null;
    parts.push(part);
  }
  return parts.join("");
}

/** `whenUnlocked` values are readable only while the phone is unlocked, and are never chunked. */
export async function setItem(key: string, value: string, { whenUnlocked = false } = {}): Promise<void> {
  await removeItem(key);
  if (whenUnlocked) {
    await withGroup((o) => SecureStore.setItemAsync(safe(key), value, { ...o, keychainAccessible: SecureStore.WHEN_UNLOCKED }));
    return;
  }
  if (value.length <= CHUNK) {
    await withGroup((o) => SecureStore.setItemAsync(safe(key), value, o));
    return;
  }
  const count = Math.ceil(value.length / CHUNK);
  for (let i = 0; i < count; i++) {
    await withGroup((o) => SecureStore.setItemAsync(safe(`${key}.${i}`), value.slice(i * CHUNK, (i + 1) * CHUNK), o));
  }
  await withGroup((o) => SecureStore.setItemAsync(safe(key), `chunks:${count}`, o));
}

export async function removeItem(key: string): Promise<void> {
  const head = await withGroup((o) => SecureStore.getItemAsync(safe(key), o));
  const m = head ? /^chunks:(\d+)$/.exec(head) : null;
  if (m) {
    for (let i = 0; i < Number(m[1]); i++) await withGroup((o) => SecureStore.deleteItemAsync(safe(`${key}.${i}`), o));
  }
  await withGroup((o) => SecureStore.deleteItemAsync(safe(key), o));
}

/** Zustand `persist` storage backed by the Keychain/Keystore. */
export const persistStorage = createJSONStorage(() => ({ getItem, setItem, removeItem }));
