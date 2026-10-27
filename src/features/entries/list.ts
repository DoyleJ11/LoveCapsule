import { supabase } from '../../lib/supabase';
import type { EntrySummary } from '../../types/database';
import { errorMessage } from '../../lib/errors';
interface State {
  entries: EntrySummary[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  summary: { entries: number; words: number } | null;
}
interface Cache {
  state: State;
  listeners: Set<() => void>;
  flight: Promise<void> | null;
  generation: number;
  loaded: boolean;
  invalidated?: boolean;
}
const caches = new Map<string, Cache>();
export function entryList(key: string): Cache {
  let c = caches.get(key);
  if (!c) {
    c = {
      state: { entries: [], loading: false, error: null, hasMore: false, summary: null },
      listeners: new Set(),
      flight: null,
      generation: 0,
      loaded: false,
    };
    caches.set(key, c);
  }
  return c;
}
function emit(c: Cache, next: Partial<State>) {
  c.state = { ...c.state, ...next };
  c.listeners.forEach((fn) => fn());
}
export function clearEntryLists() {
  for (const c of caches.values()) {
    c.generation++;
    c.loaded = false;
    emit(c, { entries: [], summary: null, error: null, hasMore: false, loading: false });
  }
  caches.clear();
}
export function loadEntryList(key: string, coupleId: string, more = false): Promise<void> {
  const c = entryList(key);
  if (c.flight) return c.flight;
  const generation = c.generation;
  const previous = more ? c.state.entries.at(-1) : null;
  emit(c, { loading: true, error: null });
  const request = (async () => {
    try {
      const [page, total] = await Promise.all([
        supabase.rpc('list_diary_entries', {
          p_couple_id: coupleId,
          p_before_date: previous?.entry_date ?? null,
          p_before_id: previous?.id ?? null,
          p_limit: 50,
        }),
        more
          ? Promise.resolve({ data: c.state.summary, error: null })
          : supabase.rpc('diary_summary', { p_couple_id: coupleId }),
      ]);
      if (page.error) throw page.error;
      if (total.error) throw total.error;
      if (generation !== c.generation) return;
      const rows = page.data as EntrySummary[];
      if (!Array.isArray(rows)) throw new Error('Diary could not be loaded. Please retry.');
      const entries = more
        ? [
            ...c.state.entries,
            ...rows.filter((row) => !c.state.entries.some((old) => old.id === row.id)),
          ]
        : rows;
      c.loaded = true;
      emit(c, { entries, hasMore: rows.length === 50, summary: total.data as State['summary'] });
    } catch (e) {
      if (generation === c.generation) emit(c, { error: errorMessage(e) });
    } finally {
      if (generation === c.generation) emit(c, { loading: false });
      c.flight = null;
      if (c.invalidated && c.listeners.size && caches.get(key) === c) {
        c.invalidated = false;
        queueMicrotask(() => void loadEntryList(key, coupleId));
      }
    }
  })();
  c.flight = request;
  return request;
}
export function invalidateEntryLists() {
  for (const [key, c] of caches)
    if (c.listeners.size) {
      if (c.flight) c.invalidated = true;
      else void loadEntryList(key, key.split(':')[1]);
    }
}
