import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { RevealStats, Entry } from '../types/database';

interface UseRevealReturn {
  stats: RevealStats | null;
  partnerEntries: Entry[];
  loading: boolean;
  error: string | null;
  triggerReveal: (coupleId: string) => Promise<void>;
  fetchPartnerEntries: (coupleId: string) => Promise<void>;
}

export function useReveal(): UseRevealReturn {
  const [stats, setStats] = useState<RevealStats | null>(null);
  const [partnerEntries, setPartnerEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const triggerReveal = useCallback(async (coupleId: string) => {
    setLoading(true);
    setError(null);

    try {
      // Call the check-anniversary edge function to verify and flip is_revealed
      const { data: revealData, error: revealError } = await supabase.functions.invoke(
        'check-anniversary',
        { body: { couple_id: coupleId } }
      );

      if (revealError) throw revealError;

      // Fetch reveal stats
      const { data: statsData, error: statsError } = await supabase.rpc(
        'get_reveal_stats',
        { p_couple_id: coupleId }
      );

      if (statsError) throw statsError;
      setStats(statsData);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPartnerEntries = useCallback(async (coupleId: string) => {
    try {
      // After reveal, RLS allows reading partner entries
      const { data, error: fetchError } = await supabase
        .from('entries')
        .select('*')
        .eq('couple_id', coupleId)
        .eq('is_draft', false)
        .order('entry_date', { ascending: true });

      if (fetchError) throw fetchError;
      setPartnerEntries(data ?? []);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  return {
    stats,
    partnerEntries,
    loading,
    error,
    triggerReveal,
    fetchPartnerEntries,
  };
}
