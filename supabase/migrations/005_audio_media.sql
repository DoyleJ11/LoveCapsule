-- Allow 'audio' media type (voice memos)
ALTER TABLE public.media DROP CONSTRAINT media_media_type_check;
ALTER TABLE public.media ADD CONSTRAINT media_media_type_check
  CHECK (media_type IN ('image', 'video', 'audio'));

-- Store audio duration in milliseconds
ALTER TABLE public.media ADD COLUMN duration_ms INT;
