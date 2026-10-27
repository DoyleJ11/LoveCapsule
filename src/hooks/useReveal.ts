import { recordFailure } from '../lib/diagnostics';
import { useState, useRef, useEffect, useCallback } from 'react';
import { errorMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import type { AnnualEvent, Entry, EntrySummary } from '../types/database';

/** Scope by account/couple at the screen boundary. Ignore unmounted responses. */
export function useReveal(coupleId: string) {
  const alive = useRef(true);
  const inFlight = useRef(false);
  const sequence = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async <T>(operation: () => Promise<T>): Promise<T | null> => {
    if (inFlight.current) return null;
    const ticket = ++sequence.current;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await operation();
      return alive.current && sequence.current === ticket ? result : null;
    } catch (e: unknown) {
      recordFailure('reveal');
      if (alive.current && sequence.current === ticket) setError(errorMessage(e));
      return null;
    } finally {
      if (sequence.current === ticket) {
        inFlight.current = false;
        if (alive.current) setLoading(false);
      }
    }
  }, []);
  const cancel = useCallback(() => {
    sequence.current++;
    inFlight.current = false;
    setLoading(false);
    setError(null);
  }, []);
  const annual = (year: number, open = false) =>
    run<AnnualEvent>(async () => {
      const { data, error } = await supabase.rpc(open ? 'open_annual_event' : 'read_annual_event', {
        p_couple_id: coupleId,
        p_year: year,
      });
      if (error) throw error;
      if (!data?.id || !Array.isArray(data.entries))
        throw new Error('Capsule confirmation was not received. Please retry.');
      return data;
    });
  const checkpoint = (occurrenceId: string) =>
    run<{ entry: Entry | null }>(async () => {
      const { data, error } = await supabase.rpc('claim_reveal_occurrence', {
        p_couple_id: coupleId,
        p_occurrence_id: occurrenceId,
      });
      if (error) throw error;
      if (!data?.occurrence_id)
        throw new Error('Reveal confirmation was not received. Please retry.');
      return data;
    });
  const moreAnnual = (year: number, date?: string, id?: string) =>
    run<EntrySummary[]>(async () => {
      const { data, error } = await supabase.rpc('list_annual_entries', {
        p_couple_id: coupleId,
        p_year: year,
        p_before_date: date ?? null,
        p_before_id: id ?? null,
        p_limit: 50,
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Notes could not be loaded. Please retry.');
      return data;
    });
  const legacyEntry = (entryId: string) =>
    run<Entry>(async () => {
      const { data, error } = await supabase
        .from('entries')
        .select('*')
        .eq('id', entryId)
        .eq('couple_id', coupleId)
        .single();
      if (error) throw error;
      if (!data) throw new Error('This note is no longer available.');
      return data;
    });
  return { loading, error, annual, checkpoint, legacyEntry, cancel, moreAnnual };
}
