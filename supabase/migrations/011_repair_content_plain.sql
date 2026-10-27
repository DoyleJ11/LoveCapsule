-- ============================================
-- REPAIR CORRUPTED content_plain (audit C8)
-- ============================================
-- The composer wrote content_html by wrapping UNESCAPED user text in <p>
-- tags, and the client then threw away the correct content_plain it had
-- been handed and re-derived it with a generic /<[^>]*>/ strip. Two
-- consequences for every row written so far:
--
--   1. Paragraph breaks became "</p><p>" and then collapsed to a single
--      space, so multi-paragraph entries are stored as one run-on line.
--   2. Any user text containing < ... > matched the tag regex and was
--      deleted outright ("3 < 4 > 2" lost "< 4 >").
--
-- Edit mode reloads content_plain, so the damage became the source of
-- truth and compounded on every edit.
--
-- Recovery is possible because content_html still holds the original
-- text: the app only ever emitted <p> and </p>, so replacing those
-- specific tags — rather than stripping tags generically — restores
-- angle brackets as well as newlines. This mirrors fromContentHtml() in
-- src/lib/entry-content.ts.
--
-- Runs BEFORE the new client ships, so every row here is still in the
-- old unescaped format and must NOT be entity-decoded.

CREATE OR REPLACE FUNCTION public.repair_entry_html_to_plain(p_html TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(COALESCE(p_html, ''), '</p>\s*<p>', E'\n', 'gi'),
               '<br\s*/?>', E'\n', 'gi'
             ),
             '^\s*<p>', '', 'i'
           ),
           '</p>\s*$', '', 'i'
         )
$$;

UPDATE public.entries
SET content_plain = public.repair_entry_html_to_plain(content_html),
    word_count = COALESCE(
      array_length(
        regexp_split_to_array(
          btrim(public.repair_entry_html_to_plain(content_html)),
          '\s+'
        ),
        1
      ),
      0
    )
WHERE content_html <> ''
  AND content_plain IS DISTINCT FROM public.repair_entry_html_to_plain(content_html);

DROP FUNCTION public.repair_entry_html_to_plain(TEXT);
