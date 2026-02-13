-- Add remote trigger column for Valentine's Day surprise
ALTER TABLE public.couples
ADD COLUMN valentine_surprise_triggered BOOLEAN NOT NULL DEFAULT false;
