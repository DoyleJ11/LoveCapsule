import { supabase } from '../../../lib/supabase';
import { entryList, clearEntryLists, loadEntryList } from '../list';
beforeEach(() => {
  clearEntryLists();
  jest.clearAllMocks();
});
it('shares in-flight loads, uses stable page cursors and keeps full totals', async () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: String(i), entry_date: '2026-10-26' }));
  (supabase.rpc as jest.Mock).mockImplementation(async (name) => ({
    data: name === 'diary_summary' ? { entries: 70, words: 900 } : rows,
    error: null,
  }));
  const first = loadEntryList('a:c', 'c');
  expect(loadEntryList('a:c', 'c')).toBe(first);
  await first;
  expect(entryList('a:c').state.summary?.entries).toBe(70);
  (supabase.rpc as jest.Mock).mockResolvedValue({
    data: [{ id: '50', entry_date: '2026-10-25' }],
    error: null,
  });
  await loadEntryList('a:c', 'c', true);
  expect(supabase.rpc).toHaveBeenLastCalledWith(
    'list_diary_entries',
    expect.objectContaining({ p_before_id: '49', p_before_date: '2026-10-26' })
  );
  expect(entryList('a:c').state.entries).toHaveLength(51);
  expect(entryList('a:c').state.hasMore).toBe(false);
});
it('preserves visible content on failure and clears it immediately on account switch', async () => {
  (supabase.rpc as jest.Mock).mockImplementation(async (name) => ({
    data: name === 'diary_summary' ? { entries: 1, words: 1 } : [{ id: 'private' }],
    error: null,
  }));
  await loadEntryList('a:c', 'c');
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'offline' } });
  await loadEntryList('a:c', 'c');
  expect(entryList('a:c').state.entries[0].id).toBe('private');
  expect(entryList('a:c').state.error).toBe('offline');
  const previous = entryList('a:c');
  clearEntryLists();
  expect(previous.state.entries).toEqual([]);
  expect(entryList('b:d').state.entries).toEqual([]);
});
it('ignores a late response after invalidating account-scoped caches', async () => {
  let finish!: (v: unknown) => void;
  (supabase.rpc as jest.Mock).mockImplementation((name) =>
    name === 'diary_summary'
      ? Promise.resolve({ data: { entries: 1, words: 1 }, error: null })
      : new Promise((done) => {
          finish = done;
        })
  );
  const previous = entryList('a:c');
  const pending = loadEntryList('a:c', 'c');
  clearEntryLists();
  finish({ data: [{ id: 'stale' }], error: null });
  await pending;
  expect(previous.state.entries).toEqual([]);
  expect(entryList('a:c').state.entries).toEqual([]);
});
