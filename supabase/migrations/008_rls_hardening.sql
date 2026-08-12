-- ============================================
-- RLS & RPC HARDENING (audit C5 / C6 / C7)
-- ============================================
-- 1. Invite codes were readable by any signed-in user via the
--    "Anyone can view open couples" policy, enabling pairing hijack.
--    Drop the policy and move joining into a SECURITY DEFINER RPC
--    (the client's UPDATE ... WHERE invite_code = ... needed that
--    SELECT visibility to find the row, so the policy cannot simply
--    be removed), plus switch code generation to a crypto-random
--    source.
-- 2. Entries/media write policies only checked author_id, letting a
--    user insert rows into ANY couple. Add couple-membership checks.
-- 3. Several SECURITY DEFINER RPCs never verified the caller belongs
--    to the couple they query, leaking names/stats/GPS locations and
--    allowing arbitrary reveal-history writes. Add membership guards,
--    pin search_path, and restrict EXECUTE to authenticated users.

-- ============================================
-- C6: Invite codes
-- ============================================

DROP POLICY "Anyone can view open couples" ON public.couples;

-- 12 hex chars sourced from gen_random_uuid() (cryptographically random,
-- no extension dependency) instead of 8 chars of md5(random()).
ALTER TABLE public.couples ALTER COLUMN invite_code
  SET DEFAULT lower(substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 12));

-- Joining is now server-side: the caller never needs to SELECT the open
-- couple (which is what leaked every invite code). Runs as SECURITY
-- DEFINER so it can find the row by code, but only ever sets
-- partner_2_id to the CALLER's own id, and only on a couple that is
-- still open and not their own.
CREATE OR REPLACE FUNCTION public.join_couple_by_code(p_invite_code TEXT)
RETURNS public.couples AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_couple public.couples;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Reject if the caller is already in a couple (guards the
  -- multi-membership problem the client only checked locally).
  IF EXISTS (
    SELECT 1 FROM public.couples
    WHERE partner_1_id = v_user_id OR partner_2_id = v_user_id
  ) THEN
    -- Allow the common case of abandoning your own still-empty couple.
    DELETE FROM public.couples
    WHERE partner_1_id = v_user_id AND partner_2_id IS NULL;

    IF EXISTS (
      SELECT 1 FROM public.couples
      WHERE partner_1_id = v_user_id OR partner_2_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'You are already paired' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.couples
    SET partner_2_id = v_user_id,
        updated_at = now()
  WHERE lower(invite_code) = lower(btrim(p_invite_code))
    AND partner_2_id IS NULL
    AND partner_1_id <> v_user_id
  RETURNING * INTO v_couple;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invite code or couple already full'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_couple;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.join_couple_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_couple_by_code(text) TO authenticated, service_role;

-- ============================================
-- C7: Write policies must include couple membership
-- ============================================
-- WITH CHECK applies to INSERT and to the new row of UPDATE.
-- Entries: the author must belong to the couple they write into.

ALTER POLICY "Authors can manage own entries" ON public.entries
  WITH CHECK (
    author_id = auth.uid()
    AND couple_id IN (
      SELECT id FROM public.couples
      WHERE partner_1_id = auth.uid() OR partner_2_id = auth.uid()
    )
  );

-- Media: rows may only attach to the author's own entries (entry
-- ownership implies couple membership via the entries policy above).
ALTER POLICY "Authors can manage own media" ON public.media
  WITH CHECK (
    author_id = auth.uid()
    AND entry_id IN (
      SELECT id FROM public.entries WHERE author_id = auth.uid()
    )
  );

-- ============================================
-- C5: Membership guards on SECURITY DEFINER RPCs
-- ============================================

