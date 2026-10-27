import { supabase } from '../../lib/supabase';
import { encryptedStorage } from '../../lib/secure-storage';
import { clearLocalDrafts } from '../entries/drafts';
import { Directory, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uuid } from 'expo-modules-core';
export interface DeletionReceipt {
  id: string;
  records_deleted: boolean;
  cleanup_pending: number;
  cleanup_failed: number;
  status: 'complete' | 'cleanup_pending' | 'needs_attention';
}
const requests = new Map<string, string>();
const flights = new Map<string, Promise<DeletionReceipt>>();
/** Keep the ID after an unknown response; retry confirms the same deletion. */
export async function requestDeletion(
  kind: 'entry' | 'unpair' | 'account',
  target: string
): Promise<DeletionReceipt> {
  const { data: session, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const user = session.session?.user.id;
  if (!user) throw new Error('Sign in before deleting.');
  const key = `deletion:v1:${user}:${kind}:${target}`;
  const existing = flights.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const id = requests.get(key) ?? (await encryptedStorage.getItem(key)) ?? uuid.v4();
    requests.set(key, id);
    await encryptedStorage.setItem(key, id);
    const { data, error } = await supabase.rpc('request_deletion', {
      p_id: id,
      p_kind: kind,
      p_target: target,
    });
    if (error) throw error;
    if (!data?.records_deleted)
      throw new Error('Deletion confirmation was not received. Please retry.');
    if (kind !== 'entry') {
      await clearLocalDrafts(encryptedStorage, user, kind === 'unpair' ? target : undefined);
      // Remove legacy plaintext drafts too, even if they were never opened after upgrade.
      const prefix = `entry_draft:v1:${user}:${kind === 'unpair' ? target + ':' : ''}`;
      const legacy = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
      await AsyncStorage.multiRemove(legacy);
      const folder =
        kind === 'unpair'
          ? new Directory(Paths.document, 'entry-drafts', user, target)
          : new Directory(Paths.document, 'entry-drafts', user);
      if (folder.exists) folder.delete();
    }
    return data;
  })();
  flights.set(key, pending);
  void pending
    .finally(() => {
      if (flights.get(key) === pending) flights.delete(key);
    })
    .catch(() => {});
  return pending;
}
