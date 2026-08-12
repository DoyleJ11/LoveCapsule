-- ============================================
-- PARTNER STORAGE ACCESS FIX
-- ============================================
-- The previous policy ("Partners can view each other's media") granted a
-- partner SELECT on EVERY object in the other partner's folder, so entry
-- photos and voice memos (including drafts) were downloadable before the
-- anniversary reveal. Only the media/entries table ROWS were protected —
-- the storage bytes were not.
--
-- Replace it with two precise policies:
--   1. The partner's current avatar stays visible at all times
--      (profiles.avatar_url stores the object's full storage path).
--   2. Partner entry media is visible only when a media row matches the
--      object AND its entry is published AND the couple is revealed —
--      mirroring the "Partner media visible after reveal" policy on
--      public.media.
--
-- Own files are unaffected: "Users can view own media" still grants each
-- user full read access to their own folder (including their own avatar).

DROP POLICY "Partners can view each other's media" ON storage.objects;

-- 1. Partner's current avatar only.
CREATE POLICY "Partners can view avatar"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'entry-media'
    AND EXISTS (
      SELECT 1
      FROM public.couples c
      JOIN public.profiles p
        ON p.id = CASE
          WHEN c.partner_1_id = auth.uid() THEN c.partner_2_id
          ELSE c.partner_1_id
        END
      WHERE (c.partner_1_id = auth.uid() OR c.partner_2_id = auth.uid())
        AND p.avatar_url = storage.objects.name
    )
  );

-- 2. Partner entry media, only after reveal and never for drafts.
CREATE POLICY "Partners can view revealed entry media"
  ON storage.objects FOR SELECT
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
        AND c.is_revealed = true
        AND (c.partner_1_id = auth.uid() OR c.partner_2_id = auth.uid())
    )
  );

-- Support the storage_path lookup in the entry-media policy.
CREATE INDEX IF NOT EXISTS idx_media_storage_path ON public.media(storage_path);
