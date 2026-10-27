import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { CoupleProvider, useCouple } from '../CoupleProvider';
import { supabase } from '../../lib/supabase';
let mockUser: { id: string } | null = { id: 'me' };
let mockCouple: Record<string, unknown> | null;
let mockOverview: Record<string, unknown>;
let mockListeners: ((state: AppStateStatus) => void)[];
jest.mock('../AuthProvider', () => ({ useAuth: () => ({ user: mockUser, profile: null }) }));
jest.mock('../../features/account/deletion', () => ({ requestDeletion: jest.fn() }));
jest.mock('../../lib/storage', () => ({ getSignedUrl: jest.fn() }));
const membership = jest.fn();
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-12-31T23:59:00Z'));
  jest.clearAllMocks();
  mockUser = { id: 'me' };
  mockListeners = [];
  mockCouple = {
    id: 'couple',
    partner_1_id: 'me',
    partner_2_id: 'partner',
    reveal_timezone: 'UTC',
    reveal_time: '00:00',
    schedule_version: 1,
  };
  mockOverview = {
    couple_id: 'couple',
    server_now: '2027-01-01T07:59:00Z',
    annual: {
      year: 2027,
      ready_at: '2027-01-01T08:00:00Z',
      timezone: 'America/Los_Angeles',
      is_ready: false,
    },
    annual_history: [],
    checkpoints: [],
    checkpoint_history: [],
  };
  membership.mockImplementation(async () => ({ data: mockCouple, error: null }));
  (supabase.from as jest.Mock).mockImplementation(() => ({
    select: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: membership,
    single: jest
      .fn()
      .mockResolvedValue({ data: { id: 'partner', display_name: 'Love' }, error: null }),
  }));
  (supabase.rpc as jest.Mock).mockImplementation(async () => ({ data: mockOverview, error: null }));
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    mockListeners.push(listener);
    return { remove: jest.fn() };
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
it('uses server time across a wrong device clock, refreshes at the deadline and on foreground', async () => {
  const hook = renderHook(() => useCouple(), { wrapper: CoupleProvider });
  await act(flush);
  expect(hook.result.current.serverNow()).toBe(Date.parse('2027-01-01T07:59:00Z'));
  expect(hook.result.current.daysUntilAnniversary).toBe(1);
  const initial = (supabase.rpc as jest.Mock).mock.calls.length;
  // Poll/foreground responses move the same server clock forward.
  (supabase.rpc as jest.Mock).mockImplementation(async () => ({
    data: {
      ...mockOverview,
      server_now: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      annual: {
        ...(mockOverview.annual as object),
        is_ready: Date.now() >= Date.parse('2027-01-01T00:00:00Z'),
      },
    },
    error: null,
  }));
  await act(async () => {
    jest.advanceTimersByTime(60060);
    await flush();
  });
  expect((supabase.rpc as jest.Mock).mock.calls.length).toBeGreaterThan(initial);
  expect(hook.result.current.isRevealReady).toBe(true);
  const before = (supabase.rpc as jest.Mock).mock.calls.length;
  await act(async () => {
    mockListeners.forEach((listener) => listener('active'));
    await flush();
  });
  expect((supabase.rpc as jest.Mock).mock.calls.length).toBe(before + 1);
});
it('clears old history on account switch and ignores an old membership response', async () => {
  let resolve!: (value: unknown) => void;
  membership.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const hook = renderHook(() => useCouple(), { wrapper: CoupleProvider });
  await act(flush);
  mockUser = null;
  hook.rerender({});
  await act(flush);
  expect(hook.result.current.couple).toBeNull();
  expect(hook.result.current.overview).toBeNull();
  await act(async () => {
    resolve({ data: mockCouple, error: null });
    await flush();
  });
  expect(hook.result.current.couple).toBeNull();
  expect(supabase.rpc).not.toHaveBeenCalled();
});
it('converges to partner schedule changes and unpairing through shared refresh', async () => {
  const hook = renderHook(() => useCouple(), { wrapper: CoupleProvider });
  await act(flush);
  mockOverview = { ...mockOverview, schedule_version: 2, checkpoint_history: [{ id: 'new' }] };
  await act(async () => {
    await hook.result.current.refresh();
  });
  expect(hook.result.current.overview?.checkpoint_history).toHaveLength(1);
  mockCouple = null;
  await act(async () => {
    await hook.result.current.refresh();
  });
  expect(hook.result.current.couple).toBeNull();
  expect(hook.result.current.partner).toBeNull();
  expect(hook.result.current.overview).toBeNull();
});

it('keeps the server clock stable if the device clock changes while open', async () => {
  const hook = renderHook(() => useCouple(), { wrapper: CoupleProvider });
  await act(flush);
  const server = hook.result.current.serverNow();
  jest.setSystemTime(new Date('2035-01-01T00:00:00Z'));
  expect(hook.result.current.serverNow()).toBe(server);
  expect(hook.result.current.isRevealReady).toBe(false);
});
