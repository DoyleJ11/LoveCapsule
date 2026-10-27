import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Compatibility endpoint for older app builds. The database owns eligibility,
// year selection, snapshot and original opening time in one transaction.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer '))
    return json({ error: 'Missing authorization' }, 401);
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user) return json({ error: 'Invalid or expired session' }, 401);
  try {
    const { couple_id } = await req.json();
    if (!couple_id) return json({ error: 'couple_id is required' }, 400);
    const { data: overview, error } = await client.rpc('get_reveal_overview', {
      p_couple_id: couple_id,
    });
    if (error) return json({ error: error.message });
    const year = overview.annual?.is_ready
      ? overview.annual.year
      : overview.annual_history[0]?.year;
    if (!year) return json({ error: 'Your capsule is not ready yet' });
    const { data: event, error: openError } = await client.rpc('open_annual_event', {
      p_couple_id: couple_id,
      p_year: year,
    });
    if (openError) return json({ error: openError.message });
    return json({ success: true, revealed: true, year: event.reveal_year, event_id: event.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
