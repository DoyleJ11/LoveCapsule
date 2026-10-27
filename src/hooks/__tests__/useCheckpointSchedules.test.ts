import { act, renderHook } from '@testing-library/react-native';
import { useCheckpoint } from '../useCheckpoint';
import { supabase } from '../../lib/supabase';
const mockRefresh = jest.fn().mockResolvedValue(undefined);
jest.mock('../../providers/CoupleProvider', () => ({
  useCouple: () => ({ couple: { id: 'couple' }, refresh: mockRefresh }),
}));
beforeEach(() => jest.clearAllMocks());
it('sends a stable create ID, timezone and exact time again after a lost response', async () => {
  (supabase.rpc as jest.Mock)
    .mockResolvedValueOnce({ data: null, error: { message: 'response lost' } })
    .mockResolvedValueOnce({ data: { id: 'stable' }, error: null });
  (supabase.from as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: [], error: null }),
  });
  const config = {
    id: 'stable',
    couple_id: 'couple',
    frequency: 'specific_date' as const,
    specific_date: '2027-01-01',
    day_of_month: null,
    months: null,
    label: 'Our moment',
    is_active: true,
    reveal_time: '19:30',
    timezone: 'America/Los_Angeles',
  };
  const hook = renderHook(() => useCheckpoint());
  await act(async () => {
    await expect(hook.result.current.createConfig(config)).rejects.toMatchObject({
      message: 'response lost',
    });
  });
  await act(async () => {
    await hook.result.current.createConfig(config);
  });
  const calls = (supabase.rpc as jest.Mock).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
  expect(calls[0][1]).toMatchObject({
    p_id: 'stable',
    p_config: { reveal_time: '19:30', timezone: 'America/Los_Angeles' },
  });
  expect(mockRefresh).toHaveBeenCalled();
});

it('keeps the version captured by an editor when background refresh sees a newer version', async () => {
  (supabase.from as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({
      data: [{ id: 'schedule', couple_id: 'couple', version: 2 }],
      error: null,
    }),
  });
  (supabase.rpc as jest.Mock).mockResolvedValue({
    data: null,
    error: { message: 'Schedule changed', code: '40001' },
  });
  const hook = renderHook(() => useCheckpoint());
  await act(async () => {
    await hook.result.current.loadConfigs('couple');
  });
  await act(async () => {
    await expect(
      hook.result.current.updateConfig('schedule', { version: 1, label: 'Stale form' })
    ).rejects.toMatchObject({ code: '40001' });
  });
  expect(supabase.rpc).toHaveBeenCalledWith(
    'save_checkpoint_schedule',
    expect.objectContaining({ p_expected_version: 1 })
  );
});
