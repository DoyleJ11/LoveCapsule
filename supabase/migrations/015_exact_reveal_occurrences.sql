-- Exact one-time instants; recurring local wall times with durable occurrence IDs.
-- Existing date-only rules deliberately keep UTC midnight until explicitly edited.
ALTER TABLE public.checkpoint_configs
  ADD COLUMN timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN reveal_time time NOT NULL DEFAULT '00:00',
  ADD COLUMN scheduled_at timestamptz,
  ADD COLUMN starts_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),
  ADD COLUMN version int NOT NULL DEFAULT 1,
  ADD COLUMN legacy_schedule boolean NOT NULL DEFAULT false,
  ADD COLUMN version_started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN schedule_error text;
UPDATE public.checkpoint_configs SET legacy_schedule = true;
-- Legacy constraints allowed incomplete rules. Keep them visible for repair,
-- but never broaden a malformed quarterly rule into a monthly reveal.
UPDATE public.checkpoint_configs SET is_active = false,
  schedule_error = 'Incomplete legacy schedule. Choose a date or recurring day and save again.'
WHERE (frequency = 'specific_date' AND specific_date IS NULL)
  OR (frequency <> 'specific_date' AND day_of_month IS NULL)
  OR (frequency IN ('quarterly','semi_annual') AND (months IS NULL OR cardinality(months) = 0
    OR NOT months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]));
UPDATE public.checkpoint_configs SET scheduled_at = specific_date::timestamp AT TIME ZONE 'UTC'
WHERE frequency = 'specific_date';
CREATE TABLE public.reveal_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples ON DELETE CASCADE,
  config_id uuid REFERENCES public.checkpoint_configs ON DELETE SET NULL,
  version int NOT NULL,
  due_at timestamptz NOT NULL,
  timezone text NOT NULL,
  label text,
  cancelled boolean NOT NULL DEFAULT false,
  UNIQUE(config_id, due_at)
);
CREATE TABLE public.occurrence_claims (
  occurrence_id uuid NOT NULL REFERENCES public.reveal_occurrences ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  entry_id uuid REFERENCES public.entries ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  legacy boolean NOT NULL DEFAULT false,
  PRIMARY KEY (occurrence_id, recipient_id)
);
ALTER TABLE public.checkpoint_reveals
  ADD COLUMN occurrence_id uuid REFERENCES public.reveal_occurrences ON DELETE SET NULL,
  ADD COLUMN label_snapshot text;
UPDATE public.checkpoint_reveals r SET label_snapshot = c.label
FROM public.checkpoint_configs c WHERE c.id = r.checkpoint_config_id AND c.couple_id = r.couple_id;
ALTER TABLE public.reveal_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.occurrence_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reveal_occurrences, public.occurrence_claims FROM anon, authenticated;
GRANT ALL ON public.reveal_occurrences, public.occurrence_claims TO service_role;
-- All mutations validate membership/version and serialize with reveal operations.
REVOKE INSERT, UPDATE, DELETE ON public.checkpoint_configs FROM anon, authenticated;

