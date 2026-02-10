import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { RevealStats, Entry } from '../types/database';

interface RevealYear {
  year: number;
  revealed_at: string;
}

interface UseRevealReturn {
  stats: RevealStats | null;
  partnerEntries: Entry[];
  revealYears: RevealYear[];
  selectedYear: number | null;
  loading: boolean;
  error: string | null;
  triggerReveal: (coupleId: string) => Promise<boolean>;
  loadStats: (coupleId: string, year?: number) => Promise<boolean>;
  loadRevealYears: (coupleId: string) => Promise<void>;
  fetchPartnerEntries: (coupleId: string, year?: number) => Promise<void>;
  setSelectedYear: (year: number | null) => void;
  reset: () => void;
}

export function useReveal(): UseRevealReturn {
  const [stats, setStats] = useState<RevealStats | null>(null);
  const [partnerEntries, setPartnerEntries] = useState<Entry[]>([]);
  const [revealYears, setRevealYears] = useState<RevealYear[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const triggerReveal = useCallback(async (coupleId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      // Refresh the session to ensure a valid access token.
      // functions.invoke may send a stale token if the app was backgrounded.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw new Error('Session expired. Please sign in again.');

      // Call the check-anniversary edge function to verify and flip is_revealed
      const { data: revealData, error: revealError } = await supabase.functions.invoke(
        'check-anniversary',
        { body: { couple_id: coupleId } }
      );

      if (revealError) throw revealError;

      // The edge function returns JSON with error field on business-logic failures
      if (revealData?.error) throw new Error(revealData.error);

      const currentYear = new Date().getFullYear();

      // Fetch reveal stats for this year
      const { data: statsData, error: statsError } = await supabase.rpc('get_reveal_stats', {
        p_couple_id: coupleId,
        p_year: currentYear,
      });

      if (statsError) throw statsError;
      if (!statsData) throw new Error('No stats data returned');

      // Save the reveal snapshot for this year
      await supabase.rpc('save_reveal_snapshot', {
        p_couple_id: coupleId,
        p_year: currentYear,
        p_stats: statsData,
      });

      setStats(statsData);
      setSelectedYear(currentYear);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // Load stats only (for already-revealed capsules — no edge function call needed)
  // If year is provided, load stats for that specific year
  const loadStats = useCallback(async (coupleId: string, year?: number): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const targetYear = year ?? new Date().getFullYear();

      const { data: statsData, error: statsError } = await supabase.rpc('get_reveal_stats', {
        p_couple_id: coupleId,
        p_year: targetYear,
      });
      if (statsError) throw statsError;
      if (!statsData) throw new Error('No stats data returned');
      setStats(statsData);
      setSelectedYear(targetYear);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // Load the list of years that have reveal history
  const loadRevealYears = useCallback(async (coupleId: string) => {
    try {
      const { data, error: fetchError } = await supabase.rpc('get_reveal_years', {
        p_couple_id: coupleId,
      });
      if (fetchError) throw fetchError;
      setRevealYears(data ?? []);
    } catch (e: any) {
      console.error('Failed to load reveal years:', e.message);
    }
  }, []);

  const fetchPartnerEntries = useCallback(async (coupleId: string, year?: number) => {
    try {
      // After reveal, RLS allows reading partner entries
      let query = supabase
        .from('entries')
        .select('*')
        .eq('couple_id', coupleId)
        .eq('is_draft', false);

      // Filter by year if provided
      if (year) {
        const yearStart = `${year}-01-01`;
        const yearEnd = `${year}-12-31`;
        query = query.gte('entry_date', yearStart).lte('entry_date', yearEnd);
      }

      const { data, error: fetchError } = await query
        .order('entry_date', { ascending: true })
        .order('created_at', { ascending: true });

      if (fetchError) throw fetchError;
      setPartnerEntries(data ?? []);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  // Reset all state (for replay)
  const reset = useCallback(() => {
    setStats(null);
    setPartnerEntries([]);
    setError(null);
    // Keep revealYears and selectedYear for context
  }, []);

  return {
    stats,
    partnerEntries,
    revealYears,
    selectedYear,
    loading,
    error,
    triggerReveal,
    loadStats,
    loadRevealYears,
    fetchPartnerEntries,
    setSelectedYear,
    reset,
  };
}
