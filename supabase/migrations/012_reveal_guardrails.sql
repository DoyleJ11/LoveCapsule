-- Batch 1: trusted, retry-safe reveal entitlements. Existing legitimate
-- checkpoint history is retained, including extra notes exposed by the old bug.
-- No policy relies on the legacy is_revealed flag.

CREATE TABLE public.annual_reveal_entries (
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  entry_id UUID PRIMARY KEY REFERENCES public.entries(id) ON DELETE CASCADE,
  reveal_year INT NOT NULL
);
ALTER TABLE public.annual_reveal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can read annual entitlements"
  ON public.annual_reveal_entries FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.couples c WHERE c.id = couple_id
      AND auth.uid() IN (c.partner_1_id, c.partner_2_id))
  );
REVOKE INSERT, UPDATE, DELETE ON public.annual_reveal_entries FROM anon, authenticated;

INSERT INTO public.annual_reveal_entries(couple_id, entry_id, reveal_year)
SELECT e.couple_id, e.id, COALESCE((
  SELECT min(h.reveal_year) FROM public.reveal_history h WHERE h.couple_id = c.id
    AND h.reveal_year <= c.last_reveal_year
    AND h.reveal_year BETWEEN 1 AND 9999
    AND e.entry_date <= public.anniversary_in_year(c.anniversary_date, h.reveal_year)
), c.last_reveal_year) FROM public.entries e
JOIN public.couples c ON c.id = e.couple_id
WHERE NOT e.is_draft AND e.entry_date <= public.anniversary_in_year(c.anniversary_date, c.last_reveal_year);