CREATE FUNCTION public.save_checkpoint_schedule(p_couple_id uuid, p_id uuid, p_expected_version int, p_config jsonb)
RETURNS public.checkpoint_configs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.checkpoint_configs; zone text := p_config->>'timezone';
  local_time time := (p_config->>'reveal_time')::time; instant timestamptz;
  freq text := p_config->>'frequency'; day int := (p_config->>'day_of_month')::int;
  months_list int[]; d date := (p_config->>'specific_date')::date;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  PERFORM id FROM public.couples WHERE id = p_couple_id FOR UPDATE;
  IF local_time IS NULL OR zone IS NULL OR freq NOT IN ('specific_date','monthly','quarterly','semi_annual') THEN
    RAISE EXCEPTION 'Choose a frequency, time and timezone'; END IF;
  PERFORM public.resolve_reveal_time((now() AT TIME ZONE zone)::date + local_time, zone, false);
  IF freq = 'specific_date' THEN
    IF d IS NULL THEN RAISE EXCEPTION 'Choose a date'; END IF;
    instant := public.resolve_reveal_time(d + local_time, zone, true);
  ELSE
    IF day IS NULL OR day NOT BETWEEN 1 AND 28 THEN RAISE EXCEPTION 'Choose a day from 1 to 28'; END IF;
    d := NULL;
    months_list := CASE freq WHEN 'quarterly' THEN ARRAY[3,6,9,12] WHEN 'semi_annual' THEN ARRAY[6,12] END;
  END IF;
  IF p_id IS NOT NULL THEN
    SELECT * INTO c FROM public.checkpoint_configs WHERE id = p_id AND couple_id = p_couple_id FOR UPDATE;
    IF FOUND AND p_expected_version IS NULL THEN
      -- Stable client ID makes a lost create response safe to retry. Reusing
      -- that ID for different data is a conflict, never another occurrence.
      IF ROW(c.frequency,c.day_of_month,c.months,c.specific_date,c.label,c.is_active,c.timezone,c.reveal_time)
        IS NOT DISTINCT FROM ROW(freq,CASE WHEN freq <> 'specific_date' THEN day END,months_list,d,
          nullif(btrim(p_config->>'label'),''),COALESCE((p_config->>'is_active')::boolean,true),zone,local_time)
        THEN RETURN c; END IF;
      RAISE EXCEPTION 'This schedule was already saved. Reload before changing it.' USING ERRCODE = '40001';
    END IF;
    IF c.id IS NULL AND p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'Schedule not found'; END IF;
  END IF;
  IF c.id IS NOT NULL THEN
    IF c.version IS DISTINCT FROM p_expected_version THEN
      RAISE EXCEPTION 'Schedule changed on another device. Reload and try again.' USING ERRCODE = '40001'; END IF;
    IF c.frequency = 'specific_date' AND freq = 'specific_date' AND c.scheduled_at <= now()
      AND instant IS DISTINCT FROM c.scheduled_at AND instant <= now() THEN
      RAISE EXCEPTION 'A due one-time reveal stays saved. Choose a future time for a new occurrence.';
    END IF;
    -- Materialized due occurrences remain claimable with their original identity;
    -- only future occurrences are cancelled by editing or deleting a schedule.
    UPDATE public.reveal_occurrences SET cancelled = true WHERE config_id = p_id AND due_at > now();
    UPDATE public.checkpoint_configs SET frequency = freq, day_of_month = CASE WHEN freq <> 'specific_date' THEN day END,
      months = months_list, specific_date = d, label = nullif(btrim(p_config->>'label'), ''),
      is_active = COALESCE((p_config->>'is_active')::boolean, true), timezone = zone, reveal_time = local_time,
      scheduled_at = instant, schedule_error = NULL, legacy_schedule = false, version_started_at = now(), starts_on = (now() AT TIME ZONE zone)::date, version = version + 1
      WHERE id = p_id RETURNING * INTO c;
  ELSE
    INSERT INTO public.checkpoint_configs(id, couple_id, frequency, day_of_month, months, specific_date, label,
      is_active, timezone, reveal_time, scheduled_at, starts_on)
    VALUES(COALESCE(p_id,gen_random_uuid()), p_couple_id, freq, CASE WHEN freq <> 'specific_date' THEN day END, months_list, d,
      nullif(btrim(p_config->>'label'), ''), COALESCE((p_config->>'is_active')::boolean, true), zone, local_time,
      instant, (now() AT TIME ZONE zone)::date) RETURNING * INTO c;
  END IF;
  RETURN c;
END $$;

