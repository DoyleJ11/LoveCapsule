import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { entryEvents } from '../lib/entryEvents';
import type { Entry } from '../types/database';
import { entryContent } from '../features/entries/content';
import { fromContentHtml } from '../lib/entry-content';

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

/** Compatibility for callers with only HTML; never discard supplied plain text. */
export function extractPlainTextAndWordCount(html: string) {
  const { content_plain, word_count } = entryContent(fromContentHtml(html));
  return { content_plain, word_count };
}

export function useEntries(coupleId: string | undefined): UseEntriesReturn {
  const { user } = useAuth();
  const authorId = user?.id;
  const scope = `${authorId ?? ''}:${coupleId ?? ''}`;
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const request = useRef(0);
  const [entriesScope, setEntriesScope] = useState<string>();
  const [errorScope, setErrorScope] = useState<string>();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    const ticket = ++request.current;
    const current = () => activeScope.current === scope && request.current === ticket;
    if (!authorId || !coupleId) {
      setEntries([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setErrorScope(scope);
    try {
      const { data, error: fetchError } = await supabase
        .from('entries')
        .select('*')
        .eq('couple_id', coupleId)
        .eq('author_id', authorId)
        .order('entry_date', { ascending: false });

      if (fetchError) throw fetchError;
      if (!current()) return;
      setEntriesScope(scope);
      setEntries(data ?? []);
    } catch (e: any) {
      if (current()) setError(e.message);
    } finally {
      if (current()) setLoading(false);
    }
  }, [authorId, coupleId, scope]);

  useEffect(() => {
    fetchEntries();
    const pending = request;
    return () => {
      pending.current++;
    };
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

    const { content_plain, content_html, word_count } = entryContent(
      data.content_plain ?? fromContentHtml(data.content_html)
    );

    const { data: entry, error: createError } = await supabase
      .from('entries')
      .insert({
        ...data,
        author_id: user.id,
        content_plain,
        content_html,
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
    const updateData: Partial<CreateEntryInput> & { updated_at: string } = {
      ...data,
      updated_at: new Date().toISOString(),
    };

    if (data.content_plain !== undefined)
      Object.assign(updateData, entryContent(data.content_plain));
    else if (data.content_html !== undefined)
      Object.assign(updateData, entryContent(fromContentHtml(data.content_html)));

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
    entries: entriesScope === scope ? entries : [],
    loading,
    error: errorScope === scope ? error : null,
    createEntry,
    updateEntry,
    deleteEntry,
    refresh: fetchEntries,
  };
}
