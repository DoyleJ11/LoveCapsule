import { acceptAuthLink } from '../links';
import { supabase } from '../../../lib/supabase';
const exchange = jest.fn(),
  set = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(supabase.auth, { exchangeCodeForSession: exchange, setSession: set });
});
it('deduplicates concurrent callback exchanges and preserves recovery intent', async () => {
  exchange.mockResolvedValue({ data: { redirectType: 'recovery' }, error: null });
  const link = 'lovecapsule://auth/callback?code=recovery-code';
  expect(await Promise.all([acceptAuthLink(link), acceptAuthLink(link)])).toEqual([
    'recovery',
    'recovery',
  ]);
  expect(exchange).toHaveBeenCalledTimes(1);
});
it('permits a failed link exchange to be retried', async () => {
  exchange
    .mockResolvedValueOnce({ data: {}, error: { message: 'offline' } })
    .mockResolvedValue({ data: {}, error: null });
  const link = 'lovecapsule://auth/callback?code=retry-code';
  await expect(acceptAuthLink(link)).rejects.toEqual({ message: 'offline' });
  expect(await acceptAuthLink(link)).toBe('signed_in');
  expect(exchange).toHaveBeenCalledTimes(2);
});
it('rejects incomplete and foreign links before touching a session', async () => {
  await expect(acceptAuthLink('lovecapsule://auth/callback#refresh_token=only')).rejects.toThrow(
    'incomplete'
  );
  await expect(acceptAuthLink('https://example.com/auth/callback?code=stolen')).rejects.toThrow(
    'LoveCapsule'
  );
  expect(exchange).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
});
