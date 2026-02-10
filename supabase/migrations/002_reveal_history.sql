-- ============================================
-- REVEAL HISTORY (tracks reveals per year)
-- ============================================
-- This table stores a snapshot of reveal stats for each year,
-- allowing users to revisit previous years' reveals.

CREATE TABLE public.reveal_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  reveal_year INT NOT NULL,
  revealed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Cached stats snapshot (so we don't have to recalculate for past years)
  stats_snapshot JSONB NOT NULL,

  -- Constraints
  CONSTRAINT unique_couple_year UNIQUE (couple_id, reveal_year)
);

CREATE INDEX idx_reveal_history_couple ON public.reveal_history(couple_id);
CREATE INDEX idx_reveal_history_year ON public.reveal_history(couple_id, reveal_year DESC);

ALTER TABLE public.reveal_history ENABLE ROW LEVEL SECURITY;

-- Couple members can view their reveal history
CREATE POLICY "Couple members can view reveal history"
  ON public.reveal_history FOR SELECT
  USING (
    couple_id IN (
      SELECT id FROM public.couples
      WHERE partner_1_id = auth.uid() OR partner_2_id = auth.uid()
    )
  );

-- Only the system (via edge function) should insert reveal history
-- Using SECURITY DEFINER functions for this
CREATE POLICY "System can insert reveal history"
  ON public.reveal_history FOR INSERT
  WITH CHECK (
    couple_id IN (
      SELECT id FROM public.couples
      WHERE partner_1_id = auth.uid() OR partner_2_id = auth.uid()
    )
  );

-- ============================================
-- Updated RPC: Get reveal stats with year filter
-- ============================================
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
    -- Stat 1 & 2: Entry counts
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
    -- Stat 3 & 4: Word counts
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
    -- Stat 5: Writing time (average hour)
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
    -- Stat 6: Most active month
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
    -- Stat 7: Longest entry
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
    -- Stat 8: Longest streaks (computed per partner)
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
    -- Stat 9: Media counts
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
    -- Stat 10: Top moods
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
    -- Stat 11: First & last entry
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
    -- Stat 12: Day of week favorites
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
    -- Stat 13: Locations
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: Get reveal years (list of years with reveals)
-- ============================================
CREATE OR REPLACE FUNCTION get_reveal_years(p_couple_id UUID)
RETURNS JSON AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(json_build_object(
      'year', reveal_year,
      'revealed_at', revealed_at
    ) ORDER BY reveal_year DESC), '[]'::json)
    FROM public.reveal_history
    WHERE couple_id = p_couple_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: Save reveal snapshot (called when reveal is triggered)
-- ============================================
CREATE OR REPLACE FUNCTION save_reveal_snapshot(p_couple_id UUID, p_year INT, p_stats JSONB)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.reveal_history (couple_id, reveal_year, stats_snapshot)
  VALUES (p_couple_id, p_year, p_stats)
  ON CONFLICT (couple_id, reveal_year)
  DO UPDATE SET stats_snapshot = p_stats, revealed_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
