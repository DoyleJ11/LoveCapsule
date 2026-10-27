import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';
import { encryptedStorage } from './secure-storage';
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
function validUrl(value: string) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !!url.hostname;
  } catch {
    return false;
  }
}
export const configurationError =
  !validUrl(supabaseUrl) || !supabaseAnonKey
    ? 'LoveCapsule is missing its Supabase configuration. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then rebuild the app.'
    : null;
const clientUrl = configurationError ? 'https://configuration.invalid' : supabaseUrl;
export const authStorageKey = `sb-${new URL(clientUrl).hostname.split('.')[0]}-auth-token`;
// A deliberate startup screen handles configuration; never crash during imports.
export const supabase = createClient<Database>(
  clientUrl,
  supabaseAnonKey || 'missing-configuration',
  {
    auth: {
      storage: encryptedStorage,
      storageKey: authStorageKey,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  }
);
