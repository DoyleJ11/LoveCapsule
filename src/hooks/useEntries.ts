import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { entryEvents } from '../lib/entryEvents';
import { fromContentHtml, countWords } from '../lib/entry-content';
import type { Entry } from '../types/database';

interface UseEntriesReturn {
  entries: Entry[];
  loading: boolean;
  error: string | null;
  createEntry: (data: CreateEntryInput) => Promise<Entry>;
  updateEntry: (id: string, data: Partial<CreateEntryInput>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export interface CreateEntryInput {
  couple_id: string;
  title: string;
  content_html: string;
  content_plain: string;
  word_count: number;
  mood: string | null;
  is_draft: boolean;
  entry_date: string;
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
}

/**
 * Fallback for callers that supply only content_html. The composer sends
 * content_plain directly, and that value wins — deriving it from the HTML
 * is what destroyed paragraph breaks and angle brackets (see migration 011).
 */
export function extractPlainTextAndWordCount(html: string) {
  const plain = fromContentHtml(html);
  return { content_plain: plain, word_count: countWords(plain) };
}

export function useEntries(coupleId: string | undefined): UseEntriesReturn {
  const { user } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    if (!user || !coupleId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error: fetchError } = await supabase
        .from('entries')
        .select('*')
        .eq('couple_id', coupleId)
        .eq('author_id', user.id)
        .order('entry_date', { ascending: false });

      if (fetchError) throw fetchError;
      setEntries(data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user, coupleId]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Listen for entry-change events fired by OTHER useEntries instances
  // so that all screens stay in sync after mutations.
  const isLocalMutation = useRef(false);

  useEffect(() => {
    const unsubscribe = entryEvents.subscribe(() => {
      // Skip if this instance triggered the event (it already refreshed)
      if (isLocalMutation.current) {
        isLocalMutation.current = false;
        return;
      }
      fetchEntries();
    });
    return unsubscribe;
  }, [fetchEntries]);

  const createEntry = async (data: CreateEntryInput): Promise<Entry> => {
    if (!user) throw new Error('Not authenticated');

    // The caller's plain text is authoritative; only derive it if absent.
    const derived = extractPlainTextAndWordCount(data.content_html);

    const { data: entry, error: createError } = await supabase
      .from('entries')
      .insert({
        ...data,
        author_id: user.id,
        content_plain: data.content_plain ?? derived.content_plain,
        word_count: data.word_count ?? derived.word_count,
      })
      .select()
      .single();

    if (createError) throw createError;
    await fetchEntries();
    isLocalMutation.current = true;
    entryEvents.emit();
    return entry;
  };

  const updateEntry = async (id: string, data: Partial<CreateEntryInput>) => {
    const updateData: Partial<CreateEntryInput> & { updated_at: string } = {
      ...data,
      updated_at: new Date().toISOString(),
    };

    // Derive plain text only when the caller changed the HTML but did not
    // supply the matching plain text itself.
    if (data.content_html !== undefined && data.content_plain === undefined) {
      const derived = extractPlainTextAndWordCount(data.content_html);
      updateData.content_plain = derived.content_plain;
      updateData.word_count = derived.word_count;
    }

    const { error: updateError } = await supabase.from('entries').update(updateData).eq('id', id);

    if (updateError) throw updateError;
    await fetchEntries();
    isLocalMutation.current = true;
    entryEvents.emit();
  };

  const deleteEntry = async (id: string) => {
    const { error: deleteError } = await supabase.from('entries').delete().eq('id', id);

    if (deleteError) throw deleteError;
    await fetchEntries();
    isLocalMutation.current = true;
    entryEvents.emit();
  };

  return {
    entries,
    loading,
    error,
    createEntry,
    updateEntry,
    deleteEntry,
    refresh: fetchEntries,
  };
}
