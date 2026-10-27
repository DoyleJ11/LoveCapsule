import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { errorMessage } from '../lib/errors';
import { requestDeletion } from '../features/account/deletion';
import { supabase } from '../lib/supabase';
import { getSignedUrl } from '../lib/storage';
import { useAuth } from './AuthProvider';
import type { Couple, Profile, RevealOverview } from '../types/database';
import { calendarDaysUntil } from '../features/reveals/time';

interface CoupleContextType {
  couple: Couple | null;
  overview: RevealOverview | null;
  serverNow: () => number;
  saveAnnualSchedule: (
    date: string,
    time: string,
    timezone: string,
    expectedVersion?: number
  ) => Promise<void>;
  partner: Profile | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  daysUntilAnniversary: number | null;
  isRevealReady: boolean;
  isRevealed: boolean;
  profileAvatarUrl: string | null;
  partnerAvatarUrl: string | null;
  refreshProfileAvatar: (storagePath: string) => Promise<void>;
  createCouple: () => Promise<string>;
  joinCouple: (inviteCode: string) => Promise<void>;
  setAnniversaryDate: (date: string) => Promise<void>;
  unpairCouple: () => Promise<void>;
  refresh: () => Promise<void>;
}

const CoupleContext = createContext<CoupleContextType>({
  couple: null,
  overview: null,
  serverNow: Date.now,
  saveAnnualSchedule: async () => {},
  partner: null,
  loading: true,
  refreshing: false,
  error: null,
  daysUntilAnniversary: null,
  isRevealReady: false,
  isRevealed: false,
  profileAvatarUrl: null,
  partnerAvatarUrl: null,
  refreshProfileAvatar: async () => {},
  createCouple: async () => '',
  joinCouple: async () => {},
  setAnniversaryDate: async () => {},
  unpairCouple: async () => {},
  refresh: async () => {},
});

