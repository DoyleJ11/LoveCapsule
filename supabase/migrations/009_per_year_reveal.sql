-- ============================================
-- PER-YEAR REVEAL VISIBILITY (audit C2)
-- ============================================
-- couples.is_revealed is a sticky boolean that nothing ever resets, and
-- the partner-visibility policies gated on it with no date filter at
-- all. Once a couple revealed in year 1, EVERY entry they wrote
-- afterwards became readable by their partner the moment it was saved —
-- the sealed-diary guarantee only ever worked for the first year.
--
-- New model: visibility is bounded by a reveal CUTOFF DATE, derived
-- from the couple's most recent reveal:
--
--     cutoff = the couple's anniversary (month/day) in last_reveal_year
--
-- A partner may read an entry only when entry_date <= cutoff. Opening
-- the capsule on the 2026 anniversary therefore reveals everything
-- written up to that day and nothing after it; entries written the day
-- after stay sealed until the 2027 anniversary. Past reveals remain
-- readable forever (the cutoff only moves forward), and no entry can
-- fall into a gap between reveals.
--
-- couples.last_reveal_year is the source of truth rather than the
-- reveal_history table, because the edge function sets it atomically
-- with the reveal while reveal_history rows are written afterwards by
-- the client and can be missing (see audit H9).
--
-- is_revealed is left in place (the edge function and dev tools still
-- write it) but is no longer used for access control anywhere.

COMMENT ON COLUMN public.couples.is_revealed IS
  'LEGACY: not used for access control. Partner visibility is derived '
  'from last_reveal_year (see anniversary_in_year / migration 009). '
  'Kept because the check-anniversary edge function still sets it.';

-- ============================================
-- Cutoff helper
-- ============================================
-- Returns the anniversary's month/day within the given year.
-- STRICT: NULL anniversary or NULL year yields NULL, so a couple that
-- has never revealed produces a NULL cutoff and every comparison
-- against it is false (access denied) rather than accidentally true.
--
-- Feb 29 anniversaries land on Mar 1 in non-leap years, matching the
-- existing client-side setYear() behaviour, and never raise.

CREATE OR REPLACE FUNCTION public.anniversary_in_year(p_anniversary DATE, p_year INT)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT (
    make_date(p_year, EXTRACT(MONTH FROM p_anniversary)::int, 1)
    + ((EXTRACT(DAY FROM p_anniversary)::int - 1) * INTERVAL '1 day')
  )::date
$$;

-- ============================================
-- entries: partner visibility bounded by the cutoff
-- ============================================

ALTER POLICY "Partner entries visible after reveal"
  ON public.entries
  USING (
    author_id <> auth.uid()
    AND is_draft = false
    AND EXISTS (
      SELECT 1
      FROM public.couples c
      WHERE c.id = entries.couple_id
        AND (c.partner_1_id = auth.uid() OR c.partner_2_id = auth.uid())
        AND entries.entry_date
            <= public.anniversary_in_year(c.anniversary_date, c.last_reveal_year)
    )
  );

-- ============================================
-- media: follows its entry's visibility
-- ============================================

ALTER POLICY "Partner media visible after reveal"
  ON public.media
  USING (
    author_id <> auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.entries e
      JOIN public.couples c ON c.id = e.couple_id
      WHERE e.id = media.entry_id
        AND e.is_draft = false
        AND (c.partner_1_id = auth.uid() OR c.partner_2_id = auth.uid())
        AND e.entry_date
            <= public.anniversary_in_year(c.anniversary_date, c.last_reveal_year)
    )
  );

-- ============================================
-- storage objects: same cutoff as the media rows
-- ============================================
-- Supersedes the reveal check added in migration 007, which keyed on
-- is_revealed. The avatar policy from 007 is unchanged.

ALTER POLICY "Partners can view revealed entry media"
  ON storage.objects
  USING (
    bucket_id = 'entry-media'
    AND EXISTS (
      SELECT 1
      FROM public.media m
      JOIN public.entries e ON e.id = m.entry_id
      JOIN public.couples c ON c.id = e.couple_id
      WHERE m.storage_path = storage.objects.name
        AND m.author_id <> auth.uid()
        AND e.is_draft = false
        AND (c.partner_1_id = auth.uid() OR c.partner_2_id = auth.uid())
        AND e.entry_date
            <= public.anniversary_in_year(c.anniversary_date, c.last_reveal_year)
    )
  );

-- Supports the cutoff comparison on the partner-visibility path.
CREATE INDEX IF NOT EXISTS idx_entries_couple_date
  ON public.entries(couple_id, entry_date);
