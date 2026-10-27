import { recordFailure, clearDiagnostics } from '../lib/diagnostics';
import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { clearEntryLists } from '../features/entries/list';
import { errorMessage } from '../lib/errors';
import type { Profile } from '../types/database';
interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  recovery: boolean;
  refreshProfile: () => Promise<void>;
  finishRecovery: () => void;
}
const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  error: null,
  recovery: false,
  refreshProfile: async () => {},
  finishRecovery: () => {},
});
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null),
    [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [recovery, setRecovery] = useState(false);
  const current = useRef<string | null>(null),
    generation = useRef(0),
    alive = useRef(true);
  const loadedProfile = useRef<string | null>(null);
  const profileFlight = useRef<{ id: string; promise: Promise<void> } | null>(null);
  const fetchProfile = useCallback((user: User): Promise<void> => {
    if (profileFlight.current?.id === user.id) return profileFlight.current.promise;
    const ticket = generation.current;
    const valid = () =>
      alive.current && current.current === user.id && generation.current === ticket;
    const promise = (async () => {
      try {
        const { data, error: failure } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();
        if (failure) throw failure;
        let result = data;
        if (!result) {
          // Only a successful, empty read proves absence. ON CONFLICT avoids
          // racing the auth trigger; re-read the canonical row afterwards.
          const { error: insertError } = await supabase
            .from('profiles')
            .upsert(
              { id: user.id, display_name: user.user_metadata?.display_name || 'User' },
              { onConflict: 'id', ignoreDuplicates: true }
            );
          if (insertError) throw insertError;
          const response = await supabase.from('profiles').select('*').eq('id', user.id).single();
          if (response.error) throw response.error;
          result = response.data;
        }
        if (!result) throw new Error('Your profile could not be loaded. Please retry.');
        if (valid()) {
          setProfile(result);
          loadedProfile.current = user.id;
          setError(null);
        }
      } catch (e) {
        recordFailure('account');
        if (valid()) {
          setProfile(null);
          setError(errorMessage(e));
        }
      } finally {
        if (valid()) setLoading(false);
      }
    })();
    profileFlight.current = { id: user.id, promise };
    void promise.finally(() => {
      if (profileFlight.current?.promise === promise) profileFlight.current = null;
    });
    return promise;
  }, []);
  const accept = useCallback(
    (next: Session | null, event?: string) => {
      const id = next?.user.id ?? null;
      if (id !== current.current) {
        clearEntryLists();
        clearDiagnostics();
        generation.current++;
        current.current = id;
        setProfile(null);
        loadedProfile.current = null;
        profileFlight.current = null;
        setError(null);
        setRecovery(event === 'PASSWORD_RECOVERY');
      }
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(next);
      if (next && loadedProfile.current !== id) {
        setLoading(true);
        void fetchProfile(next.user);
      } else if (!next) setLoading(false);
    },
    [fetchProfile]
  );
  useEffect(() => {
    alive.current = true;
    let eventSeen = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      eventSeen = true;
      // Avoid async Supabase work inside the auth callback's session lock.
      queueMicrotask(() => {
        if (alive.current) accept(next, event);
      });
    });
    supabase.auth
      .getSession()
      .then(({ data, error: failure }) => {
        if (!alive.current || eventSeen) return;
        if (failure) {
          setError(errorMessage(failure));
          setLoading(false);
        } else accept(data.session);
      })
      .catch((e) => {
        if (alive.current) {
          setError(errorMessage(e));
          setLoading(false);
        }
      });
    const update = (state: string) => {
      if (state === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    };
    update(AppState.currentState);
    const listener = AppState.addEventListener('change', update);
    return () => {
      alive.current = false;
      subscription.unsubscribe();
      listener.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, [accept]);
  const refreshProfile = useCallback(async () => {
    if (session?.user) {
      if (loadedProfile.current !== session.user.id) setLoading(true);
      await fetchProfile(session.user);
    } else {
      const r = await supabase.auth.getSession();
      if (r.error) setError(errorMessage(r.error));
      else accept(r.data.session);
    }
  }, [session, fetchProfile, accept]);
  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile: profile?.id === session?.user.id ? profile : null,
        loading,
        error,
        recovery,
        refreshProfile,
        finishRecovery: () => setRecovery(false),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
