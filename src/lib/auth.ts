import { unregisterPushDevice } from './notifications';
import { AUTH_CALLBACK } from '../features/account/links';
import { supabase, authStorageKey } from './supabase';
import { encryptedStorage } from './secure-storage';

export async function signUp(email: string, password: string, displayName: string) {
  // Pass display_name via user metadata — a database trigger on auth.users
  // will automatically create the profiles row using this value.
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: AUTH_CALLBACK,
    },
  });

  if (authError) throw authError;
  if (!authData.user) throw new Error('Sign up failed');

  return authData;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  // Logout must work offline; pushes contain no diary text or author names.
  await unregisterPushDevice().catch(() => {});
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) {
    // A failed remote revocation must not trap this phone in an account. Clear
    // the persisted session, then use the public SDK to emit SIGNED_OUT.
    await encryptedStorage.removeItem(authStorageKey);
    const retry = await supabase.auth.signOut({ scope: 'local' });
    if (retry.error) throw retry.error;
  }
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}
