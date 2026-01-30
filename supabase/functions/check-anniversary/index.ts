import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const { couple_id } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get the couple
    const { data: couple, error: coupleError } = await supabase
      .from('couples')
      .select('*')
      .eq('id', couple_id)
      .single();

    if (coupleError || !couple) {
      return new Response(
        JSON.stringify({ error: 'Couple not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!couple.anniversary_date) {
      return new Response(
        JSON.stringify({ error: 'No anniversary date set' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if the anniversary date has been reached
    const today = new Date();
    const currentYear = today.getFullYear();
    const anniversary = new Date(couple.anniversary_date);
    const anniversaryThisYear = new Date(currentYear, anniversary.getMonth(), anniversary.getDate());

    const isReady =
      today >= anniversaryThisYear &&
      (couple.last_reveal_year === null || couple.last_reveal_year < currentYear);

    if (!isReady) {
      return new Response(
        JSON.stringify({ error: 'Anniversary has not been reached yet' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Flip the reveal flag
    const { error: updateError } = await supabase
      .from('couples')
      .update({
        is_revealed: true,
        last_reveal_year: currentYear,
        updated_at: new Date().toISOString(),
      })
      .eq('id', couple_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: 'Failed to update reveal status' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, revealed: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
