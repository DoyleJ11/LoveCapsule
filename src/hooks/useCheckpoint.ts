import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type {
  CheckpointConfig,
  CheckpointFrequency,
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
  createConfig: (config: Omit<CheckpointConfig, 'id' | 'created_at'>) => Promise<void>;
  updateConfig: (id: string, updates: Partial<CheckpointConfig>) => Promise<void>;
  deleteConfig: (id: string) => Promise<void>;
  reset: () => void;
}

export function useCheckpoint(): UseCheckpointReturn {
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
    try {
      const { data, error: fetchError } = await supabase
        .from('checkpoint_configs')
        .select('*')
        .eq('couple_id', coupleId)
        .order('created_at', { ascending: true });

      if (fetchError) throw fetchError;
      setConfigs(data ?? []);
    } catch (e: any) {
      setError(e.message);
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
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const revealEntry = useCallback(async (coupleId: string, configId?: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: revealError } = await supabase.rpc('get_checkpoint_entry', {
        p_couple_id: coupleId,
        p_config_id: configId ?? null,
      });

      if (revealError) throw revealError;

      const response = data as CheckpointEntryResponse;

      if (response.error) {
        throw new Error(response.error);
      }

      setCheckpointEntry(response.entry);
      setAlreadyRevealed(response.already_revealed);
      setNoEntriesRemaining(response.no_entries);

      return !response.no_entries;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
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
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const loadUnrevealedCount = useCallback(async (coupleId: string) => {
    try {
      const { data, error: countError } = await supabase.rpc('get_unrevealed_entry_count', {
        p_couple_id: coupleId,
      });

      if (countError) throw countError;
      setUnrevealedCount(data ?? 0);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const createConfig = useCallback(
    async (config: Omit<CheckpointConfig, 'id' | 'created_at'>) => {
      setLoading(true);
      setError(null);

      try {
        const { error: insertError } = await supabase.from('checkpoint_configs').insert(config);

        if (insertError) throw insertError;

        // Reload configs
        await loadConfigs(config.couple_id);
      } catch (e: any) {
        setError(e.message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [loadConfigs]
  );

  const updateConfig = useCallback(async (id: string, updates: Partial<CheckpointConfig>) => {
    setLoading(true);
    setError(null);

    try {
      const { error: updateError } = await supabase
        .from('checkpoint_configs')
        .update(updates)
        .eq('id', id);

      if (updateError) throw updateError;

      // update local state
      setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteConfig = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('checkpoint_configs')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      // update local state
      setConfigs((prev) => prev.filter((c) => c.id !== id));
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setCheckpointEntry(null);
    setAlreadyRevealed(false);
    setNoEntriesRemaining(false);
    setError(null);
  }, []);

  return {
    configs,
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
