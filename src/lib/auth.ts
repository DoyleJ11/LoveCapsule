import { supabase } from './supabase';

export async function signUp(email: string, password: string, displayName: string) {
  // Pass display_name via user metadata — a database trigger on auth.users
  // will automatically create the profiles row using this value.
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
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
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}
