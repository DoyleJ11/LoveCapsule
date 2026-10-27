-- Batch 2: uploads are staged at stable paths; content, media metadata and
-- publication commit together. A receipt makes a lost response safe to retry.
CREATE TABLE public.entry_save_operations (
  operation_id UUID PRIMARY KEY,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.entry_save_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authors can read save receipts" ON public.entry_save_operations
  FOR SELECT TO authenticated USING (author_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.entry_save_operations FROM anon, authenticated;
GRANT SELECT ON public.entry_save_operations TO authenticated;
GRANT ALL ON public.entry_save_operations TO service_role;

CREATE FUNCTION public.save_entry(
  p_operation_id UUID, p_entry_id UUID, p_expected_updated_at TIMESTAMPTZ,
  p_entry JSONB, p_media JSONB DEFAULT '[]', p_remove_media UUID[] DEFAULT '{}'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid(); v_couple UUID := (p_entry->>'couple_id')::uuid;
  v_old public.entries; v_entry public.entries; v_receipt public.entry_save_operations;
  v_media JSONB; v_plain TEXT := COALESCE(p_entry->>'content_plain', ''); v_html TEXT;
  v_removed JSONB; v_result JSONB; v_hash TEXT;
BEGIN
  PERFORM public.assert_couple_member(v_couple);
  IF p_operation_id IS NULL OR p_entry_id IS NULL OR jsonb_typeof(p_media) <> 'array' THEN
    RAISE EXCEPTION 'Invalid save request';
  END IF;
  -- Couple first, then entry: same order as checkpoint/annual operations.
  PERFORM id FROM public.couples WHERE id = v_couple FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('entry:' || p_entry_id::text, 0));
  v_hash := md5(jsonb_build_object('entry',p_entry,'media',p_media,
    'remove',p_remove_media,'expected',p_expected_updated_at AT TIME ZONE 'UTC','id',p_entry_id)::text);
  SELECT * INTO v_receipt FROM public.entry_save_operations WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.author_id <> v_user OR v_receipt.request_hash <> v_hash THEN
      RAISE EXCEPTION 'This save was already used. Reload the entry before changing it.' USING ERRCODE = '40001';
    END IF;
    RETURN v_receipt.result;
  END IF;
  SELECT * INTO v_old FROM public.entries WHERE id = p_entry_id FOR UPDATE;
  IF FOUND THEN
    IF v_old.author_id <> v_user OR v_old.couple_id <> v_couple THEN
      RAISE EXCEPTION 'Not your entry' USING ERRCODE = '42501';
    END IF;
    IF p_expected_updated_at IS NULL OR v_old.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'This entry changed on another device. Reload it before saving; your draft is kept.' USING ERRCODE = '40001';
    END IF;
  ELSIF p_expected_updated_at IS NOT NULL THEN
    RAISE EXCEPTION 'This entry was deleted. Your draft is kept.' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_remove_media) requested(id) WHERE NOT EXISTS (
    SELECT 1 FROM public.media m WHERE m.id = requested.id AND m.entry_id = p_entry_id AND m.author_id = v_user
  )) THEN RAISE EXCEPTION 'Invalid attachment removal' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(storage_path), '[]') INTO v_removed FROM public.media
    WHERE id = ANY(p_remove_media) AND entry_id = p_entry_id AND author_id = v_user;
  v_html := '<p>' || replace(replace(replace(v_plain, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>';
  v_html := replace(v_html, E'\n', '</p><p>');
  INSERT INTO public.entries(id,couple_id,author_id,title,content_plain,content_html,word_count,
    mood,is_draft,entry_date,location_name,location_lat,location_lng,updated_at)
  VALUES(p_entry_id,v_couple,v_user,COALESCE(p_entry->>'title',''),v_plain,v_html,
    CASE WHEN btrim(v_plain) = '' THEN 0 ELSE cardinality(regexp_split_to_array(btrim(v_plain), '\s+')) END,
    p_entry->>'mood',COALESCE((p_entry->>'is_draft')::boolean,true),(p_entry->>'entry_date')::date,
    p_entry->>'location_name',(p_entry->>'location_lat')::double precision,
    (p_entry->>'location_lng')::double precision,clock_timestamp())
  ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, content_plain=EXCLUDED.content_plain,
    content_html=EXCLUDED.content_html, word_count=EXCLUDED.word_count, mood=EXCLUDED.mood,
    is_draft=EXCLUDED.is_draft,entry_date=EXCLUDED.entry_date,location_name=EXCLUDED.location_name,
    location_lat=EXCLUDED.location_lat,location_lng=EXCLUDED.location_lng,updated_at=EXCLUDED.updated_at
  RETURNING * INTO v_entry;
  DELETE FROM public.media WHERE id = ANY(p_remove_media) AND entry_id = p_entry_id AND author_id = v_user;
  FOR v_media IN SELECT value FROM jsonb_array_elements(p_media) LOOP
    IF (v_media->>'storage_path') IS NULL OR (v_media->>'storage_path') NOT LIKE v_user::text || '/' || p_entry_id::text || '/%'
      OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='entry-media' AND name=v_media->>'storage_path')
      OR EXISTS (SELECT 1 FROM public.media WHERE id=(v_media->>'id')::uuid AND (entry_id<>p_entry_id OR author_id<>v_user)) THEN
      RAISE EXCEPTION 'Attachment is missing or belongs to another entry' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.media(id,entry_id,author_id,storage_path,media_type,mime_type,
      width,height,duration_ms,file_size_bytes)
    VALUES((v_media->>'id')::uuid,p_entry_id,v_user,v_media->>'storage_path',v_media->>'media_type',
      v_media->>'mime_type',(v_media->>'width')::int,(v_media->>'height')::int,
      (v_media->>'duration_ms')::int,(v_media->>'file_size_bytes')::bigint)
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
  IF btrim(v_entry.title) = '' AND btrim(v_plain) = ''
    AND NOT EXISTS (SELECT 1 FROM public.media WHERE entry_id = p_entry_id) THEN
    RAISE EXCEPTION 'Add text, a photo, or a voice memo before saving';
  END IF;
  v_result := jsonb_build_object('entry',row_to_json(v_entry),'removed_paths',v_removed);
  INSERT INTO public.entry_save_operations(operation_id,author_id,couple_id,entry_id,request_hash,result)
    VALUES(p_operation_id,v_user,v_couple,p_entry_id,v_hash,v_result);
  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_entry(uuid,uuid,timestamptz,jsonb,jsonb,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_entry(uuid,uuid,timestamptz,jsonb,jsonb,uuid[]) TO authenticated;

-- Keep a redacted receipt after deletion so a lost save response cannot recreate
-- a note that was deliberately deleted on another device. No diary text remains.
CREATE FUNCTION public.redact_deleted_entry_receipts() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.entry_save_operations SET result = jsonb_build_object(
    'entry', jsonb_build_object('id',OLD.id,'deleted',true), 'removed_paths',result->'removed_paths'
  ) WHERE entry_id = OLD.id;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.redact_deleted_entry_receipts() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER redact_deleted_entry_receipts AFTER DELETE ON public.entries
  FOR EACH ROW EXECUTE FUNCTION public.redact_deleted_entry_receipts();
