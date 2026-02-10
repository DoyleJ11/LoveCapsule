-- ============================================
-- CHECKPOINT CONFIGS (shared couple settings for checkpoints)
-- ============================================
-- Checkpoints allow couples to get periodic "sneak peeks" of each other's
-- entries before their anniversary. On a checkpoint day, each partner sees
-- ONE random entry their partner wrote (that hasn't been revealed via checkpoint before).

CREATE TABLE public.checkpoint_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'semi_annual', 'specific_date')),
  day_of_month INT CHECK (day_of_month >= 1 AND day_of_month <= 28),
  months INT[],  -- For quarterly [3,6,9,12] or semi_annual [6,12]
  specific_date DATE,  -- For birthdays, etc.
  label TEXT,  -- "Jack's Birthday", "Monthly Peek"
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkpoint_configs_couple ON public.checkpoint_configs(couple_id);

ALTER TABLE public.checkpoint_configs ENABLE ROW LEVEL SECURITY;

-- Couple members can view their checkpoint configs
CREATE POLICY "Couple members can view checkpoint configs"
  ON public.checkpoint_configs FOR SELECT
  USING (
    couple_id IN (
      SELECT id FROM public.couples
      WHERE partner_1_id = auth.uid() OR partner_2_id = auth.uid()
    )
  );

-- Couple members can create checkpoint configs
CREATE POLICY "Couple members can create checkpoint configs"
  ON public.checkpoint_configs FOR INSERT
  WITH CHECK (
    couple_id IN (
      SELECT id FROM public.couples
      WHERE partner_1_id = auth.uid() OR partner_2_id = auth.uid()
    )
  );

-- Couple members can update checkpoint configs
CREATE POLICY "Couple members can update checkpoint configs"
  ON public.checkpoint_configs FOR UPDATE
  USING (
    couple_id IN (
      SELECT id FROM public.couples
      WHERE partner_1_id = auth.uid() OR partner_2_id = auth.uid()
    )
  );

-- Couple members can delete checkpoint configs
CREATE POLICY "Couple members can delete checkpoint configs"
  ON public.checkpoint_configs FOR DELETE
  USING (
    couple_id IN (
      SELECT id FROM public.couples
      WHERE partner_1_id = auth.uid() OR partner_2_id = auth.uid()
    )
  );

-- ============================================
-- CHECKPOINT REVEALS (tracks what's been shown to whom)
-- ============================================
CREATE TABLE public.checkpoint_reveals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  checkpoint_config_id UUID REFERENCES public.checkpoint_configs(id) ON DELETE SET NULL,
  entry_id UUID NOT NULL REFERENCES public.entries(id) ON DELETE CASCADE,
  revealed_to_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  checkpoint_date DATE NOT NULL,
  revealed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Prevent the same entry from being revealed twice to the same user
  CONSTRAINT unique_entry_per_user UNIQUE (entry_id, revealed_to_user_id)
);

CREATE INDEX idx_checkpoint_reveals_couple ON public.checkpoint_reveals(couple_id);
CREATE INDEX idx_checkpoint_reveals_user ON public.checkpoint_reveals(revealed_to_user_id);
CREATE INDEX idx_checkpoint_reveals_date ON public.checkpoint_reveals(couple_id, checkpoint_date);

ALTER TABLE public.checkpoint_reveals ENABLE ROW LEVEL SECURITY;

-- Couple members can view their checkpoint reveals
CREATE POLICY "Couple members can view checkpoint reveals"
  ON public.checkpoint_reveals FOR SELECT
  USING (
    couple_id IN (
      SELECT id FROM public.couples
      WHERE partner_1_id = auth.uid() OR partner_2_id = auth.uid()
    )
  );

-- Couple members can insert checkpoint reveals (via RPC function)
CREATE POLICY "Couple members can insert checkpoint reveals"
  ON public.checkpoint_reveals FOR INSERT
  WITH CHECK (
    couple_id IN (
      SELECT id FROM public.couples
      WHERE partner_1_id = auth.uid() OR partner_2_id = auth.uid()
    )
    AND revealed_to_user_id = auth.uid()
  );

-- ============================================
-- POLICY: Partner entries visible via checkpoint reveal
-- ============================================
-- Allow reading partner entries that have been revealed via checkpoint to the current user
CREATE POLICY "Partner entries visible via checkpoint"
  ON public.entries FOR SELECT
  USING (
    author_id != auth.uid()
    AND id IN (
      SELECT entry_id FROM public.checkpoint_reveals
      WHERE revealed_to_user_id = auth.uid()
    )
    AND is_draft = false
  );

