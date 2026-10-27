import { errorMessage } from '../lib/errors';
import { useState, useCallback, useRef } from 'react';
import { useCouple } from '../providers/CoupleProvider';
import { supabase } from '../lib/supabase';
import type {
  CheckpointConfig,
  CheckpointEntryResponse,
  CheckpointHistoryItem,
  CheckpointTodayResponse,
  Entry,
} from '../types/database';

interface UseCheckpointReturn {
  configs: CheckpointConfig[];
  isCheckpointDay: boolean;
  todaysCheckpoints: CheckpointTodayResponse['checkpoints'];
  checkpointEntry: Entry | null;
  alreadyRevealed: boolean;
  noEntriesRemaining: boolean;
  checkpointHistory: CheckpointHistoryItem[];
  unrevealedCount: number | null;
  loading: boolean;
  error: string | null;
  loadConfigs: (coupleId: string) => Promise<void>;
  checkToday: (coupleId: string) => Promise<void>;
  revealEntry: (coupleId: string, configId?: string) => Promise<boolean>;
  loadHistory: (coupleId: string) => Promise<void>;
  loadUnrevealedCount: (coupleId: string) => Promise<void>;
  createConfig: (
    config: Omit<CheckpointConfig, 'id' | 'created_at'> & { id?: string }
  ) => Promise<void>;
  updateConfig: (id: string, updates: Partial<CheckpointConfig>) => Promise<void>;
  deleteConfig: (id: string) => Promise<void>;
  reset: () => void;
}

