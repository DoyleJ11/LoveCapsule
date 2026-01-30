-- ============================================
-- PROFILES (extends Supabase auth.users)
-- ============================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  expo_push_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can view partner profile"
  ON public.profiles FOR SELECT
  USING (
    id IN (
      SELECT partner_1_id FROM public.couples WHERE partner_2_id = auth.uid()
      UNION
      SELECT partner_2_id FROM public.couples WHERE partner_1_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ============================================
-- COUPLES
-- ============================================
CREATE TABLE public.couples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code TEXT UNIQUE NOT NULL DEFAULT lower(substr(md5(random()::text), 1, 8)),
  anniversary_date DATE,
  partner_1_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_2_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_revealed BOOLEAN NOT NULL DEFAULT false,
  last_reveal_year INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT different_partners CHECK (partner_1_id != partner_2_id)
);

ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Couple members can view"
  ON public.couples FOR SELECT
  USING (partner_1_id = auth.uid() OR partner_2_id = auth.uid());

CREATE POLICY "Authenticated users can create couples"
  ON public.couples FOR INSERT
  WITH CHECK (partner_1_id = auth.uid());

CREATE POLICY "Couple members can update"
  ON public.couples FOR UPDATE
  USING (partner_1_id = auth.uid() OR partner_2_id = auth.uid());

-- Allow joining a couple by invite code (partner_2_id is null)
CREATE POLICY "Users can join a couple"
  ON public.couples FOR UPDATE
  USING (partner_2_id IS NULL)
  WITH CHECK (partner_2_id = auth.uid());

-- ============================================
-- ENTRIES
-- ============================================
CREATE TABLE public.entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content_html TEXT NOT NULL DEFAULT '',
  content_plain TEXT NOT NULL DEFAULT '',
  word_count INT NOT NULL DEFAULT 0,
  mood TEXT,
  is_draft BOOLEAN NOT NULL DEFAULT true,
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  location_name TEXT,
  location_lat DOUBLE PRECISION,
  location_lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_entries_couple_author ON public.entries(couple_id, author_id);
CREATE INDEX idx_entries_entry_date ON public.entries(entry_date);
CREATE INDEX idx_entries_location ON public.entries(couple_id) WHERE location_lat IS NOT NULL;

ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;

-- Authors can do everything with their own entries
CREATE POLICY "Authors can manage own entries"
  ON public.entries FOR ALL
  USING (author_id = auth.uid());

-- Partner entries: only visible after reveal and not drafts
CREATE POLICY "Partner entries visible after reveal"
  ON public.entries FOR SELECT
  USING (
    author_id != auth.uid()
    AND couple_id IN (
      SELECT id FROM public.couples
      WHERE (partner_1_id = auth.uid() OR partner_2_id = auth.uid())
        AND is_revealed = true
    )
    AND is_draft = false
  );

-- ============================================
-- MEDIA
-- ============================================
CREATE TABLE public.media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES public.entries(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT,
  width INT,
  height INT,
  thumbnail_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_entry ON public.media(entry_id);

ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authors can manage own media"
  ON public.media FOR ALL
  USING (author_id = auth.uid());

CREATE POLICY "Partner media visible after reveal"
  ON public.media FOR SELECT
  USING (
    author_id != auth.uid()
    AND entry_id IN (
      SELECT e.id FROM public.entries e
      JOIN public.couples c ON e.couple_id = c.id
      WHERE (c.partner_1_id = auth.uid() OR c.partner_2_id = auth.uid())
        AND c.is_revealed = true
        AND e.is_draft = false
    )
  );

-- ============================================
-- STORAGE BUCKET
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('entry-media', 'entry-media', false);

CREATE POLICY "Users can upload own media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'entry-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can view own media"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'entry-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'entry-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================
-- RPC: Get partner entry count (no content leak)
-- ============================================
CREATE OR REPLACE FUNCTION get_partner_entry_count(p_couple_id UUID)
RETURNS INT AS $$
  SELECT COUNT(*)::INT
  FROM public.entries
  WHERE couple_id = p_couple_id
    AND author_id != auth.uid()
    AND is_draft = false;
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================
-- RPC: Get reveal stats (all 13 stats)
-- ============================================
CREATE OR REPLACE FUNCTION get_reveal_stats(p_couple_id UUID)
RETURNS JSON AS $$
DECLARE
  v_p1_id UUID;
  v_p2_id UUID;
  v_p1_name TEXT;
  v_p2_name TEXT;
  v_result JSON;
BEGIN
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
    -- Stat 1 & 2: Entry counts
    'partner_1_entries', (SELECT COUNT(*) FROM entries WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft),
    'partner_2_entries', (SELECT COUNT(*) FROM entries WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft),
    -- Stat 3 & 4: Word counts
    'partner_1_words', (SELECT COALESCE(SUM(word_count), 0) FROM entries WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft),
    'partner_2_words', (SELECT COALESCE(SUM(word_count), 0) FROM entries WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft),
    -- Stat 5: Writing time (average hour)
    'partner_1_avg_hour', (SELECT COALESCE(AVG(EXTRACT(HOUR FROM created_at)), 12) FROM entries WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft),
    'partner_2_avg_hour', (SELECT COALESCE(AVG(EXTRACT(HOUR FROM created_at)), 12) FROM entries WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft),
    -- Stat 6: Most active month
    'most_active_month', (
      SELECT to_char(entry_date, 'Month')
      FROM entries WHERE couple_id = p_couple_id AND NOT is_draft
      GROUP BY to_char(entry_date, 'Month')
      ORDER BY COUNT(*) DESC LIMIT 1
    ),
    'most_active_month_count', (
      SELECT COUNT(*)
      FROM entries WHERE couple_id = p_couple_id AND NOT is_draft
      GROUP BY to_char(entry_date, 'Month')
      ORDER BY COUNT(*) DESC LIMIT 1
    ),
    -- Stat 7: Longest entry
    'longest_entry_words', (SELECT COALESCE(MAX(word_count), 0) FROM entries WHERE couple_id = p_couple_id AND NOT is_draft),
    'longest_entry_author_id', (SELECT author_id FROM entries WHERE couple_id = p_couple_id AND NOT is_draft ORDER BY word_count DESC LIMIT 1),
    'longest_entry_date', (SELECT entry_date FROM entries WHERE couple_id = p_couple_id AND NOT is_draft ORDER BY word_count DESC LIMIT 1),
    -- Stat 8: Longest streaks (computed per partner)
    'partner_1_longest_streak', (
      SELECT COALESCE(MAX(streak_len), 0) FROM (
        SELECT COUNT(*) as streak_len
        FROM (
          SELECT entry_date,
                 entry_date - (ROW_NUMBER() OVER (ORDER BY entry_date))::int AS grp
          FROM (SELECT DISTINCT entry_date FROM entries WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft) sub
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
          FROM (SELECT DISTINCT entry_date FROM entries WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft) sub
        ) grouped
        GROUP BY grp
      ) streaks
    ),
    -- Stat 9: Media counts
    'total_media_images', (SELECT COUNT(*) FROM media m JOIN entries e ON m.entry_id = e.id WHERE e.couple_id = p_couple_id AND NOT e.is_draft AND m.media_type = 'image'),
    'total_media_videos', (SELECT COUNT(*) FROM media m JOIN entries e ON m.entry_id = e.id WHERE e.couple_id = p_couple_id AND NOT e.is_draft AND m.media_type = 'video'),
    -- Stat 10: Top moods
    'partner_1_top_mood', (SELECT mood FROM entries WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft AND mood IS NOT NULL GROUP BY mood ORDER BY COUNT(*) DESC LIMIT 1),
    'partner_2_top_mood', (SELECT mood FROM entries WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft AND mood IS NOT NULL GROUP BY mood ORDER BY COUNT(*) DESC LIMIT 1),
    -- Stat 11: First & last entry
    'first_entry_date', (SELECT MIN(entry_date) FROM entries WHERE couple_id = p_couple_id AND NOT is_draft),
    'last_entry_date', (SELECT MAX(entry_date) FROM entries WHERE couple_id = p_couple_id AND NOT is_draft),
    -- Stat 12: Day of week favorites
    'partner_1_favorite_dow', (SELECT to_char(entry_date, 'Day') FROM entries WHERE couple_id = p_couple_id AND author_id = v_p1_id AND NOT is_draft GROUP BY to_char(entry_date, 'Day') ORDER BY COUNT(*) DESC LIMIT 1),
    'partner_2_favorite_dow', (SELECT to_char(entry_date, 'Day') FROM entries WHERE couple_id = p_couple_id AND author_id = v_p2_id AND NOT is_draft GROUP BY to_char(entry_date, 'Day') ORDER BY COUNT(*) DESC LIMIT 1),
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
    ),
    'unique_location_count', (
      SELECT COUNT(DISTINCT (location_lat, location_lng))
      FROM entries
      WHERE couple_id = p_couple_id AND NOT is_draft AND location_lat IS NOT NULL
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
