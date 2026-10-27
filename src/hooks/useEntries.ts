import { useEffect, useMemo, useCallback, useSyncExternalStore } from 'react';
import { entryList, loadEntryList, invalidateEntryLists } from '../features/entries/list';
import { useAuth } from '../providers/AuthProvider';
import { entryEvents } from '../lib/entryEvents';
import { entryContent } from '../features/entries/content';
import { fromContentHtml } from '../lib/entry-content';

interface UseEntriesReturn {
  entries: import('../types/database').EntrySummary[];
  summary: { entries: number; words: number } | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

entryEvents.subscribe(invalidateEntryLists);

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
  const cache = useMemo(() => entryList(scope), [scope]);
  const subscribe = useCallback(
    (listener: () => void) => {
      cache.listeners.add(listener);
      return () => {
        cache.listeners.delete(listener);
      };
    },
    [cache]
  );
  const state = useSyncExternalStore(subscribe, () => cache.state);
  const fetchEntries = useCallback(async () => {
    if (authorId && coupleId) await loadEntryList(scope, coupleId);
  }, [authorId, coupleId, scope]);
  const loadMore = useCallback(async () => {
    if (authorId && coupleId && cache.state.hasMore) await loadEntryList(scope, coupleId, true);
  }, [authorId, coupleId, scope, cache]);
  useEffect(() => {
    if (authorId && coupleId && !cache.loaded) void fetchEntries();
  }, [authorId, coupleId, cache, fetchEntries]);

  return {
    entries: authorId && coupleId ? state.entries : [],
    summary: state.summary,
    hasMore: state.hasMore,
    loadMore,
    loading: state.loading || (!!authorId && !!coupleId && !cache.loaded && !state.error),
    error: state.error,
    refresh: fetchEntries,
  };
}
