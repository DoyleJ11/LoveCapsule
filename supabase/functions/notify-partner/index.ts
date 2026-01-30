import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const entry = payload.record ?? payload;

    // Skip drafts
    if (entry.is_draft) {
      return new Response('skip: draft', { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get couple info
    const { data: couple, error: coupleError } = await supabase
      .from('couples')
      .select('partner_1_id, partner_2_id')
      .eq('id', entry.couple_id)
      .single();

    if (coupleError || !couple) {
      return new Response('no couple found', { status: 200 });
    }

    // Find the partner (the person who did NOT write this entry)
    const partnerId =
      couple.partner_1_id === entry.author_id
        ? couple.partner_2_id
        : couple.partner_1_id;

    if (!partnerId) {
      return new Response('no partner', { status: 200 });
    }

    // Get partner's push token and author's name
    const [partnerResult, authorResult] = await Promise.all([
      supabase.from('profiles').select('expo_push_token').eq('id', partnerId).single(),
      supabase.from('profiles').select('display_name').eq('id', entry.author_id).single(),
    ]);

    const pushToken = partnerResult.data?.expo_push_token;
    if (!pushToken) {
      return new Response('no push token', { status: 200 });
    }

    const authorName = authorResult.data?.display_name ?? 'Your partner';

    // Send push notification via Expo Push API
    const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        to: pushToken,
        title: 'New Diary Entry!',
        body: `${authorName} just wrote something new`,
        data: { type: 'new_entry' },
        sound: 'default',
      }),
    });

    const pushResult = await pushResponse.json();

    return new Response(JSON.stringify({ sent: true, result: pushResult }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
