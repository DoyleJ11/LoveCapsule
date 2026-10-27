import { act, renderHook } from '@testing-library/react-native';
import { useReveal } from '../useReveal';
import { supabase } from '../../lib/supabase';
beforeEach(() => jest.clearAllMocks());
it('uses the returned event year and immutable manifest with one atomic request', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({
    data: { id: 'event', reveal_year: 2025, entries: [{ id: 'december2024' }] },
    error: null,
  });
  const hook = renderHook(() => useReveal('couple'));
  await act(async () => {
    expect((await hook.result.current.annual(2025, true))?.entries[0].id).toBe('december2024');
  });
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.rpc).toHaveBeenCalledWith('open_annual_event', {
    p_couple_id: 'couple',
    p_year: 2025,
  });
});
it('does not enter a reader on failed or missing confirmation and retries the same occurrence', async () => {
  (supabase.rpc as jest.Mock)
    .mockResolvedValueOnce({ data: null, error: { message: 'connection lost' } })
    .mockResolvedValueOnce({ data: { occurrence_id: 'occ', entry: { id: 'note' } }, error: null });
  const hook = renderHook(() => useReveal('couple'));
  await act(async () => {
    expect(await hook.result.current.checkpoint('occ')).toBeNull();
  });
  expect(hook.result.current.error).toBe('connection lost');
  await act(async () => {
    expect((await hook.result.current.checkpoint('occ'))?.entry?.id).toBe('note');
  });
  expect(hook.result.current.error).toBeNull();
  expect(
    (supabase.rpc as jest.Mock).mock.calls.every((call) => call[1].p_occurrence_id === 'occ')
  ).toBe(true);
});
it('suppresses concurrent taps and ignores a response after account scope unmounts', async () => {
  let finish!: (value: unknown) => void;
  (supabase.rpc as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const hook = renderHook(() => useReveal('old-couple'));
  let result!: Promise<unknown>;
  act(() => {
    result = hook.result.current.annual(2026, true);
  });
  await act(async () => {
    expect(await hook.result.current.annual(2026, true)).toBeNull();
  });
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  hook.unmount();
  finish({ data: { id: 'old-event', entries: [] }, error: null });
  expect(await result).toBeNull();
});
