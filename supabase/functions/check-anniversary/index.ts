import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decideReveal } from './reveal-logic.ts';

/**
 * Opens a couple's anniversary capsule.
 *
 * The caller is identified from their JWT and must be a member of the
 * couple they name — the request body is never trusted for identity.
 * Requires verify_jwt = true (see supabase/config.toml).
 *
 * Business outcomes ("not your anniversary yet", "no date set") return
 * 200 with an { error } payload: supabase-js discards response bodies on
 * non-2xx, so a 400 would reach the app as an unreadable generic
 * "non-2xx status code" message. Genuine auth/server failures still use
 * real status codes.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return json({ error: 'Missing authorization' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Identify the caller from their token, not from the request body.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json({ error: 'Invalid or expired session' }, 401);
    }

    let couple_id: string | undefined;
    try {
      ({ couple_id } = await req.json());
    } catch {
      return json({ error: 'Invalid request body' }, 400);
    }
    if (!couple_id) {
      return json({ error: 'couple_id is required' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: couple, error: coupleError } = await admin
      .from('couples')
      .select('id, anniversary_date, last_reveal_year, partner_1_id, partner_2_id')
      .eq('id', couple_id)
      .single();

    if (coupleError || !couple) {
      return json({ error: 'Couple not found' }, 404);
    }

    // Authorize: the caller must belong to THIS couple.
    if (couple.partner_1_id !== user.id && couple.partner_2_id !== user.id) {
      return json({ error: 'Not a member of this couple' }, 403);
    }

    const decision = decideReveal(couple.anniversary_date, couple.last_reveal_year, new Date());

    if (decision.status === 'no_anniversary') {
      return json({ error: 'No anniversary date set' });
    }

    if (decision.status === 'not_reached') {
      return json({ error: `Your capsule opens on ${decision.readyOn}` });
    }

    if (decision.status === 'already_revealed') {
      return json({
        success: true,
        revealed: true,
        already_revealed: true,
        year: decision.year,
      });
    }

    // Atomic transition: only flip if last_reveal_year is still what we
    // read, so two devices opening at once cannot both "win".
    let update = admin
      .from('couples')
      .update({
        is_revealed: true,
        last_reveal_year: decision.year,
        updated_at: new Date().toISOString(),
      })
      .eq('id', couple_id);

    update =
      couple.last_reveal_year === null
        ? update.is('last_reveal_year', null)
        : update.eq('last_reveal_year', couple.last_reveal_year);

    const { data: updated, error: updateError } = await update.select('last_reveal_year');

    if (updateError) {
      return json({ error: 'Failed to update reveal status' }, 500);
    }

    if (!updated || updated.length === 0) {
      // Lost the race — that is fine as long as the end state is right.
      const { data: fresh } = await admin
        .from('couples')
        .select('last_reveal_year')
        .eq('id', couple_id)
        .single();

      if (fresh?.last_reveal_year === decision.year) {
        return json({
          success: true,
          revealed: true,
          already_revealed: true,
          year: decision.year,
        });
      }

      return json({ error: 'Reveal conflicted, please try again' }, 409);
    }

    return json({ success: true, revealed: true, year: decision.year });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
