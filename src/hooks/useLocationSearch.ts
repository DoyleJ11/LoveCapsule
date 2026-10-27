import { useState, useEffect, useRef, useCallback } from 'react';
import { searchLocations, resolveLocation, type LocationResult } from '../lib/location-search';
import { uuid } from 'expo-modules-core';
import { errorMessage } from '../lib/errors';
export function useLocationSearch(visible: boolean) {
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<LocationResult[]>([]),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(false);
  const session = useRef(''),
    sequence = useRef(0),
    controller = useRef<AbortController | null>(null);
  const search = useCallback(async (text: string) => {
    const ticket = ++sequence.current;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setLoading(true);
    setError(null);
    try {
      const rows = await searchLocations(text, {
        signal: pending.signal,
        sessionToken: session.current,
      });
      if (sequence.current === ticket) setResults(rows);
    } catch (e) {
      if (sequence.current === ticket && !pending.signal.aborted) setError(errorMessage(e));
    } finally {
      if (sequence.current === ticket) setLoading(false);
    }
  }, []);
  const cancel = useCallback(() => {
    sequence.current++;
    controller.current?.abort();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      if (query.trim()) void search(query.trim());
      else {
        setResults([]);
        setError(null);
        setLoading(false);
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      cancel();
    };
  }, [visible, query, search, cancel]);
  useEffect(() => {
    if (visible) {
      session.current = uuid.v4();
      setQuery('');
      setResults([]);
      setError(null);
      setLoading(false);
    }
    return () => {
      cancel();
    };
  }, [visible, cancel]);
  const select = async (row: LocationResult) => {
    const ticket = ++sequence.current;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setLoading(true);
    setError(null);
    try {
      const full = await resolveLocation(row, session.current, pending.signal);
      return ticket === sequence.current ? full : null;
    } catch (e) {
      if (ticket === sequence.current && !pending.signal.aborted) setError(errorMessage(e));
      return null;
    } finally {
      if (ticket === sequence.current) setLoading(false);
    }
  };
  return { query, setQuery, results, error, loading, select, retry: () => search(query.trim()) };
}
