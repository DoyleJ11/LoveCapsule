-- Annual opening is one transaction: protected transition, frozen membership,
-- original opened_at and recap. History never re-runs a calendar-year query.
ALTER TABLE public.entries ADD COLUMN published_at timestamptz;
UPDATE public.entries SET published_at = created_at WHERE NOT is_draft;
COMMENT ON COLUMN public.entries.published_at IS
  'Server first-publication instant. Legacy non-drafts use created_at (best available evidence).';
CREATE FUNCTION public.stamp_publication() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.published_at := CASE WHEN NEW.is_draft THEN NULL ELSE clock_timestamp() END;
  ELSE NEW.published_at := COALESCE(OLD.published_at, CASE WHEN NOT NEW.is_draft THEN clock_timestamp() END);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stamp_publication() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER stamp_publication BEFORE INSERT OR UPDATE ON public.entries
FOR EACH ROW EXECUTE FUNCTION public.stamp_publication();

ALTER TABLE public.couples
  ADD COLUMN reveal_timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN reveal_time time NOT NULL DEFAULT '00:00',
  ADD COLUMN schedule_version int NOT NULL DEFAULT 1;
ALTER TABLE public.reveal_history
  ADD COLUMN ready_at timestamptz,
  ADD COLUMN timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN legacy boolean NOT NULL DEFAULT false;

-- PG timezone names, rather than offset strings: travel never changes a rule.
CREATE FUNCTION public.resolve_reveal_time(p_local timestamp, p_zone text, p_strict boolean DEFAULT true)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_guess timestamptz; v_result timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_zone) THEN
    RAISE EXCEPTION 'Choose a valid IANA timezone, for example America/Los_Angeles';
  END IF;
  v_guess := p_local AT TIME ZONE p_zone;
  -- Sample actual offsets on both sides of the date. Handles half-hour DST as
  -- well as hour changes without assuming the size of a transition.
  SELECT max(candidate) INTO v_result FROM (
    SELECT (p_local - ((sample AT TIME ZONE p_zone) - (sample AT TIME ZONE 'UTC')))
      AT TIME ZONE 'UTC' candidate
    FROM generate_series(v_guess - interval '2 days', v_guess + interval '2 days', interval '1 day') sample
  ) candidates WHERE candidate AT TIME ZONE p_zone = p_local;
  IF v_result IS NULL THEN
    IF p_strict THEN RAISE EXCEPTION 'This local time does not exist because the clocks change. Choose another time.'; END IF;
    RETURN v_guess; -- recurring gap: move forward by the clock change
  END IF;
  RETURN v_result; -- repeated time: always the later occurrence
END $$;
CREATE FUNCTION public.annual_ready_at(p_couple public.couples, p_year int)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT public.resolve_reveal_time(public.anniversary_in_year(p_couple.anniversary_date, p_year)
    + p_couple.reveal_time, p_couple.reveal_timezone, false)
$$;
CREATE FUNCTION public.next_annual_year(p_couple public.couples) RETURNS int
LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE y int := extract(year FROM clock_timestamp() AT TIME ZONE p_couple.reveal_timezone);
BEGIN
  IF p_couple.anniversary_date IS NULL THEN RETURN NULL; END IF;
  IF p_couple.last_reveal_year IS NOT NULL THEN RETURN greatest(p_couple.last_reveal_year + 1, extract(year FROM p_couple.anniversary_date)::int); END IF;
  -- First opening catches up to the latest anniversary, never before the
  -- relationship start year. Subsequent skipped years open in order.
  IF public.annual_ready_at(p_couple, y) > clock_timestamp() THEN y := y - 1; END IF;
  RETURN greatest(y, extract(year FROM p_couple.anniversary_date)::int);
END $$;

-- Validate legacy manifest authors defensively, including the stats used by
-- repair. Old injected entries must not gain an SD reader/stats bypass.
DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.get_reveal_stats(uuid,int)'::regprocedure),
    'WHERE entitlement.couple_id = p_couple_id AND',
    'WHERE entry.couple_id = p_couple_id AND entry.author_id IN (SELECT partner_1_id FROM public.couples WHERE id = p_couple_id UNION ALL SELECT partner_2_id FROM public.couples WHERE id = p_couple_id) AND entitlement.couple_id = p_couple_id AND');
END $$;

