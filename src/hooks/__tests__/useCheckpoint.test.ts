import { act, renderHook } from '@testing-library/react-native';
import { useCheckpoint } from '../useCheckpoint';
import { supabase } from '../../lib/supabase';
beforeEach(() => {
  (supabase.rpc as jest.Mock).mockReset();
});
it('suppresses a same-render duplicate claim', async () => {
  let resolve!: (value: unknown) => void;
  (supabase.rpc as jest.Mock).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const hook = renderHook(() => useCheckpoint());
  let first!: Promise<boolean>;
  let duplicate!: Promise<boolean>;
  act(() => {
    first = hook.result.current.revealEntry('couple');
    duplicate = hook.result.current.revealEntry('couple');
  });
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  await expect(duplicate).resolves.toBe(false);
  await act(async () => {
    resolve({
      data: { entry: { id: 'note' }, already_revealed: false, no_entries: false },
      error: null,
    });
    await first;
  });
  expect(hook.result.current.checkpointEntry?.id).toBe('note');
});
it('clears the old note when a later reveal fails', async () => {
  (supabase.rpc as jest.Mock)
    .mockResolvedValueOnce({
      data: { entry: { id: 'old' }, already_revealed: true, no_entries: false },
      error: null,
    })
    .mockResolvedValueOnce({ data: null, error: { message: 'not due' } });
  const hook = renderHook(() => useCheckpoint());
  await act(async () => {
    await hook.result.current.revealEntry('couple');
  });
  await act(async () => {
    expect(await hook.result.current.revealEntry('couple')).toBe(false);
  });
  expect(hook.result.current.checkpointEntry).toBeNull();
  expect(hook.result.current.error).toBe('not due');
});
it('treats an empty but valid claim as a successful empty view', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({
    data: { entry: null, already_revealed: false, no_entries: true },
    error: null,
  });
  const hook = renderHook(() => useCheckpoint());
  await act(async () => {
    expect(await hook.result.current.revealEntry('couple')).toBe(true);
  });
  expect(hook.result.current.noEntriesRemaining).toBe(true);
});
