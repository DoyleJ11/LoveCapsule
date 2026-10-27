import { act, renderHook } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '../AuthProvider';
import { supabase } from '../../lib/supabase';
let event: (name: string, session: unknown) => void;
const session = (id: string) => ({ user: { id, user_metadata: {} } });
const read = jest.fn(),
  upsert = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(supabase.auth, { startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() });
  (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation((callback) => {
    event = callback;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({
    data: { session: session('a') },
    error: null,
  });
  (supabase.from as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: read,
    upsert,
    single: read,
  });
});
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
it('network failure never creates a missing profile and offers retry', async () => {
  read
    .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
    .mockResolvedValue({ data: { id: 'a' }, error: null });
  const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await act(flush);
  expect(upsert).not.toHaveBeenCalled();
  expect(hook.result.current.error).toBe('offline');
  await act(() => hook.result.current.refreshProfile());
  expect(hook.result.current.profile?.id).toBe('a');
});
it('a successful absent read repairs the profile without overwriting a concurrent trigger', async () => {
  read
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValue({ data: { id: 'a', display_name: 'Kept' }, error: null });
  upsert.mockResolvedValue({ error: null });
  const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await act(flush);
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
    onConflict: 'id',
    ignoreDuplicates: true,
  });
  expect(hook.result.current.profile?.display_name).toBe('Kept');
});
it('ignores obsolete profile requests and does not restart loading on token refresh', async () => {
  let finish!: (v: unknown) => void;
  read
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        })
    )
    .mockResolvedValue({ data: { id: 'b' }, error: null });
  const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await act(flush);
  await act(async () => {
    event('SIGNED_IN', session('b'));
    await flush();
  });
  await act(async () => {
    finish({ data: { id: 'a' }, error: null });
    await flush();
  });
  expect(hook.result.current.profile?.id).toBe('b');
  const count = read.mock.calls.length;
  await act(async () => {
    event('TOKEN_REFRESHED', session('b'));
    await flush();
  });
  expect(read.mock.calls.length).toBe(count);
  expect(hook.result.current.loading).toBe(false);
});
