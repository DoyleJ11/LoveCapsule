-- Recurring checkpoints support every day of the month. Short months clamp
-- to their final day; existing 1-28 schedules and saved occurrences are unchanged.
ALTER TABLE public.checkpoint_configs DROP CONSTRAINT checkpoint_configs_day_of_month_check;
ALTER TABLE public.checkpoint_configs ADD CONSTRAINT checkpoint_configs_day_of_month_check
  CHECK (day_of_month BETWEEN 1 AND 31);

CREATE OR REPLACE FUNCTION public.write_checkpoint_schedule(p_couple_id uuid, p_id uuid, p_expected_version int, p_config jsonb)
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
    IF day IS NULL OR day NOT BETWEEN 1 AND 31 THEN RAISE EXCEPTION 'Choose a day from 1 to 31'; END IF;
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

CREATE OR REPLACE FUNCTION public.materialize_reveal_occurrences(p_couple_id uuid) RETURNS void
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
      FOR d IN SELECT month_start::date + (least(c.day_of_month,
          extract(day FROM month_start + interval '1 month - 1 day')::int) - 1)
        FROM generate_series(date_trunc('month', c.starts_on::timestamp), end_day, interval '1 month') AS months(month_start) LOOP
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

-- Replaced functions retain their signatures and restricted execution boundary.
REVOKE ALL ON FUNCTION public.write_checkpoint_schedule(uuid,uuid,int,jsonb),
  public.materialize_reveal_occurrences(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_checkpoint_schedule(uuid,uuid,int,jsonb),
  public.materialize_reveal_occurrences(uuid) TO service_role;