export function useCheckpoint(): UseCheckpointReturn {
  const { refresh, couple } = useCouple();
  const activeCouple = useRef(couple?.id);
  activeCouple.current = couple?.id;
  const [configsScope, setConfigsScope] = useState<string>();
  const inFlight = useRef(false);
  const [configs, setConfigs] = useState<CheckpointConfig[]>([]);
  const [isCheckpointDay, setIsCheckpointDay] = useState(false);
  const [todaysCheckpoints, setTodaysCheckpoints] = useState<
    CheckpointTodayResponse['checkpoints']
  >([]);
  const [checkpointEntry, setCheckpointEntry] = useState<Entry | null>(null);
  const [alreadyRevealed, setAlreadyRevealed] = useState(false);
  const [noEntriesRemaining, setNoEntriesRemaining] = useState(false);
  const [checkpointHistory, setCheckpointHistory] = useState<CheckpointHistoryItem[]>([]);
  const [unrevealedCount, setUnrevealedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConfigs = useCallback(async (coupleId: string) => {
    if (activeCouple.current !== coupleId) return;
    try {
      const { data, error: fetchError } = await supabase
        .from('checkpoint_configs')
        .select('*')
        .eq('couple_id', coupleId)
        .order('created_at', { ascending: true });

      if (fetchError) throw fetchError;
      if (activeCouple.current !== coupleId) return;
      setConfigsScope(coupleId);
      setConfigs(data ?? []);
    } catch (e: unknown) {
      setError(errorMessage(e));
    }
  }, []);

  const checkToday = useCallback(async (coupleId: string) => {
    try {
      const { data, error: checkError } = await supabase.rpc('check_checkpoint_today', {
        p_couple_id: coupleId,
      });

      if (checkError) throw checkError;

      const response = data as CheckpointTodayResponse;
      setIsCheckpointDay(response.is_checkpoint_day);
      setTodaysCheckpoints(response.checkpoints);
    } catch (e: unknown) {
      setError(errorMessage(e));
    }
  }, []);

  const revealEntry = useCallback(async (coupleId: string, configId?: string): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setCheckpointEntry(null);
    setAlreadyRevealed(false);
    setNoEntriesRemaining(false);
    setLoading(true);
    setError(null);

    try {
      const { data, error: revealError } = await supabase.rpc('get_checkpoint_entry', {
        p_couple_id: coupleId,
        p_config_id: configId ?? null,
      });

      if (revealError) throw revealError;

      if (!data) throw new Error('Reveal confirmation was not received. Please retry.');
      const response = data as CheckpointEntryResponse;

      if (response.error) {
        throw new Error(response.error);
      }

      setCheckpointEntry(response.entry);
      setAlreadyRevealed(response.already_revealed);
      setNoEntriesRemaining(response.no_entries);

      return true;
    } catch (e: unknown) {
      setError(errorMessage(e));
      return false;
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (coupleId: string) => {
    try {
      const { data, error: historyError } = await supabase.rpc('get_checkpoint_history', {
        p_couple_id: coupleId,
      });

      if (historyError) throw historyError;
      setCheckpointHistory(data ?? []);
    } catch (e: unknown) {
      setError(errorMessage(e));
    }
  }, []);

  const loadUnrevealedCount = useCallback(async (coupleId: string) => {
    try {
      const { data, error: countError } = await supabase.rpc('get_unrevealed_entry_count', {
        p_couple_id: coupleId,
      });

      if (countError) throw countError;
      setUnrevealedCount(data ?? 0);
    } catch (e: unknown) {
      setError(errorMessage(e));
    }
  }, []);

  const createConfig = useCallback(
    async (config: Omit<CheckpointConfig, 'id' | 'created_at'> & { id?: string }) => {
      setLoading(true);
      setError(null);

      try {
        const { error: insertError } = await supabase.rpc('save_checkpoint_schedule', {
          p_couple_id: config.couple_id,
          p_id: config.id ?? null,
          p_expected_version: null,
          p_config: { ...config },
        });

        if (insertError) throw insertError;

        // Reload configs
        await loadConfigs(config.couple_id);
        await refresh();
      } catch (e: unknown) {
        setError(errorMessage(e));
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [loadConfigs, refresh]
  );

  const updateConfig = useCallback(
    async (id: string, updates: Partial<CheckpointConfig>) => {
      setLoading(true);
      setError(null);

      try {
        const existing = configs.find((c) => c.id === id);
        if (!existing) throw new Error('Reload schedules and try again.');
        const { error: updateError } = await supabase.rpc('save_checkpoint_schedule', {
          p_couple_id: existing.couple_id,
          p_id: id,
          p_expected_version: updates.version ?? existing.version ?? 1,
          p_config: { ...existing, ...updates },
        });
        await loadConfigs(existing.couple_id);
        await refresh();

        if (updateError) throw updateError;

        // update local state
      } catch (e: unknown) {
        setError(errorMessage(e));
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [configs, loadConfigs, refresh]
  );

  const deleteConfig = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);

      try {
        const existing = configs.find((c) => c.id === id);
        if (!existing) throw new Error('Reload schedules and try again.');
        const { error: deleteError } = await supabase.rpc('delete_checkpoint_schedule', {
          p_couple_id: existing.couple_id,
          p_id: id,
          p_expected_version: existing.version ?? 1,
        });
        await refresh();

        if (deleteError) throw deleteError;

        // update local state
        setConfigs((prev) => prev.filter((c) => c.id !== id));
      } catch (e: unknown) {
        setError(errorMessage(e));
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [configs, refresh]
  );

  const reset = useCallback(() => {
    setCheckpointEntry(null);
    setAlreadyRevealed(false);
    setNoEntriesRemaining(false);
    setError(null);
  }, []);

  return {
    configs: configsScope === couple?.id ? configs : [],
    isCheckpointDay,
    todaysCheckpoints,
    checkpointEntry,
    alreadyRevealed,
    noEntriesRemaining,
    checkpointHistory,
    unrevealedCount,
    loading,
    error,
    loadConfigs,
    checkToday,
    revealEntry,
    loadHistory,
    loadUnrevealedCount,
    createConfig,
    updateConfig,
    deleteConfig,
    reset,
  };
}
