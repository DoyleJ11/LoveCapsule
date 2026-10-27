import { supabase } from '../../lib/supabase';
export const AUTH_CALLBACK = 'lovecapsule://auth/callback';
type Destination = 'recovery' | 'signed_in';
// Concurrent warm/cold callbacks share the same exchange; failed exchanges remain retryable.
const exchanges = new Map<string, Promise<Destination>>();
export async function acceptAuthLink(value: string): Promise<Destination> {
  const url = new URL(value);
  if (url.protocol !== 'lovecapsule:' || url.hostname !== 'auth' || url.pathname !== '/callback')
    throw new Error('This is not a LoveCapsule sign-in link.');
  const params = new URLSearchParams(url.search.slice(1) || url.hash.slice(1));
  if (params.get('error'))
    throw new Error('This sign-in link expired or could not be verified. Request a new link.');
  const code = params.get('code'),
    access = params.get('access_token'),
    refresh = params.get('refresh_token');
  const key = code ?? (access && refresh);
  if (!key) throw new Error('This sign-in link is incomplete. Request a new link.');
  let pending = exchanges.get(key);
  if (!pending) {
    pending = (async () => {
      const result = code
        ? await supabase.auth.exchangeCodeForSession(code)
        : await supabase.auth.setSession({ access_token: access!, refresh_token: refresh! });
      if (result.error) throw result.error;
      const redirectType = 'redirectType' in result.data ? result.data.redirectType : null;
      return params.get('type') === 'recovery' || redirectType === 'recovery'
        ? 'recovery'
        : 'signed_in';
    })();
    exchanges.set(key, pending);
    void pending.catch(() => exchanges.delete(key));
  }
  return pending;
}
