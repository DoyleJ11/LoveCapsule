import { act, renderHook } from '@testing-library/react-native';
import { useEntries } from '../useEntries';
import { supabase } from '../../lib/supabase';
let mockUser: { id: string } | null = { id: 'first' };
jest.mock('../../providers/AuthProvider', () => ({ useAuth: () => ({ user: mockUser }) }));
it('does not restore old diary data when a request completes after an account switch', async () => {
  let finish!: (value: unknown) => void;
  const order = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue({ data: [{ id: 'new-note' }], error: null });
  (supabase.rpc as jest.Mock).mockImplementation((name) =>
    name === 'diary_summary'
      ? Promise.resolve({ data: { entries: 1, words: 2 }, error: null })
      : order()
  );
  const hook = renderHook(({ couple }: { couple: string }) => useEntries(couple), {
    initialProps: { couple: 'old' },
  });
  mockUser = { id: 'second' };
  hook.rerender({ couple: 'new' });
  await act(async () => {
    await Promise.resolve();
  });
  expect(hook.result.current.entries.map((e) => e.id)).toEqual(['new-note']);
  await act(async () => {
    finish({ data: [{ id: 'old-private-note' }], error: null });
  });
  expect(hook.result.current.entries.map((e) => e.id)).toEqual(['new-note']);
  mockUser = null;
  hook.rerender({ couple: 'new' });
  expect(hook.result.current.entries).toEqual([]);
});