-- ============================================
-- RPC: Check if today is a checkpoint day
-- ============================================
CREATE OR REPLACE FUNCTION check_checkpoint_today(p_couple_id UUID)
RETURNS JSON AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_day_of_month INT := EXTRACT(DAY FROM v_today);
  v_month INT := EXTRACT(MONTH FROM v_today);
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'is_checkpoint_day', EXISTS (
      SELECT 1 FROM public.checkpoint_configs
      WHERE couple_id = p_couple_id
        AND is_active = true
        AND (
          -- Monthly: check day of month
          (frequency = 'monthly' AND day_of_month = v_day_of_month)
          -- Quarterly: check day of month AND month is in months array
          OR (frequency = 'quarterly' AND day_of_month = v_day_of_month AND v_month = ANY(months))
          -- Semi-annual: check day of month AND month is in months array
          OR (frequency = 'semi_annual' AND day_of_month = v_day_of_month AND v_month = ANY(months))
          -- Specific date: exact match
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: Get checkpoint entry (reveal one random unrevealed partner entry)
-- ============================================
-- This function is idempotent for the same day - if already revealed today,
-- returns the same entry. Otherwise picks a random unrevealed entry.
CREATE OR REPLACE FUNCTION get_checkpoint_entry(p_couple_id UUID, p_config_id UUID DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_partner_id UUID;
  v_today DATE := CURRENT_DATE;
  v_existing_reveal RECORD;
  v_random_entry RECORD;
  v_result JSON;
BEGIN
  -- Get partner ID
  SELECT
    CASE
      WHEN partner_1_id = v_user_id THEN partner_2_id
      ELSE partner_1_id
    END INTO v_partner_id
  FROM public.couples
  WHERE id = p_couple_id
    AND (partner_1_id = v_user_id OR partner_2_id = v_user_id);

  IF v_partner_id IS NULL THEN
    RETURN json_build_object(
      'entry', NULL,
      'already_revealed', false,
      'no_entries', true,
      'error', 'Invalid couple or not a member'
    );
  END IF;

  -- Check if we already revealed an entry today for this user
  SELECT cr.*, e.id as entry_id, e.title, e.content_html, e.content_plain,
         e.word_count, e.mood, e.entry_date, e.location_name,
         e.location_lat, e.location_lng, e.created_at as entry_created_at
  INTO v_existing_reveal
  FROM public.checkpoint_reveals cr
  JOIN public.entries e ON e.id = cr.entry_id
  WHERE cr.couple_id = p_couple_id
    AND cr.revealed_to_user_id = v_user_id
    AND cr.checkpoint_date = v_today;

  IF v_existing_reveal IS NOT NULL THEN
    -- Return the already-revealed entry
    RETURN json_build_object(
      'entry', json_build_object(
        'id', v_existing_reveal.entry_id,
        'title', v_existing_reveal.title,
        'content_html', v_existing_reveal.content_html,
        'content_plain', v_existing_reveal.content_plain,
        'word_count', v_existing_reveal.word_count,
        'mood', v_existing_reveal.mood,
        'entry_date', v_existing_reveal.entry_date,
        'location_name', v_existing_reveal.location_name,
        'location_lat', v_existing_reveal.location_lat,
        'location_lng', v_existing_reveal.location_lng,
        'created_at', v_existing_reveal.entry_created_at,
        'author_id', v_partner_id
      ),
      'already_revealed', true,
      'no_entries', false
    );
  END IF;

  -- Pick a random unrevealed partner entry
  SELECT e.* INTO v_random_entry
  FROM public.entries e
  WHERE e.couple_id = p_couple_id
    AND e.author_id = v_partner_id
    AND e.is_draft = false
    AND e.id NOT IN (
      SELECT entry_id FROM public.checkpoint_reveals
      WHERE revealed_to_user_id = v_user_id
    )
  ORDER BY random()
  LIMIT 1;

  IF v_random_entry IS NULL THEN
    -- No unrevealed entries remaining
    RETURN json_build_object(
      'entry', NULL,
      'already_revealed', false,
      'no_entries', true
    );
  END IF;

  -- Record the reveal
  INSERT INTO public.checkpoint_reveals (
    couple_id, checkpoint_config_id, entry_id, revealed_to_user_id, checkpoint_date
  ) VALUES (
    p_couple_id, p_config_id, v_random_entry.id, v_user_id, v_today
  );

  -- Return the newly revealed entry
  RETURN json_build_object(
    'entry', json_build_object(
      'id', v_random_entry.id,
      'title', v_random_entry.title,
      'content_html', v_random_entry.content_html,
      'content_plain', v_random_entry.content_plain,
      'word_count', v_random_entry.word_count,
      'mood', v_random_entry.mood,
      'entry_date', v_random_entry.entry_date,
      'location_name', v_random_entry.location_name,
      'location_lat', v_random_entry.location_lat,
      'location_lng', v_random_entry.location_lng,
      'created_at', v_random_entry.created_at,
      'author_id', v_partner_id
    ),
    'already_revealed', false,
    'no_entries', false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: Get checkpoint history (past reveals for the user)
-- ============================================
CREATE OR REPLACE FUNCTION get_checkpoint_history(p_couple_id UUID)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
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
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: Get count of unrevealed partner entries
-- ============================================
CREATE OR REPLACE FUNCTION get_unrevealed_entry_count(p_couple_id UUID)
RETURNS INT AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_partner_id UUID;
  v_count INT;
BEGIN
  -- Get partner ID
  SELECT
    CASE
      WHEN partner_1_id = v_user_id THEN partner_2_id
      ELSE partner_1_id
    END INTO v_partner_id
  FROM public.couples
  WHERE id = p_couple_id
    AND (partner_1_id = v_user_id OR partner_2_id = v_user_id);

  IF v_partner_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Count unrevealed entries
  SELECT COUNT(*) INTO v_count
  FROM public.entries e
  WHERE e.couple_id = p_couple_id
    AND e.author_id = v_partner_id
    AND e.is_draft = false
    AND e.id NOT IN (
      SELECT entry_id FROM public.checkpoint_reveals
      WHERE revealed_to_user_id = v_user_id
    );

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