CREATE OR REPLACE FUNCTION public.assert_couple_member(p_couple_id UUID)
RETURNS VOID AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.couples
    WHERE id = p_couple_id
      AND (partner_1_id = auth.uid() OR partner_2_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not a member of this couple'
      USING ERRCODE = '42501';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Migration 002 OVERLOADED get_reveal_stats instead of replacing it:
-- the unguarded single-argument version from 001 still exists. Drop it
-- (the app always calls the two-argument version, and the overload also
-- made PostgREST resolution ambiguous for single-argument calls).
DROP FUNCTION IF EXISTS public.get_reveal_stats(uuid);

-- ---- get_reveal_stats(couple, year): guarded ----
CREATE OR REPLACE FUNCTION get_reveal_stats(p_couple_id UUID, p_year INT DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  v_p1_id UUID;
  v_p2_id UUID;
  v_p1_name TEXT;
  v_p2_name TEXT;
  v_result JSON;
  v_year_start DATE;
  v_year_end DATE;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);

  -- If year is provided, set date range filters
  IF p_year IS NOT NULL THEN
    v_year_start := make_date(p_year, 1, 1);
    v_year_end := make_date(p_year, 12, 31);
  END IF;

  -- Get couple info
  SELECT partner_1_id, partner_2_id INTO v_p1_id, v_p2_id
  FROM public.couples WHERE id = p_couple_id;

  SELECT display_name INTO v_p1_name FROM public.profiles WHERE id = v_p1_id;
  SELECT display_name INTO v_p2_name FROM public.profiles WHERE id = v_p2_id;

  SELECT json_build_object(
    'partner_1_id', v_p1_id,
    'partner_2_id', v_p2_id,
    'partner_1_name', v_p1_name,
    'partner_2_name', v_p2_name,
    'year', p_year,
    'partner_1_entries', (
      SELECT COUNT(*) FROM entries
      WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
    ),
    'partner_2_entries', (
      SELECT COUNT(*) FROM entries
      WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
    ),
    'partner_1_words', (
      SELECT COALESCE(SUM(word_count), 0) FROM entries
      WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
    ),
    'partner_2_words', (
      SELECT COALESCE(SUM(word_count), 0) FROM entries
      WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
    ),
    'partner_1_avg_hour', (
      SELECT COALESCE(AVG(EXTRACT(HOUR FROM created_at)), 12) FROM entries
      WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
    ),
    'partner_2_avg_hour', (
      SELECT COALESCE(AVG(EXTRACT(HOUR FROM created_at)), 12) FROM entries
      WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
    ),
    'most_active_month', (
      SELECT to_char(entry_date, 'Month')
      FROM entries WHERE couple_id = p_couple_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
      GROUP BY to_char(entry_date, 'Month')
      ORDER BY COUNT(*) DESC LIMIT 1
    ),
    'most_active_month_count', (
      SELECT COUNT(*)
      FROM entries WHERE couple_id = p_couple_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
      GROUP BY to_char(entry_date, 'Month')
      ORDER BY COUNT(*) DESC LIMIT 1
    ),
    'longest_entry_words', (
      SELECT COALESCE(MAX(word_count), 0) FROM entries
      WHERE couple_id = p_couple_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
    ),
    'longest_entry_author_id', (
      SELECT author_id FROM entries
      WHERE couple_id = p_couple_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
      ORDER BY word_count DESC LIMIT 1
    ),
    'longest_entry_date', (
      SELECT entry_date FROM entries
      WHERE couple_id = p_couple_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
      ORDER BY word_count DESC LIMIT 1
    ),
    'partner_1_longest_streak', (
      SELECT COALESCE(MAX(streak_len), 0) FROM (
        SELECT COUNT(*) as streak_len
        FROM (
          SELECT entry_date,
                 entry_date - (ROW_NUMBER() OVER (ORDER BY entry_date))::int AS grp
          FROM (
            SELECT DISTINCT entry_date FROM entries
            WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft
            AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
          ) sub
        ) grouped
        GROUP BY grp
      ) streaks
    ),
    'partner_2_longest_streak', (
      SELECT COALESCE(MAX(streak_len), 0) FROM (
        SELECT COUNT(*) as streak_len
        FROM (
          SELECT entry_date,
                 entry_date - (ROW_NUMBER() OVER (ORDER BY entry_date))::int AS grp
          FROM (
            SELECT DISTINCT entry_date FROM entries
            WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft
            AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
          ) sub
        ) grouped
        GROUP BY grp
      ) streaks
    ),
    'total_media_images', (
      SELECT COUNT(*) FROM media m JOIN entries e ON m.entry_id = e.id
      WHERE e.couple_id = p_couple_id AND NOT e.is_draft AND m.media_type = 'image'
      AND (p_year IS NULL OR (e.entry_date >= v_year_start AND e.entry_date <= v_year_end))
    ),
    'total_media_videos', (
      SELECT COUNT(*) FROM media m JOIN entries e ON m.entry_id = e.id
      WHERE e.couple_id = p_couple_id AND NOT e.is_draft AND m.media_type = 'video'
      AND (p_year IS NULL OR (e.entry_date >= v_year_start AND e.entry_date <= v_year_end))
    ),
    'partner_1_top_mood', (
      SELECT mood FROM entries
      WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft AND mood IS NOT NULL
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
      GROUP BY mood ORDER BY COUNT(*) DESC LIMIT 1
    ),
    'partner_2_top_mood', (
      SELECT mood FROM entries
      WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft AND mood IS NOT NULL
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
      GROUP BY mood ORDER BY COUNT(*) DESC LIMIT 1
    ),
    'first_entry_date', (
      SELECT MIN(entry_date) FROM entries
      WHERE couple_id = p_couple_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
    ),
    'last_entry_date', (
      SELECT MAX(entry_date) FROM entries
      WHERE couple_id = p_couple_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
    ),
    'partner_1_favorite_dow', (
      SELECT to_char(entry_date, 'Day') FROM entries
      WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
      GROUP BY to_char(entry_date, 'Day') ORDER BY COUNT(*) DESC LIMIT 1
    ),
    'partner_2_favorite_dow', (
      SELECT to_char(entry_date, 'Day') FROM entries
      WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
      GROUP BY to_char(entry_date, 'Day') ORDER BY COUNT(*) DESC LIMIT 1
    ),
    'locations', (
      SELECT COALESCE(json_agg(json_build_object(
        'lat', location_lat,
        'lng', location_lng,
        'location_name', location_name,
        'author_id', author_id,
        'entry_date', entry_date
      )), '[]'::json)
      FROM entries
      WHERE couple_id = p_couple_id AND NOT is_draft AND location_lat IS NOT NULL
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
    ),
    'unique_location_count', (
      SELECT COUNT(DISTINCT (location_lat, location_lng))
      FROM entries
      WHERE couple_id = p_couple_id AND NOT is_draft AND location_lat IS NOT NULL
      AND (p_year IS NULL OR (entry_date >= v_year_start AND entry_date <= v_year_end))
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---- get_reveal_years: guarded ----
CREATE OR REPLACE FUNCTION get_reveal_years(p_couple_id UUID)
RETURNS JSON AS $$
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);

  RETURN (
    SELECT COALESCE(json_agg(json_build_object(
      'year', reveal_year,
      'revealed_at', revealed_at
    ) ORDER BY reveal_year DESC), '[]'::json)
    FROM public.reveal_history
    WHERE couple_id = p_couple_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---- save_reveal_snapshot: guarded ----
CREATE OR REPLACE FUNCTION save_reveal_snapshot(p_couple_id UUID, p_year INT, p_stats JSONB)
RETURNS VOID AS $$
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);

  INSERT INTO public.reveal_history (couple_id, reveal_year, stats_snapshot)
  VALUES (p_couple_id, p_year, p_stats)
  ON CONFLICT (couple_id, reveal_year)
  DO UPDATE SET stats_snapshot = p_stats, revealed_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---- get_partner_entry_count: guarded (was LANGUAGE sql) ----
CREATE OR REPLACE FUNCTION get_partner_entry_count(p_couple_id UUID)
RETURNS INT AS $$
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);

  RETURN (
    SELECT COUNT(*)::INT
    FROM public.entries
    WHERE couple_id = p_couple_id
      AND author_id != auth.uid()
      AND is_draft = false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---- check_checkpoint_today: guarded ----
CREATE OR REPLACE FUNCTION check_checkpoint_today(p_couple_id UUID)
RETURNS JSON AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_day_of_month INT := EXTRACT(DAY FROM v_today);
  v_month INT := EXTRACT(MONTH FROM v_today);
  v_result JSON;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);

  SELECT json_build_object(
    'is_checkpoint_day', EXISTS (
      SELECT 1 FROM public.checkpoint_configs
      WHERE couple_id = p_couple_id
        AND is_active = true
        AND (
          (frequency = 'monthly' AND day_of_month = v_day_of_month)
          OR (frequency = 'quarterly' AND day_of_month = v_day_of_month AND v_month = ANY(months))
          OR (frequency = 'semi_annual' AND day_of_month = v_day_of_month AND v_month = ANY(months))
          OR (frequency = 'specific_date' AND specific_date = v_today)
        )
    ),
    'checkpoints', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', id,
        'frequency', frequency,
        'label', label,
        'day_of_month', day_of_month,
        'months', months,
        'specific_date', specific_date
      )), '[]'::json)
      FROM public.checkpoint_configs
      WHERE couple_id = p_couple_id
        AND is_active = true
        AND (
          (frequency = 'monthly' AND day_of_month = v_day_of_month)
          OR (frequency = 'quarterly' AND day_of_month = v_day_of_month AND v_month = ANY(months))
          OR (frequency = 'semi_annual' AND day_of_month = v_day_of_month AND v_month = ANY(months))
          OR (frequency = 'specific_date' AND specific_date = v_today)
        )
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---- Pin search_path on the remaining SECURITY DEFINER functions ----
ALTER FUNCTION public.get_checkpoint_entry(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.get_checkpoint_history(uuid) SET search_path = public;
ALTER FUNCTION public.get_unrevealed_entry_count(uuid) SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;

-- ---- EXECUTE: authenticated (and service_role) only ----
REVOKE EXECUTE ON FUNCTION public.assert_couple_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_reveal_stats(uuid, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_reveal_years(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_reveal_snapshot(uuid, int, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_partner_entry_count(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_checkpoint_today(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_checkpoint_entry(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_checkpoint_history(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_unrevealed_entry_count(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.assert_couple_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_reveal_stats(uuid, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_reveal_years(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_reveal_snapshot(uuid, int, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_partner_entry_count(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_checkpoint_today(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_checkpoint_entry(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_checkpoint_history(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_unrevealed_entry_count(uuid) TO authenticated, service_role;
