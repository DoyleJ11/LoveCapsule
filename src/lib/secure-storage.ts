import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uuid } from 'expo-modules-core';
type Part = { id: string; count: number };
type Manifest = { deleted?: boolean; active: Part | null; pending?: Part; garbage: Part[] };
const queues = new Map<string, Promise<unknown>>();
/** Keep each value below the native byte limit, including multibyte characters. */
export function splitSecureValue(value: string, limit = 1800): string[] {
  const parts: string[] = [];
  let chunk = '',
    bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    const size = code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
    if (bytes + size > limit) {
      parts.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += char;
    bytes += size;
  }
  parts.push(chunk);
  return parts;
}
const safeKey = (key: string) =>
  'lc2.' + key.replace(/[^A-Za-z0-9.-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const pending = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
  queues.set(key, pending);
  void pending
    .finally(() => {
      if (queues.get(key) === pending) queues.delete(key);
    })
    .catch(() => {});
  return pending;
}
async function manifest(key: string): Promise<Manifest> {
  const raw = await SecureStore.getItemAsync(key);
  return raw ? JSON.parse(raw) : { active: null, garbage: [] };
}
async function write(key: string, value: string) {
  const old = await manifest(key);
  const chunks = splitSecureValue(value);
  const part = { id: uuid.v4(), count: chunks.length };
  const garbage = [...old.garbage, ...(old.pending ? [old.pending] : [])];
  // Record pending chunks first: crash recovery can always find incomplete data.
  await SecureStore.setItemAsync(key, JSON.stringify({ ...old, pending: part, garbage }));
  for (let i = 0; i < chunks.length; i++)
    await SecureStore.setItemAsync(`${key}.${part.id}.${i}`, chunks[i]);
  const committed: Manifest = {
    active: part,
    garbage: [...garbage, ...(old.active ? [old.active] : [])],
  };
  await SecureStore.setItemAsync(key, JSON.stringify(committed));
  // Old chunks remain encrypted if cleanup fails. Never invalidate the committed value.
  const remaining: Part[] = [];
  for (const stale of committed.garbage) {
    try {
      for (let i = 0; i < stale.count; i++)
        await SecureStore.deleteItemAsync(`${key}.${stale.id}.${i}`);
    } catch {
      remaining.push(stale);
    }
  }
  try {
    await SecureStore.setItemAsync(key, JSON.stringify({ active: part, garbage: remaining }));
  } catch {
    /* committed manifest already contains recoverable references */
  }
}
export const encryptedStorage = {
  getItem: (key: string) =>
    serial(key, async () => {
      const id = safeKey(key);
      const m = await manifest(id);
      if (m.deleted) return null;
      if (m.active) {
        const chunks = [];
        for (let i = 0; i < m.active.count; i++) {
          const chunk = await SecureStore.getItemAsync(`${id}.${m.active.id}.${i}`);
          if (chunk === null) throw new Error('Encrypted local data is incomplete. Please retry.');
          chunks.push(chunk);
        }
        await AsyncStorage.removeItem(key);
        return chunks.join('');
      }
      // Read old small-Keychain / plaintext fallback only to migrate it. Never
      // interpret a storage/network failure as an absent draft or session.
      const legacy =
        (await SecureStore.getItemAsync(key).catch((error) => {
          if (/invalid.*key/i.test(String(error))) return null;
          throw error;
        })) ?? (await AsyncStorage.getItem(key));
      if (legacy !== null) {
        await write(id, legacy);
        await AsyncStorage.removeItem(key);
        if (/^[\w.-]+$/.test(key)) await SecureStore.deleteItemAsync(key);
      }
      return legacy;
    }),
  setItem: (key: string, value: string) =>
    serial(key, async () => {
      await write(safeKey(key), value);
      await AsyncStorage.removeItem(key);
    }),
  removeItem: (key: string) =>
    serial(key, async () => {
      const id = safeKey(key),
        m = await manifest(id); // tombstone first so old writes cannot resurrect data
      await SecureStore.setItemAsync(
        id,
        JSON.stringify({
          deleted: true,
          active: null,
          garbage: [
            ...m.garbage,
            ...(m.active ? [m.active] : []),
            ...(m.pending ? [m.pending] : []),
          ],
        })
      );
      await AsyncStorage.removeItem(key);
      if (/^[\w.-]+$/.test(key)) await SecureStore.deleteItemAsync(key);
      for (const p of [
        ...m.garbage,
        ...(m.active ? [m.active] : []),
        ...(m.pending ? [m.pending] : []),
      ])
        for (let i = 0; i < p.count; i++) await SecureStore.deleteItemAsync(`${id}.${p.id}.${i}`);
      await SecureStore.deleteItemAsync(id);
    }),
};
