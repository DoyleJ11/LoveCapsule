import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// Use a hybrid storage adapter:
// - Values ≤ 2048 bytes go to SecureStore (encrypted, Keychain-backed)
// - Larger values (e.g. ES256 JWT sessions) go to AsyncStorage to avoid
//   the SecureStore size warning/failure in Expo SDK 54+.
const SECURE_STORE_LIMIT = 2048;

const LargeSecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    const value = await SecureStore.getItemAsync(key);
    if (value) return value;
    // Fall back to AsyncStorage for oversized values
    return AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (value.length <= SECURE_STORE_LIMIT) {
      await SecureStore.setItemAsync(key, value);
      // Clean up any previous AsyncStorage fallback
      await AsyncStorage.removeItem(key);
    } else {
      // Too large for SecureStore — use AsyncStorage
      await AsyncStorage.setItem(key, value);
      // Clean up any previous SecureStore entry
      try {
        await SecureStore.deleteItemAsync(key);
      } catch {}
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {}
    await AsyncStorage.removeItem(key);
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Missing Supabase environment variables. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: LargeSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