export function CoupleProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const currentUser = useRef(user?.id);
  currentUser.current = user?.id;
  const request = useRef(0);
  const mounted = useRef(true);
  const loadedScope = useRef<string | null>(null);
  const [owner, setOwner] = useState<string>();
  const [overview, setOverview] = useState<RevealOverview | null>(null);
  const serverClock = useRef({ at: Date.now(), tick: performance.now() });
  const serverNow = useCallback(
    () => serverClock.current.at + performance.now() - serverClock.current.tick,
    []
  );
  const [couple, setCouple] = useState<Couple | null>(null);
  const [partner, setPartner] = useState<Profile | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [partnerAvatarUrl, setPartnerAvatarUrl] = useState<string | null>(null);

  const fetchCouple = useCallback(async () => {
    const account = user?.id;
    const ticket = ++request.current;
    const current = () =>
      mounted.current && ticket === request.current && currentUser.current === account;
    if (!account) {
      setCouple(null);
      setPartner(null);
      setOverview(null);
      setOwner(undefined);
      setProfileAvatarUrl(null);
      setPartnerAvatarUrl(null);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('couples')
        .select('*')
        .or(`partner_1_id.eq.${account},partner_2_id.eq.${account}`)
        .maybeSingle();
      if (fetchError) throw fetchError;
      if (!current()) return;
      // Membership changes clear all account/couple-scoped data before loading.
      const scope = data ? `${account}:${data.id}:${data.partner_1_id}:${data.partner_2_id}` : null;
      if (loadedScope.current !== scope) {
        setPartner(null);
        setOverview(null);
      }
      loadedScope.current = scope;
      setCouple(data);
      setOwner(account);
      if (!data) {
        setPartner(null);
        setOverview(null);
      }
      if (data) {
        const partnerId = data.partner_1_id === account ? data.partner_2_id : data.partner_1_id;
        if (partnerId) {
          const { data: partnerData, error: partnerError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', partnerId)
            .single();
          if (partnerError) throw partnerError;
          if (!current()) return;
          setPartner(partnerData);
        } else {
          setPartner(null);
        }
        const { data: result, error: overviewError } = await supabase.rpc('get_reveal_overview', {
          p_couple_id: data.id,
        });
        if (overviewError) throw overviewError;
        if (!result) throw new Error('Reveal status could not be confirmed. Please retry.');
        if (!current()) return;
        setOverview(result);
        // Anchor a conservative server instant to a monotonic clock. Device
        // clock corrections cannot move countdowns or buttons past a deadline.
        serverClock.current = { at: Date.parse(result.server_now), tick: performance.now() };
      }
      if (current()) setError(null);
    } catch (e: unknown) {
      if (current()) {
        setError(errorMessage(e));
        setOverview(null);
      }
    } finally {
      if (current()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [user?.id]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setLoading(true);
    void fetchCouple();
  }, [fetchCouple]);
  // Polling is a deliberate fallback independent of Supabase Realtime setup.
  useEffect(() => {
    if (!user?.id) return;
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void fetchCouple();
    }, 30000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void fetchCouple();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [user?.id, fetchCouple]);
  useEffect(() => {
    if (!overview) return;
    const now = serverNow();
    const deadlines = [overview.annual?.ready_at, ...overview.checkpoints.map((o) => o.due_at)]
      .filter((value): value is string => !!value)
      .map(Date.parse)
      .filter((value) => value > now);
    if (!deadlines.length) return;
    const timer = setTimeout(
      () => void fetchCouple(),
      Math.min(2147483647, Math.max(50, Math.min(...deadlines) - now + 50))
    );
    return () => clearTimeout(timer);
  }, [overview, serverNow, fetchCouple]);

  const [avatarRevision, renewAvatars] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => renewAvatars((v) => v + 1), 50 * 60 * 1000);
    const listener = AppState.addEventListener('change', (s) => {
      if (s === 'active') renewAvatars((v) => v + 1);
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, []);
  // Preload avatar signed URLs so they're ready before navigating to Settings
  useEffect(() => {
    let active = true;
    setProfileAvatarUrl(null);
    if (profile?.id === user?.id && profile?.avatar_url) {
      getSignedUrl(profile.avatar_url)
        .then((url) => {
          if (active) setProfileAvatarUrl(url);
        })
        .catch(() => {});
    } else {
      setProfileAvatarUrl(null);
    }
    return () => {
      active = false;
    };
  }, [profile?.avatar_url, profile?.id, user?.id, avatarRevision]);

  useEffect(() => {
    let active = true;
    setPartnerAvatarUrl(null);
    if (partner?.avatar_url) {
      getSignedUrl(partner.avatar_url)
        .then((url) => {
          if (active) setPartnerAvatarUrl(url);
        })
        .catch(() => {});
    } else {
      setPartnerAvatarUrl(null);
    }
    return () => {
      active = false;
    };
  }, [partner?.avatar_url, user?.id, avatarRevision]);

  // Allow Settings to update the profile avatar URL after uploading a new photo
  const refreshProfileAvatar = useCallback(async (storagePath: string) => {
    const account = currentUser.current;
    const url = await getSignedUrl(storagePath);
    if (currentUser.current === account) setProfileAvatarUrl(url);
  }, []);

  const createCouple = async (): Promise<string> => {
    if (!user) throw new Error('Not authenticated');
    if (couple) throw new Error('You already have a couple');

    const { data, error: createError } = await supabase
      .from('couples')
      .insert({ partner_1_id: user.id })
      .select()
      .single();

    if (createError) throw createError;
    setCouple(data);
    return data.invite_code;
  };

  const joinCouple = async (inviteCode: string) => {
    if (!user) throw new Error('Not authenticated');

    // Joining runs server-side: invite codes are no longer readable by
    // clients, so the RPC finds the couple by code, abandons any empty
    // couple the user created, and sets partner_2_id to the caller.
    const { data, error: joinError } = await supabase.rpc('join_couple_by_code', {
      p_invite_code: inviteCode.trim(),
    });

    if (joinError || !data) {
      throw new Error(joinError?.message || 'Invalid invite code or couple already full');
    }

    await fetchCouple();
  };

  const saveAnnualSchedule = async (
    date: string,
    time: string,
    timezone: string,
    expectedVersion?: number
  ) => {
    if (!couple) throw new Error('No couple found');
    const { error: updateError } = await supabase.rpc('save_annual_schedule', {
      p_couple_id: couple.id,
      p_expected_version: expectedVersion ?? couple.schedule_version,
      p_date: date,
      p_time: time,
      p_timezone: timezone,
    });
    // A conflict also refreshes the displayed version before the next attempt.
    await fetchCouple();
    if (updateError) throw updateError;
  };
  const setAnniversaryDate = async (date: string) =>
    saveAnnualSchedule(date, couple?.reveal_time ?? '00:00', couple?.reveal_timezone ?? 'UTC');

  const unpairCouple = async () => {
    if (!couple) throw new Error('No couple to unpair');
    if (!user) throw new Error('Not authenticated');

    await requestDeletion('unpair', couple.id);

    // Step 4: Clear local state
    request.current++;
    setOverview(null);
    setCouple(null);
    setPartner(null);
  };

  const visible = owner === user?.id;
  const visibleOverview = visible && overview?.couple_id === couple?.id ? overview : null;
  const daysUntilAnniversary = visibleOverview?.annual
    ? calendarDaysUntil(
        visibleOverview.annual.ready_at,
        visibleOverview.annual.timezone,
        serverNow()
      )
    : null;
  const isRevealReady = visibleOverview?.annual?.is_ready ?? false;
  const isRevealed = !!visibleOverview?.annual_history.length;

  return (
    <CoupleContext.Provider
      value={{
        couple: visible ? couple : null,
        partner: visible ? partner : null,
        overview: visibleOverview,
        serverNow,
        saveAnnualSchedule,
        loading,
        refreshing,
        error,
        daysUntilAnniversary,
        isRevealReady,
        isRevealed,
        profileAvatarUrl: visible ? profileAvatarUrl : null,
        partnerAvatarUrl: visible ? partnerAvatarUrl : null,
        refreshProfileAvatar,
        createCouple,
        joinCouple,
        setAnniversaryDate,
        unpairCouple,
        refresh: fetchCouple,
      }}
    >
      {children}
    </CoupleContext.Provider>
  );
}

export function useCouple() {
  const context = useContext(CoupleContext);
  if (!context) {
    throw new Error('useCouple must be used within a CoupleProvider');
  }
  return context;
}