-- Repair missing history from the last committed opening. Preserve all old
-- snapshots/timestamps and entitlements, including legacy overexposure. Unknown
-- historical open times use couple.updated_at and are explicitly marked legacy.
DO $$ DECLARE c public.couples; y int; prior text := current_setting('request.jwt.claim.sub', true);
BEGIN
  FOR c IN SELECT * FROM public.couples WHERE last_reveal_year IS NOT NULL LOOP
    PERFORM set_config('request.jwt.claim.sub', c.partner_1_id::text, true);
    FOR y IN SELECT reveal_year FROM public.annual_reveal_entries WHERE couple_id = c.id
      UNION SELECT c.last_reveal_year LOOP
      INSERT INTO public.reveal_history(couple_id, reveal_year, revealed_at, stats_snapshot, ready_at, legacy)
      VALUES(c.id, y, c.updated_at, public.get_reveal_stats(c.id, y)::jsonb,
        public.annual_ready_at(c, y), true) ON CONFLICT (couple_id, reveal_year) DO NOTHING;
    END LOOP;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', COALESCE(prior, ''), true);
END $$;
UPDATE public.reveal_history h SET ready_at = public.annual_ready_at(c, h.reveal_year), legacy = true
FROM public.couples c WHERE c.id = h.couple_id AND h.ready_at IS NULL;

-- Keep calculation private; the public historical stats API reads the snapshot.
ALTER FUNCTION public.get_reveal_stats(uuid, int) RENAME TO calculate_reveal_stats;
REVOKE ALL ON FUNCTION public.calculate_reveal_stats(uuid, int) FROM PUBLIC, anon, authenticated;
-- Internal calculation can run from the legacy service-role transition trigger
-- (which has no end-user JWT). Every exposed wrapper asserts membership.
DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.calculate_reveal_stats(uuid,int)'::regprocedure),
    'PERFORM public.assert_couple_member(p_couple_id);', '');
