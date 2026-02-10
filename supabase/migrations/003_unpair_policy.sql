-- ============================================
-- UNPAIR COUPLE POLICY
-- ============================================
-- Allow either partner to delete their couple for unpair functionality.
-- This enables the "Unpair from Partner" feature in the app.
--
-- Note: CASCADE rules on entries, media, and reveal_history tables
-- will automatically clean up all related data when the couple is deleted.

CREATE POLICY "Either partner can delete couple"
  ON public.couples FOR DELETE
  USING (partner_1_id = auth.uid() OR partner_2_id = auth.uid());
