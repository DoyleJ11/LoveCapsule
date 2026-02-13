import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { entryEvents } from '../lib/entryEvents';
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

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text: string): number {
  const stripped = text.trim();
  if (!stripped) return 0;
  return stripped.split(/\s+/).length;
}

export function extractPlainTextAndWordCount(html: string) {
  const plain = stripHtml(html);
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

    const { content_plain, word_count } = extractPlainTextAndWordCount(data.content_html);

    const { data: entry, error: createError } = await supabase
      .from('entries')
      .insert({
        ...data,
        author_id: user.id,
        content_plain,
        word_count,
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
    const updateData: any = { ...data, updated_at: new Date().toISOString() };

    if (data.content_html) {
      const { content_plain, word_count } = extractPlainTextAndWordCount(data.content_html);
      updateData.content_plain = content_plain;
      updateData.word_count = word_count;
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