END $$;
CREATE FUNCTION public.get_reveal_stats(p_couple_id uuid, p_year int DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result json;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  SELECT stats_snapshot::json INTO result FROM public.reveal_history
    WHERE couple_id = p_couple_id AND reveal_year = p_year
      AND reveal_year <= (SELECT last_reveal_year FROM public.couples WHERE id = p_couple_id);
  IF FOUND THEN RETURN result; END IF;
  RETURN public.calculate_reveal_stats(p_couple_id, p_year);
END $$;

CREATE OR REPLACE FUNCTION public.capture_annual_entries() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE boundary timestamptz;
BEGIN
  IF NEW.last_reveal_year IS NOT DISTINCT FROM OLD.last_reveal_year THEN RETURN NEW; END IF;
  IF NEW.last_reveal_year IS NULL OR NEW.last_reveal_year < OLD.last_reveal_year THEN
    -- Explicit admin test reset. Normal opening never reaches this branch.
    DELETE FROM public.reveal_history WHERE couple_id = NEW.id
      AND (NEW.last_reveal_year IS NULL OR reveal_year > NEW.last_reveal_year);
    DELETE FROM public.annual_reveal_entries WHERE couple_id = NEW.id
      AND (NEW.last_reveal_year IS NULL OR reveal_year > NEW.last_reveal_year);
    RETURN NEW;
  END IF;
  boundary := public.annual_ready_at(NEW, NEW.last_reveal_year);
  IF boundary IS NULL THEN RAISE EXCEPTION 'Set an anniversary first'; END IF;
  -- Also secures the old service-role Edge Function during rolling upgrades.
  IF boundary > now() AND NOT public.is_admin() THEN RAISE EXCEPTION 'Your capsule is not ready yet'; END IF;
  INSERT INTO public.annual_reveal_entries(couple_id, entry_id, reveal_year)
  SELECT NEW.id, id, NEW.last_reveal_year FROM public.entries
  WHERE couple_id = NEW.id AND author_id IN (NEW.partner_1_id,NEW.partner_2_id) AND NOT is_draft AND published_at <= boundary
  ON CONFLICT (entry_id) DO NOTHING;
  INSERT INTO public.reveal_history(couple_id, reveal_year, stats_snapshot, ready_at, timezone)
  VALUES(NEW.id, NEW.last_reveal_year, public.calculate_reveal_stats(NEW.id, NEW.last_reveal_year)::jsonb,
    boundary, NEW.reveal_timezone) ON CONFLICT (couple_id, reveal_year) DO NOTHING;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.protect_couple_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.partner_2_id IS NOT NULL OR NEW.last_reveal_year IS NOT NULL OR NEW.is_revealed
        OR NEW.schedule_version <> 1 OR NEW.reveal_timezone <> 'UTC' OR NEW.reveal_time <> '00:00' THEN
        RAISE EXCEPTION 'Pairing, reveal and schedule fields cannot be supplied on creation' USING ERRCODE = '42501';
      END IF;
    ELSIF ROW(NEW.id, NEW.is_revealed, NEW.last_reveal_year, NEW.partner_1_id, NEW.partner_2_id,
      NEW.invite_code, NEW.anniversary_date, NEW.reveal_timezone, NEW.reveal_time, NEW.schedule_version)
      IS DISTINCT FROM ROW(OLD.id, OLD.is_revealed, OLD.last_reveal_year, OLD.partner_1_id, OLD.partner_2_id,
      OLD.invite_code, OLD.anniversary_date, OLD.reveal_timezone, OLD.reveal_time, OLD.schedule_version) THEN
      RAISE EXCEPTION 'Use the trusted pairing, reveal or schedule operation' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION public.save_annual_schedule(p_couple_id uuid, p_expected_version int,
  p_date date, p_time time, p_timezone text) RETURNS public.couples
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.couples;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  SELECT * INTO c FROM public.couples WHERE id = p_couple_id FOR UPDATE;
  IF c.schedule_version <> p_expected_version THEN RAISE EXCEPTION 'Schedule changed on another device. Reload and try again.' USING ERRCODE = '40001'; END IF;
  IF p_date IS NULL OR p_time IS NULL THEN RAISE EXCEPTION 'Choose an anniversary date and time'; END IF;
  PERFORM public.resolve_reveal_time(p_date + p_time, p_timezone);
  UPDATE public.couples SET anniversary_date = p_date, reveal_time = p_time, reveal_timezone = p_timezone,
    schedule_version = schedule_version + 1, updated_at = now() WHERE id = c.id RETURNING * INTO c;
  RETURN c;
END $$;

CREATE FUNCTION public.read_annual_event(p_couple_id uuid, p_year int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h public.reveal_history;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  SELECT * INTO h FROM public.reveal_history WHERE couple_id = p_couple_id AND reveal_year = p_year
      AND reveal_year <= (SELECT last_reveal_year FROM public.couples WHERE id = p_couple_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'This capsule has not been opened'; END IF;
  RETURN to_jsonb(h) || jsonb_build_object('entries', COALESCE((
    SELECT jsonb_agg(to_jsonb(e) ORDER BY e.entry_date, e.created_at, e.id)
    FROM public.annual_reveal_entries a JOIN public.entries e ON e.id = a.entry_id
    WHERE a.couple_id = p_couple_id AND e.couple_id = p_couple_id AND a.reveal_year = p_year AND NOT e.is_draft
      AND e.author_id IN (SELECT partner_1_id FROM public.couples WHERE id=p_couple_id UNION ALL SELECT partner_2_id FROM public.couples WHERE id=p_couple_id)), '[]'::jsonb));
END $$;
CREATE FUNCTION public.open_annual_event(p_couple_id uuid, p_year int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.couples; y int;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  SELECT * INTO c FROM public.couples WHERE id = p_couple_id FOR UPDATE;
  IF c.partner_2_id IS NULL THEN RAISE EXCEPTION 'Pair with a partner first'; END IF;
  IF EXISTS (SELECT 1 FROM public.reveal_history WHERE couple_id = c.id AND reveal_year = p_year) THEN
    RETURN public.read_annual_event(c.id, p_year);
  END IF;
  y := public.next_annual_year(c);
  IF p_year IS DISTINCT FROM y OR public.annual_ready_at(c, y) > now() THEN
    RAISE EXCEPTION 'This capsule is not ready. Refresh the reveal screen.';
  END IF;
  UPDATE public.couples SET last_reveal_year = y, is_revealed = true, updated_at = now() WHERE id = c.id;
  RETURN public.read_annual_event(c.id, y);
END $$;
-- Legacy client snapshot writes can only confirm an already committed event.
CREATE OR REPLACE FUNCTION public.save_reveal_snapshot(p_couple_id uuid, p_year int, p_stats jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.read_annual_event(p_couple_id, p_year); END $$;

REVOKE ALL ON FUNCTION public.resolve_reveal_time(timestamp,text,boolean), public.annual_ready_at(public.couples,int),
  public.next_annual_year(public.couples), public.get_reveal_stats(uuid,int), public.save_annual_schedule(uuid,int,date,time,text),
  public.read_annual_event(uuid,int), public.open_annual_event(uuid,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_reveal_stats(uuid,int), public.save_annual_schedule(uuid,int,date,time,text),
  public.read_annual_event(uuid,int), public.open_annual_event(uuid,int) TO authenticated, service_role;
