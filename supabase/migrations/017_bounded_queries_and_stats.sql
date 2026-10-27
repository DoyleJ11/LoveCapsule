-- Lightweight keyset pages; no 1,000-row PostgREST truncation or full diary preload.
CREATE FUNCTION public.entry_summary(e public.entries) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT jsonb_build_object('id',e.id,'couple_id',e.couple_id,'author_id',e.author_id,'title',e.title,
    'content_plain',left(e.content_plain,180),'word_count',e.word_count,'mood',e.mood,'is_draft',e.is_draft,
    'is_favorite',e.is_favorite,'entry_date',e.entry_date,'location_name',e.location_name,'created_at',e.created_at,'updated_at',e.updated_at)
$$;
CREATE FUNCTION public.list_diary_entries(p_couple_id uuid,p_before_date date DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  SELECT COALESCE(jsonb_agg(public.entry_summary(e) ORDER BY e.entry_date DESC,e.id DESC),'[]') INTO result FROM (
    SELECT * FROM public.entries WHERE couple_id=p_couple_id AND author_id=auth.uid()
      AND (p_before_date IS NULL OR (entry_date,id)<(p_before_date,p_before_id)) ORDER BY entry_date DESC,id DESC
      LIMIT least(greatest(p_limit,1),100)) e;
  RETURN result;
END $$;
CREATE FUNCTION public.diary_summary(p_couple_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  RETURN (SELECT jsonb_build_object('entries',count(*),'words',COALESCE(sum(word_count),0)) FROM public.entries
    WHERE couple_id=p_couple_id AND author_id=auth.uid() AND NOT is_draft);
END $$;
CREATE FUNCTION public.list_annual_entries(p_couple_id uuid,p_year int,p_before_date date DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  IF NOT EXISTS(SELECT 1 FROM public.reveal_history h JOIN public.couples c ON c.id=h.couple_id
    WHERE h.couple_id=p_couple_id AND h.reveal_year=p_year AND h.reveal_year<=c.last_reveal_year) THEN RAISE EXCEPTION 'Capsule has not opened'; END IF;
  RETURN (SELECT COALESCE(jsonb_agg(public.entry_summary(e) ORDER BY e.entry_date DESC,e.id DESC),'[]') FROM (
    SELECT e.* FROM public.annual_reveal_entries a JOIN public.entries e ON e.id=a.entry_id JOIN public.couples c ON c.id=a.couple_id
    WHERE a.couple_id=p_couple_id AND a.reveal_year=p_year AND e.couple_id=c.id AND NOT e.is_draft
      AND e.author_id IN(c.partner_1_id,c.partner_2_id)
      AND (p_before_date IS NULL OR (e.entry_date,e.id)<(p_before_date,p_before_id)) ORDER BY e.entry_date DESC,e.id DESC
      LIMIT least(greatest(p_limit,1),100)) e);
END $$;
-- The event response is bounded; full note/media are loaded only on selection.
CREATE OR REPLACE FUNCTION public.read_annual_event(p_couple_id uuid,p_year int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE h public.reveal_history;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);
  SELECT * INTO h FROM public.reveal_history WHERE couple_id=p_couple_id AND reveal_year=p_year
    AND reveal_year<=(SELECT last_reveal_year FROM public.couples WHERE id=p_couple_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'This capsule has not been opened'; END IF;
  RETURN to_jsonb(h)||jsonb_build_object('entries',public.list_annual_entries(p_couple_id,p_year));
END $$;
-- Index follows the actual keyset predicate/order, not a speculative duplicate.
CREATE INDEX entries_author_page ON public.entries(couple_id,author_id,entry_date DESC,id DESC);
CREATE OR REPLACE FUNCTION public.calculate_reveal_stats(p_couple_id uuid,p_year int DEFAULT NULL) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.couples; result json;
BEGIN
  SELECT * INTO c FROM public.couples WHERE id=p_couple_id;
  IF c.last_reveal_year IS NULL OR (p_year IS NOT NULL AND p_year<>c.last_reveal_year AND NOT EXISTS(
    SELECT 1 FROM public.reveal_history WHERE couple_id=c.id AND reveal_year=p_year AND reveal_year<=c.last_reveal_year)) THEN
    RAISE EXCEPTION 'Capsule has not opened'; END IF;
  WITH eligible AS MATERIALIZED(
    SELECT e.*,CASE WHEN extract(hour FROM e.created_at AT TIME ZONE c.reveal_timezone) IN(22,23,0,1,2,3,4,5) THEN 3
      WHEN extract(hour FROM e.created_at AT TIME ZONE c.reveal_timezone)<12 THEN 9
      WHEN extract(hour FROM e.created_at AT TIME ZONE c.reveal_timezone)<18 THEN 15 ELSE 19 END writing_bucket
    FROM public.entries e JOIN public.annual_reveal_entries a ON a.entry_id=e.id
    WHERE a.couple_id=c.id AND e.couple_id=c.id AND (p_year IS NULL OR a.reveal_year=p_year)
      AND e.author_id IN(c.partner_1_id,c.partner_2_id) AND NOT e.is_draft),
  longest AS(SELECT * FROM eligible ORDER BY word_count DESC,entry_date,id LIMIT 1),
  months AS(SELECT extract(month FROM entry_date)::int month_number,count(*) n FROM eligible GROUP BY 1 ORDER BY n DESC,month_number LIMIT 1),
  days AS(SELECT DISTINCT author_id,entry_date FROM eligible),
  streaks AS(SELECT author_id,count(*) n FROM(SELECT author_id,entry_date-(row_number() OVER(PARTITION BY author_id ORDER BY entry_date))::int grp FROM days) d GROUP BY author_id,grp),
  media_counts AS(SELECT m.* FROM public.media m JOIN eligible e ON e.id=m.entry_id)
  SELECT json_build_object(
    'partner_1_id',c.partner_1_id,'partner_2_id',c.partner_2_id,
    'partner_1_name',(SELECT display_name FROM public.profiles WHERE id=c.partner_1_id),
    'partner_2_name',(SELECT display_name FROM public.profiles WHERE id=c.partner_2_id),
    'partner_1_entries',count(*) FILTER(WHERE author_id=c.partner_1_id),'partner_2_entries',count(*) FILTER(WHERE author_id=c.partner_2_id),
    'partner_1_words',COALESCE(sum(word_count) FILTER(WHERE author_id=c.partner_1_id),0),
    'partner_2_words',COALESCE(sum(word_count) FILTER(WHERE author_id=c.partner_2_id),0),
    'partner_1_avg_hour',COALESCE((SELECT mode() WITHIN GROUP(ORDER BY writing_bucket) FROM eligible WHERE author_id=c.partner_1_id),12),
    'partner_2_avg_hour',COALESCE((SELECT mode() WITHIN GROUP(ORDER BY writing_bucket) FROM eligible WHERE author_id=c.partner_2_id),12),
    'most_active_month',(SELECT to_char(make_date(2000,month_number,1),'Month') FROM months),'most_active_month_count',COALESCE((SELECT n FROM months),0),
    'longest_entry_words',COALESCE((SELECT word_count FROM longest),0),'longest_entry_author_id',(SELECT author_id FROM longest),'longest_entry_date',(SELECT entry_date FROM longest),
    'partner_1_longest_streak',COALESCE((SELECT max(n) FROM streaks WHERE author_id=c.partner_1_id),0),
    'partner_2_longest_streak',COALESCE((SELECT max(n) FROM streaks WHERE author_id=c.partner_2_id),0),
    'total_media_images',(SELECT count(*) FROM media_counts WHERE media_type='image'),
    'total_media_videos',(SELECT count(*) FROM media_counts WHERE media_type='video'),
    'total_media_audio',(SELECT count(*) FROM media_counts WHERE media_type='audio'),
    'total_audio_duration_ms',COALESCE((SELECT sum(duration_ms) FROM media_counts WHERE media_type='audio'),0),
    'partner_1_top_mood',(SELECT mood FROM eligible WHERE author_id=c.partner_1_id AND mood IS NOT NULL GROUP BY mood ORDER BY count(*) DESC,mood LIMIT 1),
    'partner_2_top_mood',(SELECT mood FROM eligible WHERE author_id=c.partner_2_id AND mood IS NOT NULL GROUP BY mood ORDER BY count(*) DESC,mood LIMIT 1),
    'first_entry_date',min(entry_date),'last_entry_date',max(entry_date),
    'partner_1_favorite_dow',(SELECT to_char(entry_date,'Day') FROM eligible WHERE author_id=c.partner_1_id GROUP BY 1 ORDER BY count(*) DESC,1 LIMIT 1),
    'partner_2_favorite_dow',(SELECT to_char(entry_date,'Day') FROM eligible WHERE author_id=c.partner_2_id GROUP BY 1 ORDER BY count(*) DESC,1 LIMIT 1),
    'locations',(SELECT COALESCE(json_agg(json_build_object('lat',location_lat,'lng',location_lng,'location_name',location_name,'author_id',author_id,'entry_date',entry_date)),'[]')
      FROM(SELECT * FROM eligible WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL ORDER BY entry_date,id LIMIT 200) points),
    'unique_location_count',(SELECT count(DISTINCT(location_lat,location_lng)) FROM eligible WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL)
  ) INTO result FROM eligible;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.entry_summary(public.entries),public.list_diary_entries(uuid,date,uuid,int),public.diary_summary(uuid),public.list_annual_entries(uuid,int,date,uuid,int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_diary_entries(uuid,date,uuid,int),public.diary_summary(uuid),public.list_annual_entries(uuid,int,date,uuid,int) TO authenticated;
-- Future objects are limited at the bucket/API boundary too (25 MiB). No
-- existing oversized file is deleted by this constraint.
UPDATE storage.buckets SET file_size_limit=26214400 WHERE id='entry-media';
