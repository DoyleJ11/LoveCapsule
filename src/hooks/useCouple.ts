import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import type { Couple, Profile } from '../types/database';
import { getDaysUntilAnniversary, isAnniversaryReady } from '../lib/date-utils';

interface UseCoupleReturn {
  couple: Couple | null;
  partner: Profile | null;
  loading: boolean;
  error: string | null;
  daysUntilAnniversary: number | null;
  isRevealReady: boolean;
  createCouple: () => Promise<string>;
  joinCouple: (inviteCode: string) => Promise<void>;
  setAnniversaryDate: (date: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useCouple(): UseCoupleReturn {
  const { user } = useAuth();
  const [couple, setCouple] = useState<Couple | null>(null);
  const [partner, setPartner] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCouple = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      const { data, error: fetchError } = await supabase
        .from('couples')
        .select('*')
        .or(`partner_1_id.eq.${user.id},partner_2_id.eq.${user.id}`)
        .maybeSingle();

      if (fetchError) throw fetchError;

      setCouple(data);

      if (data) {
        const partnerId =
          data.partner_1_id === user.id ? data.partner_2_id : data.partner_1_id;
        if (partnerId) {
          const { data: partnerData } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', partnerId)
            .single();
          setPartner(partnerData);
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchCouple();
  }, [fetchCouple]);

  const createCouple = async (): Promise<string> => {
    if (!user) throw new Error('Not authenticated');

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

    const { data, error: joinError } = await supabase
      .from('couples')
      .update({ partner_2_id: user.id })
      .eq('invite_code', inviteCode.trim().toLowerCase())
      .is('partner_2_id', null)
      .select()
      .single();

    if (joinError || !data) {
      throw new Error('Invalid invite code or couple already full');
    }

    await fetchCouple();
  };

  const setAnniversaryDate = async (date: string) => {
    if (!couple) throw new Error('No couple found');

    const { error: updateError } = await supabase
      .from('couples')
      .update({ anniversary_date: date })
      .eq('id', couple.id);

    if (updateError) throw updateError;
    await fetchCouple();
  };

  const daysUntilAnniversary =
    couple?.anniversary_date ? getDaysUntilAnniversary(couple.anniversary_date) : null;

  const isRevealReady =
    couple?.anniversary_date
      ? isAnniversaryReady(couple.anniversary_date, couple.last_reveal_year)
      : false;

  return {
    couple,
    partner,
    loading,
    error,
    daysUntilAnniversary,
    isRevealReady,
    createCouple,
    joinCouple,
    setAnniversaryDate,
    refresh: fetchCouple,
  };
}