-- Populate lazily, so unlock works without a cron job or push notification.
-- At most one future occurrence per rule; missed occurrences do not expire.
CREATE FUNCTION public.materialize_reveal_occurrences(p_couple_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.checkpoint_configs; d date; due timestamptz; end_day date;
BEGIN
  FOR c IN SELECT * FROM public.checkpoint_configs WHERE couple_id = p_couple_id AND is_active LOOP
    IF c.frequency = 'specific_date' THEN
      due := COALESCE(c.scheduled_at, public.resolve_reveal_time(c.specific_date + c.reveal_time, c.timezone));
      IF due IS NOT NULL THEN
        INSERT INTO public.reveal_occurrences(couple_id, config_id, version, due_at, timezone, label)
        VALUES(c.couple_id,c.id,c.version,due,c.timezone,c.label) ON CONFLICT (config_id,due_at) DO UPDATE SET version = EXCLUDED.version,
          timezone = EXCLUDED.timezone, label = EXCLUDED.label, cancelled = false
          WHERE reveal_occurrences.due_at > now();
      END IF;
    ELSE
      IF c.day_of_month IS NULL OR (c.frequency <> 'monthly' AND (c.months IS NULL OR cardinality(c.months) = 0)) THEN CONTINUE; END IF;
      end_day := ((now() AT TIME ZONE c.timezone)::date + interval '1 year')::date;
      FOR d IN SELECT generate_series(date_trunc('month', c.starts_on::timestamp), end_day, interval '1 month')::date
        + (c.day_of_month - 1) LOOP
        IF d < c.starts_on OR (c.months IS NOT NULL AND extract(month FROM d)::int <> ALL(c.months)) THEN CONTINUE; END IF;
        due := public.resolve_reveal_time(d + c.reveal_time, c.timezone, false);
        IF NOT c.legacy_schedule AND due < c.version_started_at THEN CONTINUE; END IF;
        INSERT INTO public.reveal_occurrences(couple_id, config_id, version, due_at, timezone, label)
        VALUES(c.couple_id,c.id,c.version,due,c.timezone,c.label) ON CONFLICT (config_id,due_at) DO UPDATE SET version = EXCLUDED.version,
          timezone = EXCLUDED.timezone, label = EXCLUDED.label, cancelled = false
          WHERE reveal_occurrences.due_at > now();
        IF due > now() THEN EXIT; END IF;
      END LOOP;
    END IF;
  END LOOP;
  -- Bridge the Batch 1 daily receipts, including empty outcomes, so an upgrade
  -- cannot hand out another note for a checkpoint already opened that day.
  INSERT INTO public.occurrence_claims(occurrence_id,recipient_id,entry_id,legacy)
  SELECT o.id,receipt.recipient_id,receipt.entry_id,true FROM public.reveal_occurrences o
    JOIN public.checkpoint_configs cfg ON cfg.id = o.config_id AND cfg.legacy_schedule AND cfg.version = o.version
    JOIN public.checkpoint_days receipt ON receipt.couple_id = o.couple_id
      AND receipt.checkpoint_date = (o.due_at AT TIME ZONE 'UTC')::date
    WHERE o.couple_id = p_couple_id ON CONFLICT DO NOTHING;
END $$;
-- Editing must first materialize old due rules, even if neither device visited.
-- Wrapper keeps internal implementation inaccessible to clients.
ALTER FUNCTION public.save_checkpoint_schedule(uuid,uuid,int,jsonb) RENAME TO write_checkpoint_schedule;
CREATE FUNCTION public.save_checkpoint_schedule(p_couple_id uuid, p_id uuid, p_expected_version int, p_config jsonb)
RETURNS public.checkpoint_configs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  PERFORM id FROM public.couples WHERE id = p_couple_id FOR UPDATE;
  PERFORM public.materialize_reveal_occurrences(p_couple_id);
  RETURN public.write_checkpoint_schedule(p_couple_id,p_id,p_expected_version,p_config);
END $$;
CREATE FUNCTION public.delete_checkpoint_schedule(p_couple_id uuid, p_id uuid, p_expected_version int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  PERFORM id FROM public.couples WHERE id = p_couple_id FOR UPDATE;
  PERFORM public.materialize_reveal_occurrences(p_couple_id);
  IF NOT EXISTS (SELECT 1 FROM public.checkpoint_configs WHERE id = p_id AND couple_id = p_couple_id AND version = p_expected_version) THEN
    RAISE EXCEPTION 'Schedule changed on another device. Reload and try again.' USING ERRCODE = '40001'; END IF;
  UPDATE public.reveal_occurrences SET cancelled = true WHERE config_id = p_id AND due_at > now();
  DELETE FROM public.checkpoint_configs WHERE id = p_id AND couple_id = p_couple_id;
END $$;

CREATE FUNCTION public.claim_reveal_occurrence(p_couple_id uuid, p_occurrence_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.couples; o public.reveal_occurrences; claim public.occurrence_claims;
  e public.entries; partner uuid; repeated boolean := false;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  SELECT * INTO c FROM public.couples WHERE id = p_couple_id FOR UPDATE;
  partner := CASE WHEN c.partner_1_id = auth.uid() THEN c.partner_2_id ELSE c.partner_1_id END;
  IF partner IS NULL THEN RAISE EXCEPTION 'Pair with a partner first'; END IF;
  SELECT * INTO o FROM public.reveal_occurrences WHERE id = p_occurrence_id AND couple_id = c.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reveal not found'; END IF;
  SELECT * INTO claim FROM public.occurrence_claims WHERE occurrence_id = o.id AND recipient_id = auth.uid();
  IF FOUND THEN repeated := true;
  ELSE
    IF o.cancelled OR o.due_at > now() THEN RAISE EXCEPTION 'This reveal is not ready or was rescheduled'; END IF;
    SELECT * INTO e FROM public.entries WHERE couple_id = c.id AND author_id = partner AND NOT is_draft
      AND published_at <= o.due_at
      AND NOT EXISTS (SELECT 1 FROM public.annual_reveal_entries a WHERE a.entry_id = entries.id)
      AND NOT EXISTS (SELECT 1 FROM public.checkpoint_reveals r WHERE r.entry_id = entries.id AND r.revealed_to_user_id = auth.uid())
      ORDER BY random() LIMIT 1 FOR UPDATE;
    INSERT INTO public.occurrence_claims(occurrence_id,recipient_id,entry_id) VALUES(o.id,auth.uid(),e.id) RETURNING * INTO claim;
    IF e.id IS NOT NULL THEN
      INSERT INTO public.checkpoint_reveals(couple_id,checkpoint_config_id,entry_id,revealed_to_user_id,checkpoint_date,occurrence_id)
      VALUES(c.id,o.config_id,e.id,auth.uid(),(o.due_at AT TIME ZONE o.timezone)::date,o.id);
    END IF;
  END IF;
  SELECT * INTO e FROM public.entries WHERE id = claim.entry_id AND couple_id = c.id AND author_id = partner AND NOT is_draft;
  RETURN jsonb_build_object('occurrence_id',o.id,'opened_at',claim.opened_at,'due_at',o.due_at,'timezone',o.timezone,
    'entry',CASE WHEN e.id IS NULL THEN NULL ELSE to_jsonb(e) END,'already_revealed',repeated,'no_entries',e.id IS NULL);
END $$;

CREATE FUNCTION public.get_reveal_overview(p_couple_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.couples; y int; due timestamptz; result jsonb;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  SELECT * INTO c FROM public.couples WHERE id = p_couple_id FOR UPDATE;
  PERFORM public.materialize_reveal_occurrences(c.id);
  y := public.next_annual_year(c); due := public.annual_ready_at(c,y);
  SELECT jsonb_build_object('server_now',clock_timestamp(),'couple_id',c.id,'schedule_version',c.schedule_version,
    'annual',CASE WHEN y IS NULL THEN NULL ELSE jsonb_build_object('year',y,'ready_at',due,'is_ready',due <= clock_timestamp(),'timezone',c.reveal_timezone) END,
    'annual_history',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',h.id,'year',h.reveal_year,'opened_at',h.revealed_at,
      'ready_at',h.ready_at,'timezone',h.timezone,'legacy',h.legacy) ORDER BY h.reveal_year DESC)
      FROM public.reveal_history h WHERE h.couple_id = c.id AND h.reveal_year <= c.last_reveal_year),'[]'::jsonb),
    'checkpoints',COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.due_at,o.id) FROM public.reveal_occurrences o
      WHERE o.couple_id = c.id AND NOT o.cancelled AND NOT EXISTS (SELECT 1 FROM public.occurrence_claims cl
        WHERE cl.occurrence_id = o.id AND cl.recipient_id = auth.uid())),'[]'::jsonb),
    'checkpoint_history',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'occurrence_id',o.id,'label',o.label,
      'due_at',o.due_at,'timezone',o.timezone,'opened_at',cl.opened_at,'entry_id',cl.entry_id) ORDER BY cl.opened_at DESC)
      FROM public.occurrence_claims cl JOIN public.reveal_occurrences o ON o.id = cl.occurrence_id
      WHERE o.couple_id = c.id AND cl.recipient_id = auth.uid() AND NOT cl.legacy),'[]'::jsonb)
      || COALESCE((SELECT jsonb_agg(jsonb_build_object('id',cr.id,'occurrence_id',NULL,'label',COALESCE(cr.label_snapshot,'Legacy checkpoint'),
        'due_at',cr.checkpoint_date::timestamp AT TIME ZONE 'UTC','timezone','UTC','opened_at',cr.revealed_at,'entry_id',e.id)
        ORDER BY cr.revealed_at DESC) FROM public.checkpoint_reveals cr JOIN public.entries e ON e.id = cr.entry_id
        WHERE cr.couple_id = c.id AND cr.revealed_to_user_id = auth.uid() AND cr.occurrence_id IS NULL
          AND e.couple_id = c.id AND e.author_id IN(c.partner_1_id,c.partner_2_id) AND e.author_id <> auth.uid() AND NOT e.is_draft),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

-- Old clients retain the short-term one-per-UTC-day API. It delegates to exact
-- occurrences and cannot use off-day/null/foreign IDs to bypass validation.
CREATE OR REPLACE FUNCTION public.get_checkpoint_entry(p_couple_id uuid,p_config_id uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.couples; day date := (now() AT TIME ZONE 'UTC')::date; saved public.checkpoint_days;
  e public.entries; occurrence uuid; result jsonb;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  SELECT * INTO c FROM public.couples WHERE id = p_couple_id FOR UPDATE;
  SELECT * INTO saved FROM public.checkpoint_days WHERE couple_id = c.id AND recipient_id = auth.uid() AND checkpoint_date = day;
  IF FOUND THEN
    SELECT * INTO e FROM public.entries WHERE id = saved.entry_id AND couple_id = c.id AND NOT is_draft
      AND author_id <> auth.uid() AND author_id IN(c.partner_1_id,c.partner_2_id);
    RETURN json_build_object('entry',CASE WHEN e.id IS NULL THEN NULL ELSE row_to_json(e) END,'already_revealed',true,'no_entries',e.id IS NULL);
  END IF;
  IF p_config_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.checkpoint_configs WHERE id = p_config_id AND couple_id = c.id AND is_active) THEN
    RAISE EXCEPTION 'Invalid checkpoint'; END IF;
  PERFORM public.materialize_reveal_occurrences(c.id);
  SELECT id INTO occurrence FROM public.reveal_occurrences o WHERE couple_id = c.id AND NOT cancelled AND due_at <= now()
    AND (p_config_id IS NULL OR config_id = p_config_id) ORDER BY due_at,id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No checkpoint is due'; END IF;
  result := public.claim_reveal_occurrence(c.id,occurrence);
  INSERT INTO public.checkpoint_days VALUES(c.id,auth.uid(),day,(result->'entry'->>'id')::uuid);
  RETURN result::json;
END $$;
CREATE OR REPLACE FUNCTION public.check_checkpoint_today(p_couple_id uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE overview jsonb;
BEGIN
  overview := public.get_reveal_overview(p_couple_id);
  RETURN json_build_object('is_checkpoint_day',EXISTS(SELECT 1 FROM jsonb_array_elements(overview->'checkpoints') o WHERE (o->>'due_at')::timestamptz <= now()),
    'checkpoints',COALESCE((SELECT jsonb_agg(o) FROM jsonb_array_elements(overview->'checkpoints') o WHERE (o->>'due_at')::timestamptz <= now()),'[]'::jsonb));
END $$;
CREATE OR REPLACE FUNCTION public.get_unrevealed_entry_count(p_couple_id uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  SELECT count(*) INTO n FROM public.entries e JOIN public.couples c ON c.id = e.couple_id
    WHERE c.id = p_couple_id AND NOT e.is_draft AND e.author_id <> auth.uid() AND e.author_id IN(c.partner_1_id,c.partner_2_id)
      AND NOT EXISTS(SELECT 1 FROM public.annual_reveal_entries a WHERE a.entry_id = e.id)
      AND NOT EXISTS(SELECT 1 FROM public.checkpoint_reveals r WHERE r.entry_id = e.id AND r.revealed_to_user_id = auth.uid());
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.save_checkpoint_schedule(uuid,uuid,int,jsonb),public.write_checkpoint_schedule(uuid,uuid,int,jsonb),
  public.delete_checkpoint_schedule(uuid,uuid,int),public.materialize_reveal_occurrences(uuid),
  public.claim_reveal_occurrence(uuid,uuid),public.get_reveal_overview(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_checkpoint_schedule(uuid,uuid,int,jsonb),public.delete_checkpoint_schedule(uuid,uuid,int),
  public.claim_reveal_occurrence(uuid,uuid),public.get_reveal_overview(uuid) TO authenticated,service_role;

-- Legacy history endpoint also scopes schedule labels to the actual couple.
CREATE OR REPLACE FUNCTION public.get_checkpoint_history(p_couple_id uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  RETURN (SELECT COALESCE(json_agg(json_build_object('id',r.id,'checkpoint_date',r.checkpoint_date,
    'revealed_at',r.revealed_at,'config_label',COALESCE(r.label_snapshot,o.label,cfg.label),'entry',row_to_json(e))
    ORDER BY r.revealed_at DESC,r.id),'[]'::json)
    FROM public.checkpoint_reveals r JOIN public.entries e ON e.id = r.entry_id
    JOIN public.couples c ON c.id = r.couple_id
    LEFT JOIN public.checkpoint_configs cfg ON cfg.id = r.checkpoint_config_id AND cfg.couple_id = r.couple_id
    LEFT JOIN public.reveal_occurrences o ON o.id = r.occurrence_id AND o.couple_id = r.couple_id
    WHERE r.couple_id = p_couple_id AND r.revealed_to_user_id = auth.uid()
      AND e.couple_id = c.id AND e.author_id IN(c.partner_1_id,c.partner_2_id)
      AND e.author_id <> auth.uid() AND NOT e.is_draft);
END $$;