CREATE FUNCTION public.capture_annual_entries() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- This trigger is reached only after the protected trusted transition.
  IF NEW.last_reveal_year IS DISTINCT FROM OLD.last_reveal_year THEN
    IF NEW.last_reveal_year IS NULL OR NEW.last_reveal_year < OLD.last_reveal_year THEN
      DELETE FROM public.annual_reveal_entries WHERE couple_id = NEW.id
        AND (NEW.last_reveal_year IS NULL OR reveal_year > NEW.last_reveal_year);
    END IF;
    IF NEW.last_reveal_year IS NOT NULL THEN
      INSERT INTO public.annual_reveal_entries(couple_id, entry_id, reveal_year)
      SELECT NEW.id, e.id, NEW.last_reveal_year FROM public.entries e
      WHERE e.couple_id = NEW.id AND NOT e.is_draft
        AND e.entry_date <= public.anniversary_in_year(NEW.anniversary_date, NEW.last_reveal_year)
      ON CONFLICT (entry_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.capture_annual_entries() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER capture_annual_entries AFTER UPDATE OF last_reveal_year ON public.couples
FOR EACH ROW EXECUTE FUNCTION public.capture_annual_entries();

CREATE OR REPLACE FUNCTION public.protect_couple_columns() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.partner_2_id IS NOT NULL OR NEW.last_reveal_year IS NOT NULL OR NEW.is_revealed THEN
        RAISE EXCEPTION 'Pairing and reveal fields cannot be supplied on creation' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.is_revealed IS DISTINCT FROM OLD.is_revealed
        OR NEW.last_reveal_year IS DISTINCT FROM OLD.last_reveal_year
        OR NEW.partner_1_id IS DISTINCT FROM OLD.partner_1_id
        OR NEW.partner_2_id IS DISTINCT FROM OLD.partner_2_id
        OR NEW.invite_code IS DISTINCT FROM OLD.invite_code THEN
        RAISE EXCEPTION 'Reveal state and pairing columns cannot be modified directly' USING ERRCODE = '42501';
      END IF;
      -- Temporary scheduling guard until future-cycle rescheduling has its own API.
      IF OLD.last_reveal_year IS NOT NULL AND NEW.anniversary_date IS DISTINCT FROM OLD.anniversary_date THEN
        RAISE EXCEPTION 'The anniversary cannot be changed after opening a capsule yet' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER protect_couple_columns_trigger ON public.couples;
CREATE TRIGGER protect_couple_columns_trigger BEFORE INSERT OR UPDATE ON public.couples
FOR EACH ROW EXECUTE FUNCTION public.protect_couple_columns();

-- Lock the user rows shared by both partner positions. Separate unique indexes
-- on partner_1/partner_2 would miss cross-column and concurrent memberships.
DO $$ BEGIN
  IF EXISTS (SELECT user_id FROM (
    SELECT partner_1_id user_id FROM public.couples UNION ALL
    SELECT partner_2_id FROM public.couples WHERE partner_2_id IS NOT NULL
  ) memberships GROUP BY user_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Resolve existing multiple couple memberships before applying migration 012';
  END IF;
END $$;
CREATE FUNCTION public.enforce_single_couple() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Trigger-only function: authorization is enforced by the caller's RLS/RPC.
  PERFORM id FROM public.profiles WHERE id IN (NEW.partner_1_id, NEW.partner_2_id)
    ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.couples c WHERE c.id <> NEW.id AND (
    c.partner_1_id IN (NEW.partner_1_id, NEW.partner_2_id) OR
    c.partner_2_id IN (NEW.partner_1_id, NEW.partner_2_id))) THEN
    RAISE EXCEPTION 'A person can only belong to one couple' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_single_couple() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_single_couple BEFORE INSERT OR UPDATE OF partner_1_id, partner_2_id
ON public.couples FOR EACH ROW EXECUTE FUNCTION public.enforce_single_couple();

CREATE OR REPLACE FUNCTION public.join_couple_by_code(p_invite_code TEXT)
RETURNS public.couples LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user UUID := auth.uid(); v_target public.couples; v_old public.couples;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  -- Serialize a user's joins to different invite codes, before checking membership.
  PERFORM id FROM public.profiles WHERE id = v_user FOR UPDATE;
  SELECT * INTO v_target FROM public.couples WHERE lower(invite_code) = lower(btrim(p_invite_code))
    AND partner_2_id IS NULL AND partner_1_id <> v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invite code or couple already full'; END IF;
  SELECT * INTO v_old FROM public.couples WHERE v_user IN (partner_1_id, partner_2_id);
  IF FOUND THEN
    IF v_old.partner_2_id IS NOT NULL THEN RAISE EXCEPTION 'You are already paired'; END IF;
    IF EXISTS (SELECT 1 FROM public.entries WHERE couple_id = v_old.id) THEN
      RAISE EXCEPTION 'Your existing diary contains notes. Keep or export them before joining another couple.';
    END IF;
    DELETE FROM public.couples WHERE id = v_old.id;
  END IF;
  UPDATE public.couples SET partner_2_id = v_user, updated_at = now()
    WHERE id = v_target.id AND partner_2_id IS NULL RETURNING * INTO v_target;
  IF NOT FOUND THEN RAISE EXCEPTION 'Couple already full'; END IF;
  RETURN v_target;
END;
$$;

CREATE FUNCTION public.checkpoint_due(p_config public.checkpoint_configs, p_day DATE)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_config.is_active AND CASE p_config.frequency
    WHEN 'specific_date' THEN p_config.specific_date = p_day
    WHEN 'monthly' THEN p_config.day_of_month = EXTRACT(DAY FROM p_day)
    WHEN 'quarterly' THEN p_config.day_of_month = EXTRACT(DAY FROM p_day)
      AND EXTRACT(MONTH FROM p_day)::int = ANY(p_config.months)
    WHEN 'semi_annual' THEN p_config.day_of_month = EXTRACT(DAY FROM p_day)
      AND EXTRACT(MONTH FROM p_day)::int = ANY(p_config.months)
    ELSE false END
$$;
REVOKE EXECUTE ON FUNCTION public.checkpoint_due(public.checkpoint_configs, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkpoint_due(public.checkpoint_configs, date) TO authenticated, service_role;

-- A separate canonical daily ledger preserves old duplicate history without
-- deleting memories. New calls have one result, including an empty result.
CREATE TABLE public.checkpoint_days (
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  checkpoint_date DATE NOT NULL,
  entry_id UUID REFERENCES public.entries(id) ON DELETE SET NULL,
  PRIMARY KEY (couple_id, recipient_id, checkpoint_date)
);
ALTER TABLE public.checkpoint_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.checkpoint_days FROM anon, authenticated;
INSERT INTO public.checkpoint_days
SELECT DISTINCT ON (cr.couple_id, cr.revealed_to_user_id, cr.checkpoint_date)
  cr.couple_id, cr.revealed_to_user_id, cr.checkpoint_date, cr.entry_id
FROM public.checkpoint_reveals cr JOIN public.entries e ON e.id = cr.entry_id
JOIN public.couples c ON c.id = cr.couple_id
WHERE e.couple_id = cr.couple_id AND cr.revealed_to_user_id IN (c.partner_1_id, c.partner_2_id)
  AND e.author_id IN (c.partner_1_id, c.partner_2_id) AND e.author_id <> cr.revealed_to_user_id
ORDER BY cr.couple_id, cr.revealed_to_user_id, cr.checkpoint_date, cr.revealed_at, cr.id;
DROP POLICY "Couple members can insert checkpoint reveals" ON public.checkpoint_reveals;
REVOKE INSERT, UPDATE, DELETE ON public.checkpoint_reveals FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_checkpoint_entry(p_couple_id UUID, p_config_id UUID DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid(); v_couple public.couples; v_partner UUID;
  v_day DATE := (now() AT TIME ZONE 'UTC')::date;
  v_config public.checkpoint_configs; v_entry public.entries;
  v_existing public.checkpoint_days; v_repeat BOOLEAN := false;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  SELECT * INTO v_couple FROM public.couples WHERE id = p_couple_id FOR UPDATE;
  v_partner := CASE WHEN v_couple.partner_1_id = v_user THEN v_couple.partner_2_id ELSE v_couple.partner_1_id END;
  IF v_partner IS NULL THEN RAISE EXCEPTION 'Pair with a partner first'; END IF;
  SELECT * INTO v_existing FROM public.checkpoint_days WHERE couple_id = p_couple_id
    AND recipient_id = v_user AND checkpoint_date = v_day;
  IF FOUND THEN
    v_repeat := true;
    SELECT * INTO v_entry FROM public.entries WHERE id = v_existing.entry_id AND NOT is_draft
      AND couple_id = p_couple_id AND author_id = v_partner;
  ELSE
    IF p_config_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.checkpoint_configs
      WHERE id = p_config_id AND couple_id = p_couple_id) THEN
      RAISE EXCEPTION 'Invalid checkpoint';
    END IF;
    SELECT * INTO v_config FROM public.checkpoint_configs cc
      WHERE cc.couple_id = p_couple_id AND (p_config_id IS NULL OR cc.id = p_config_id)
        AND public.checkpoint_due(cc, v_day)
      ORDER BY cc.created_at, cc.id LIMIT 1 FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No checkpoint is due today'; END IF;
    SELECT * INTO v_entry FROM public.entries e WHERE e.couple_id = p_couple_id
      AND e.author_id = v_partner AND NOT e.is_draft
      AND NOT EXISTS (SELECT 1 FROM public.checkpoint_reveals cr WHERE cr.entry_id = e.id AND cr.revealed_to_user_id = v_user)
      AND NOT EXISTS (SELECT 1 FROM public.annual_reveal_entries ar WHERE ar.entry_id = e.id)
      ORDER BY random() LIMIT 1 FOR UPDATE;
    INSERT INTO public.checkpoint_days VALUES(p_couple_id, v_user, v_day, v_entry.id);
    IF v_entry.id IS NOT NULL THEN
      INSERT INTO public.checkpoint_reveals(couple_id, checkpoint_config_id, entry_id, revealed_to_user_id, checkpoint_date)
      VALUES(p_couple_id, v_config.id, v_entry.id, v_user, v_day);
    END IF;
  END IF;
  RETURN json_build_object('entry', CASE WHEN v_entry.id IS NULL THEN NULL ELSE row_to_json(v_entry) END,
    'already_revealed', v_repeat, 'no_entries', v_entry.id IS NULL);
END;
$$;

-- This predicate is shared by rows and private Storage. A forged historical
-- checkpoint cannot authorize an entry from another couple or another author.
CREATE FUNCTION public.can_read_partner_entry(p_entry_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.entries e JOIN public.couples c ON c.id = e.couple_id
    WHERE e.id = p_entry_id AND NOT e.is_draft AND auth.uid() IN (c.partner_1_id, c.partner_2_id)
      AND e.author_id IN (c.partner_1_id, c.partner_2_id) AND e.author_id <> auth.uid()
      AND (EXISTS (SELECT 1 FROM public.annual_reveal_entries ar WHERE ar.entry_id = e.id AND ar.couple_id = c.id)
        OR EXISTS (SELECT 1 FROM public.checkpoint_reveals cr WHERE cr.entry_id = e.id
          AND cr.couple_id = c.id AND cr.revealed_to_user_id = auth.uid())))
$$;
REVOKE EXECUTE ON FUNCTION public.can_read_partner_entry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_partner_entry(uuid) TO authenticated, service_role;
DROP POLICY "Partner entries visible after reveal" ON public.entries;
DROP POLICY "Partner entries visible via checkpoint" ON public.entries;
CREATE POLICY "Partner entries require an entitlement" ON public.entries FOR SELECT TO authenticated
  USING (public.can_read_partner_entry(id));
ALTER POLICY "Partner media visible after reveal" ON public.media
  USING (public.can_read_partner_entry(entry_id));
ALTER POLICY "Partners can view revealed entry media" ON storage.objects USING (
  bucket_id = 'entry-media' AND EXISTS (SELECT 1 FROM public.media m
    WHERE m.storage_path = storage.objects.name AND public.can_read_partner_entry(m.entry_id))
);
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
  IF NOT EXISTS (
    SELECT 1 FROM public.couples WHERE id = p_couple_id
      AND last_reveal_year IS NOT NULL
      AND (p_year IS NULL OR p_year = last_reveal_year OR (
        p_year <= last_reveal_year AND (
          EXISTS (SELECT 1 FROM public.annual_reveal_entries ar WHERE ar.couple_id = p_couple_id AND ar.reveal_year = p_year)
          OR EXISTS (SELECT 1 FROM public.reveal_history h WHERE h.couple_id = p_couple_id AND h.reveal_year = p_year)
        )
      ))
  ) THEN
    RAISE EXCEPTION 'This capsule has not been opened' USING ERRCODE = '42501';
  END IF;

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
      SELECT COUNT(*) FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft

    ),
    'partner_2_entries', (
      SELECT COUNT(*) FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft

    ),
    'partner_1_words', (
      SELECT COALESCE(SUM(word_count), 0) FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft

    ),
    'partner_2_words', (
      SELECT COALESCE(SUM(word_count), 0) FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft

    ),
    'partner_1_avg_hour', (
      SELECT COALESCE(AVG(EXTRACT(HOUR FROM created_at)), 12) FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft

    ),
    'partner_2_avg_hour', (
      SELECT COALESCE(AVG(EXTRACT(HOUR FROM created_at)), 12) FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft

    ),
    'most_active_month', (
      SELECT to_char(entry_date, 'Month')
      FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries WHERE couple_id = p_couple_id AND NOT is_draft

      GROUP BY to_char(entry_date, 'Month')
      ORDER BY COUNT(*) DESC LIMIT 1
    ),
    'most_active_month_count', (
      SELECT COUNT(*)
      FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries WHERE couple_id = p_couple_id AND NOT is_draft

      GROUP BY to_char(entry_date, 'Month')
      ORDER BY COUNT(*) DESC LIMIT 1
    ),
    'longest_entry_words', (
      SELECT COALESCE(MAX(word_count), 0) FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND NOT is_draft

    ),
    'longest_entry_author_id', (
      SELECT author_id FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND NOT is_draft

      ORDER BY word_count DESC LIMIT 1
    ),
    'longest_entry_date', (
      SELECT entry_date FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND NOT is_draft

      ORDER BY word_count DESC LIMIT 1
    ),
    'partner_1_longest_streak', (
      SELECT COALESCE(MAX(streak_len), 0) FROM (
        SELECT COUNT(*) as streak_len
        FROM (
          SELECT entry_date,
                 entry_date - (ROW_NUMBER() OVER (ORDER BY entry_date))::int AS grp
          FROM (
            SELECT DISTINCT entry_date FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
            WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft

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
            SELECT DISTINCT entry_date FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
            WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft

          ) sub
        ) grouped
        GROUP BY grp
      ) streaks
    ),
    'total_media_images', (
      SELECT COUNT(*) FROM media m JOIN (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) e ON m.entry_id = e.id
      WHERE e.couple_id = p_couple_id AND NOT e.is_draft AND m.media_type = 'image'

    ),
    'total_media_videos', (
      SELECT COUNT(*) FROM media m JOIN (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) e ON m.entry_id = e.id
      WHERE e.couple_id = p_couple_id AND NOT e.is_draft AND m.media_type = 'video'

    ),
    'partner_1_top_mood', (
      SELECT mood FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft AND mood IS NOT NULL

      GROUP BY mood ORDER BY COUNT(*) DESC LIMIT 1
    ),
    'partner_2_top_mood', (
      SELECT mood FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft AND mood IS NOT NULL

      GROUP BY mood ORDER BY COUNT(*) DESC LIMIT 1
    ),
    'first_entry_date', (
      SELECT MIN(entry_date) FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND NOT is_draft

    ),
    'last_entry_date', (
      SELECT MAX(entry_date) FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND NOT is_draft

    ),
    'partner_1_favorite_dow', (
      SELECT to_char(entry_date, 'Day') FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft

      GROUP BY to_char(entry_date, 'Day') ORDER BY COUNT(*) DESC LIMIT 1
    ),
    'partner_2_favorite_dow', (
      SELECT to_char(entry_date, 'Day') FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft

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
      FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND NOT is_draft AND location_lat IS NOT NULL

    ),
    'unique_location_count', (
      SELECT COUNT(DISTINCT (location_lat, location_lng))
      FROM (SELECT entry.* FROM public.entries entry JOIN public.annual_reveal_entries entitlement ON entitlement.entry_id = entry.id WHERE entitlement.couple_id = p_couple_id AND (p_year IS NULL OR entitlement.reveal_year = p_year)) entries
      WHERE couple_id = p_couple_id AND NOT is_draft AND location_lat IS NOT NULL

    )
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


DROP POLICY "System can insert reveal history" ON public.reveal_history;
REVOKE INSERT, UPDATE, DELETE ON public.reveal_history FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.save_reveal_snapshot(p_couple_id UUID, p_year INT, p_stats JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stats JSONB;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  -- Kept compatible with old clients, but never trust their JSON or timestamps.
  v_stats := public.get_reveal_stats(p_couple_id, p_year)::jsonb;
  INSERT INTO public.reveal_history(couple_id, reveal_year, stats_snapshot)
    VALUES(p_couple_id, p_year, v_stats) ON CONFLICT (couple_id, reveal_year) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION get_checkpoint_history(p_couple_id UUID)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  RETURN (
    SELECT COALESCE(json_agg(json_build_object(
      'id', cr.id,
      'checkpoint_date', cr.checkpoint_date,
      'revealed_at', cr.revealed_at,
      'config_label', cc.label,
      'entry', json_build_object(
        'id', e.id,
        'title', e.title,
        'content_plain', e.content_plain,
        'word_count', e.word_count,
        'mood', e.mood,
        'entry_date', e.entry_date,
        'location_name', e.location_name
      )
    ) ORDER BY cr.checkpoint_date DESC), '[]'::json)
    FROM public.checkpoint_reveals cr
    JOIN public.entries e ON e.id = cr.entry_id
    LEFT JOIN public.checkpoint_configs cc ON cc.id = cr.checkpoint_config_id
    WHERE cr.couple_id = p_couple_id
      AND cr.revealed_to_user_id = v_user_id
      AND e.couple_id = p_couple_id AND e.author_id <> v_user_id AND NOT e.is_draft
      AND EXISTS (SELECT 1 FROM public.couples c WHERE c.id = p_couple_id AND e.author_id IN (c.partner_1_id, c.partner_2_id))
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


CREATE OR REPLACE FUNCTION public.check_checkpoint_today(p_couple_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSON;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  SELECT json_build_object('is_checkpoint_day', count(*) > 0,
    'checkpoints', COALESCE(json_agg(row_to_json(cc) ORDER BY cc.created_at, cc.id), '[]'::json))
    INTO v_result FROM public.checkpoint_configs cc
    WHERE cc.couple_id = p_couple_id AND public.checkpoint_due(cc, (now() AT TIME ZONE 'UTC')::date);
  RETURN v_result;
END;
$$;
GRANT SELECT ON public.annual_reveal_entries TO authenticated;
GRANT ALL ON public.annual_reveal_entries, public.checkpoint_days TO service_role;
