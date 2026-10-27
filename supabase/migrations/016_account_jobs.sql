-- Private, durable work survives metadata/auth deletion. No client can enqueue
-- arbitrary storage paths, recipients or provider tokens.
CREATE TABLE public.maintenance_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('cleanup','account','push')),
  dedupe_key text NOT NULL UNIQUE, payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','receipt','done','failed')),
  attempts int NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid, lease_until timestamptz, ticket_id text, error_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_due ON public.maintenance_jobs(next_at) WHERE state IN ('pending','receipt','leased');
CREATE TABLE public.deletion_requests (
  id uuid PRIMARY KEY, actor_id uuid NOT NULL, kind text NOT NULL, target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.deletion_job_links (
  request_id uuid REFERENCES public.deletion_requests ON DELETE CASCADE,
  job_id uuid REFERENCES public.maintenance_jobs, PRIMARY KEY(request_id,job_id)
);
CREATE TABLE public.push_devices (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  token text NOT NULL UNIQUE, enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ADD COLUMN notifications_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.maintenance_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deletion_job_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.maintenance_jobs,public.deletion_requests,public.deletion_job_links,public.push_devices FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.maintenance_jobs,public.deletion_requests,public.deletion_job_links,public.push_devices TO service_role;

CREATE FUNCTION public.queue_cleanup(p_path text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ident uuid;
BEGIN
  IF p_path IS NULL OR p_path='' THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('file:'||p_path,0));
  INSERT INTO public.maintenance_jobs(kind,dedupe_key,payload) VALUES('cleanup','file:'||p_path,jsonb_build_object('path',p_path))
  ON CONFLICT(dedupe_key) DO UPDATE SET state=CASE WHEN maintenance_jobs.state='done' THEN 'pending' ELSE maintenance_jobs.state END,
    attempts=CASE WHEN maintenance_jobs.state='done' THEN 0 ELSE maintenance_jobs.attempts END,
    next_at=now(),updated_at=now() RETURNING id INTO ident;
  RETURN ident;
END $$;
CREATE FUNCTION public.queue_deleted_media() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF starts_with(OLD.storage_path,OLD.author_id::text||'/'||OLD.entry_id::text||'/') THEN PERFORM public.queue_cleanup(OLD.storage_path); END IF;
  IF starts_with(OLD.thumbnail_path,OLD.author_id::text||'/'||OLD.entry_id::text||'/') THEN PERFORM public.queue_cleanup(OLD.thumbnail_path); END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER queue_deleted_media BEFORE DELETE ON public.media FOR EACH ROW EXECUTE FUNCTION public.queue_deleted_media();
CREATE FUNCTION public.queue_changed_avatar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF (TG_OP='DELETE' OR OLD.avatar_url IS DISTINCT FROM NEW.avatar_url) AND starts_with(OLD.avatar_url,OLD.id::text||'/avatars/') THEN PERFORM public.queue_cleanup(OLD.avatar_url); END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER queue_changed_avatar BEFORE DELETE OR UPDATE OF avatar_url ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.queue_changed_avatar();

CREATE FUNCTION public.deletion_status(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.deletion_requests; pending int; failed int;
BEGIN
  SELECT * INTO r FROM public.deletion_requests WHERE id=p_id AND actor_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Deletion request not found' USING ERRCODE='42501'; END IF;
  SELECT count(*) FILTER(WHERE j.state<>'done'), count(*) FILTER(WHERE j.state='failed') INTO pending,failed
    FROM public.deletion_job_links l JOIN public.maintenance_jobs j ON j.id=l.job_id WHERE l.request_id=r.id;
  RETURN jsonb_build_object('id',r.id,'records_deleted',true,'cleanup_pending',pending,'cleanup_failed',failed,
    'status',CASE WHEN failed>0 THEN 'needs_attention' WHEN pending>0 THEN 'cleanup_pending' ELSE 'complete' END);
END $$;
CREATE FUNCTION public.request_deletion(p_id uuid,p_kind text,p_target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=auth.uid(); existing public.deletion_requests; couple uuid; paths text[]; path text; job uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO existing FROM public.deletion_requests WHERE id=p_id;
  IF FOUND THEN
    IF existing.actor_id<>actor OR existing.kind<>p_kind OR existing.target_id<>p_target THEN RAISE EXCEPTION 'Invalid deletion retry' USING ERRCODE='42501'; END IF;
    RETURN public.deletion_status(p_id);
  END IF;
  IF p_kind='entry' THEN
    SELECT couple_id INTO couple FROM public.entries WHERE id=p_target AND author_id=actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found' USING ERRCODE='42501'; END IF;
    PERFORM public.assert_couple_member(couple);
  ELSIF p_kind='unpair' THEN couple:=p_target; PERFORM public.assert_couple_member(couple);
  ELSIF p_kind='account' AND p_target=actor THEN
    SELECT id INTO couple FROM public.couples WHERE actor IN(partner_1_id,partner_2_id);
  ELSE RAISE EXCEPTION 'Invalid deletion request' USING ERRCODE='42501'; END IF;
  -- Same lock order as saves/reveals. Collect every member's paths as a trusted operation.
  PERFORM id FROM public.couples WHERE id=couple FOR UPDATE;
  INSERT INTO public.deletion_requests VALUES(p_id,actor,p_kind,p_target,now());
  SELECT array_agg(path_value) INTO paths FROM (
    SELECT m.storage_path path_value FROM public.media m JOIN public.entries e ON e.id=m.entry_id
      WHERE ((p_kind='entry' AND e.id=p_target) OR (p_kind<>'entry' AND e.couple_id=couple)) AND starts_with(m.storage_path,m.author_id::text||'/'||m.entry_id::text||'/')
    UNION SELECT m.thumbnail_path FROM public.media m JOIN public.entries e ON e.id=m.entry_id
      WHERE ((p_kind='entry' AND e.id=p_target) OR (p_kind<>'entry' AND e.couple_id=couple)) AND starts_with(m.thumbnail_path,m.author_id::text||'/'||m.entry_id::text||'/')
    UNION SELECT avatar_url FROM public.profiles WHERE p_kind='account' AND id=actor AND starts_with(avatar_url,actor::text||'/avatars/')
  ) paths WHERE path_value IS NOT NULL;
  FOREACH path IN ARRAY COALESCE(paths,ARRAY[]::text[]) LOOP
    job:=public.queue_cleanup(path);
    INSERT INTO public.deletion_job_links VALUES(p_id,job) ON CONFLICT DO NOTHING;
  END LOOP;
  IF p_kind='entry' THEN DELETE FROM public.entries WHERE id=p_target AND author_id=actor;
  ELSE DELETE FROM public.couples WHERE id=couple; END IF;
  IF p_kind='account' THEN
    UPDATE public.push_devices SET enabled=false WHERE user_id=actor;
    INSERT INTO public.maintenance_jobs(kind,dedupe_key,payload) VALUES('account','account:'||actor,jsonb_build_object('user_id',actor))
      ON CONFLICT(dedupe_key) DO UPDATE SET updated_at=now() RETURNING id INTO job;
    INSERT INTO public.deletion_job_links VALUES(p_id,job);
  END IF;
  RETURN public.deletion_status(p_id);
END $$;
CREATE FUNCTION public.prevent_deleted_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.deletion_requests WHERE actor_id=auth.uid() AND kind='account') THEN
    RAISE EXCEPTION 'Account deletion is pending' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prevent_deleted_account BEFORE INSERT ON public.couples FOR EACH ROW EXECUTE FUNCTION public.prevent_deleted_account();

CREATE FUNCTION public.register_push_device(p_id uuid,p_token text,p_enabled boolean DEFAULT true,p_expected_user uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_expected_user IS NOT NULL AND auth.uid() IS DISTINCT FROM p_expected_user THEN RAISE EXCEPTION 'Account changed' USING ERRCODE='42501'; END IF;
  IF auth.uid() IS NULL OR NOT p_token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' THEN RAISE EXCEPTION 'Invalid push registration' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.deletion_requests WHERE actor_id=auth.uid() AND kind='account') THEN RAISE EXCEPTION 'Account deletion pending'; END IF;
  -- Reassign this installation/token on account switch; never retain the old recipient.
  DELETE FROM public.push_devices WHERE token=p_token AND id<>p_id;
  INSERT INTO public.push_devices(id,user_id,token,enabled) VALUES(p_id,auth.uid(),p_token,p_enabled)
    ON CONFLICT(id) DO UPDATE SET user_id=auth.uid(),token=p_token,enabled=p_enabled,last_seen_at=now();
  UPDATE public.profiles SET notifications_enabled=p_enabled WHERE id=auth.uid();
END $$;
CREATE FUNCTION public.unregister_push_device(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  DELETE FROM public.push_devices WHERE id=p_id AND user_id=auth.uid();
END $$;
CREATE FUNCTION public.queue_notice(p_couple uuid,p_user uuid,p_key text,p_type text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.maintenance_jobs(kind,dedupe_key,payload)
  SELECT 'push',p_key||':'||d.id,jsonb_build_object('couple_id',p_couple,'user_id',p_user,'device_id',d.id,'token',d.token,'type',p_type)
    FROM public.push_devices d JOIN public.profiles p ON p.id=d.user_id
    WHERE d.user_id=p_user AND d.enabled AND p.notifications_enabled AND d.last_seen_at>now()-interval '7 days'
  ON CONFLICT(dedupe_key) DO NOTHING;
END $$;
CREATE FUNCTION public.notify_first_publication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.couples; recipient uuid;
BEGIN
  IF NEW.is_draft OR (TG_OP='UPDATE' AND OLD.published_at IS NOT NULL) THEN RETURN NEW; END IF;
  SELECT * INTO c FROM public.couples WHERE id=NEW.couple_id;
  IF NEW.author_id NOT IN(c.partner_1_id,c.partner_2_id) THEN RETURN NEW; END IF;
  recipient:=CASE WHEN NEW.author_id=c.partner_1_id THEN c.partner_2_id ELSE c.partner_1_id END;
  PERFORM public.queue_notice(c.id,recipient,'entry:'||NEW.id,'new_entry');
  RETURN NEW;
END $$;
CREATE TRIGGER notify_first_publication AFTER INSERT OR UPDATE ON public.entries FOR EACH ROW EXECUTE FUNCTION public.notify_first_publication();

-- Worker-only operations. Every claim has a new lease; stale responses cannot
-- finish a newer attempt. A crashed worker is recoverable without deleting paths.
CREATE FUNCTION public.prepare_maintenance() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.couples; o public.reveal_occurrences; y int; u uuid;
BEGIN
  UPDATE public.maintenance_jobs SET state='failed',error_code='attempts_exhausted' WHERE attempts>=8 AND (state IN('pending','receipt') OR (state='leased' AND lease_until<now()));
  FOR c IN SELECT * FROM public.couples WHERE partner_2_id IS NOT NULL LOOP
    PERFORM public.materialize_reveal_occurrences(c.id);
    y:=public.next_annual_year(c);
    IF public.annual_ready_at(c,y)<=now() THEN
      FOREACH u IN ARRAY ARRAY[c.partner_1_id,c.partner_2_id] LOOP
        IF EXISTS(SELECT 1 FROM public.push_devices WHERE user_id=u AND created_at<=public.annual_ready_at(c,y)) THEN
          PERFORM public.queue_notice(c.id,u,'annual:'||c.id||':'||y,'reveal_ready'); END IF;
      END LOOP;
    END IF;
    FOR o IN SELECT * FROM public.reveal_occurrences WHERE couple_id=c.id AND NOT cancelled AND due_at<=now() LOOP
      FOREACH u IN ARRAY ARRAY[c.partner_1_id,c.partner_2_id] LOOP
        IF NOT EXISTS(SELECT 1 FROM public.occurrence_claims WHERE occurrence_id=o.id AND recipient_id=u)
          AND EXISTS(SELECT 1 FROM public.push_devices WHERE user_id=u AND created_at<=o.due_at) THEN
          PERFORM public.queue_notice(c.id,u,'checkpoint:'||o.id,'reveal_ready'); END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  -- Only our bucket/UUID namespace, with a 24h grace for staged uploads.
  PERFORM public.queue_orphan_cleanup(s.name) FROM storage.objects s WHERE s.bucket_id='entry-media'
    AND s.created_at<now()-interval '24 hours' AND s.name ~ '^[0-9a-f-]{36}/'
    AND NOT EXISTS(SELECT 1 FROM public.media WHERE storage_path=s.name OR thumbnail_path=s.name)
    AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE avatar_url=s.name)
    AND NOT EXISTS(SELECT 1 FROM public.maintenance_jobs WHERE dedupe_key='file:'||s.name);
END $$;
CREATE FUNCTION public.claim_maintenance(p_limit int DEFAULT 30) RETURNS SETOF public.maintenance_jobs
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE public.maintenance_jobs j SET state='leased',lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',
    attempts=j.attempts+1,updated_at=now()
  WHERE j.id IN(SELECT id FROM public.maintenance_jobs WHERE attempts<8 AND next_at<=now()
    AND (state IN('pending','receipt') OR (state='leased' AND lease_until<now()))
    ORDER BY next_at,id LIMIT least(greatest(p_limit,1),100) FOR UPDATE SKIP LOCKED) RETURNING j.*
$$;
CREATE FUNCTION public.finish_maintenance(p_id uuid,p_lease uuid,p_outcome text,p_code text DEFAULT NULL,p_ticket text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.maintenance_jobs;
BEGIN
  SELECT * INTO j FROM public.maintenance_jobs WHERE id=p_id AND lease_id=p_lease AND state='leased' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_outcome NOT IN('done','retry','receipt','invalid_token') THEN RAISE EXCEPTION 'Invalid job outcome'; END IF;
  IF p_outcome='invalid_token' THEN DELETE FROM public.push_devices WHERE id=(j.payload->>'device_id')::uuid AND token=j.payload->>'token'; END IF;
  UPDATE public.maintenance_jobs SET state=CASE WHEN p_outcome IN('done','invalid_token') THEN 'done'
      WHEN attempts>=8 THEN 'failed' WHEN p_outcome='receipt' THEN 'receipt' ELSE 'pending' END,
    payload=CASE WHEN kind='push' AND p_outcome IN('done','invalid_token') THEN payload-'token' ELSE payload END,
    ticket_id=COALESCE(p_ticket,ticket_id),error_code=left(p_code,80),lease_until=NULL,
    next_at=now()+CASE WHEN p_outcome='receipt' THEN interval '15 minutes' ELSE make_interval(secs=>least(3600,30*power(2,least(attempts,7)))) END,
    updated_at=now() WHERE id=j.id;
  RETURN true;
END $$;
-- Exposed function grants are explicit; internals cannot be used by app clients.
DO $$ DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
    'queue_cleanup','queue_deleted_media','queue_changed_avatar','deletion_status','request_deletion','prevent_deleted_account',
    'register_push_device','unregister_push_device','queue_notice','notify_first_publication','prepare_maintenance','claim_maintenance','finish_maintenance') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.request_deletion(uuid,text,uuid),public.deletion_status(uuid),
 public.register_push_device(uuid,text,boolean,uuid),public.unregister_push_device(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_maintenance(),public.claim_maintenance(int),public.finish_maintenance(uuid,uuid,text,text,text) TO service_role;
CREATE FUNCTION public.can_deliver_notice(p_job uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.maintenance_jobs;c public.couples;d public.push_devices;ref text;
BEGIN
  SELECT * INTO j FROM public.maintenance_jobs WHERE id=p_job AND kind='push';IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO d FROM public.push_devices WHERE id=(j.payload->>'device_id')::uuid;
  IF NOT FOUND OR NOT d.enabled OR d.user_id<>(j.payload->>'user_id')::uuid OR d.token<>j.payload->>'token'
    OR d.last_seen_at<now()-interval '7 days' THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=d.user_id AND notifications_enabled) THEN RETURN false; END IF;
  SELECT * INTO c FROM public.couples WHERE id=(j.payload->>'couple_id')::uuid AND d.user_id IN(partner_1_id,partner_2_id);
  IF NOT FOUND THEN RETURN false; END IF;
  ref:=split_part(j.dedupe_key,':',2);
  IF j.payload->>'type'='new_entry' THEN RETURN EXISTS(SELECT 1 FROM public.entries WHERE id=ref::uuid AND couple_id=c.id AND NOT is_draft AND author_id<>d.user_id AND author_id IN(c.partner_1_id,c.partner_2_id)); END IF;
  IF starts_with(j.dedupe_key,'checkpoint:') THEN RETURN EXISTS(SELECT 1 FROM public.reveal_occurrences o WHERE o.id=ref::uuid AND o.couple_id=c.id AND NOT cancelled AND due_at<=now()
    AND NOT EXISTS(SELECT 1 FROM public.occurrence_claims WHERE occurrence_id=o.id AND recipient_id=d.user_id)); END IF;
  IF starts_with(j.dedupe_key,'annual:') THEN RETURN NOT EXISTS(SELECT 1 FROM public.reveal_history WHERE couple_id=c.id AND reveal_year=split_part(j.dedupe_key,':',3)::int)
    AND (split_part(j.dedupe_key,':',3)::int>=extract(year FROM c.anniversary_date) AND public.annual_ready_at(c,split_part(j.dedupe_key,':',3)::int)<=now()); END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.can_deliver_notice(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_deliver_notice(uuid) TO service_role;

-- Coordinate staged media commits with the orphan worker. Without this lock a
-- note could acquire a reference after the worker checks it but before removal.
CREATE FUNCTION public.queue_orphan_cleanup(p_path text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('file:'||p_path,0));
  IF EXISTS(SELECT 1 FROM public.media WHERE storage_path=p_path OR thumbnail_path=p_path)
    OR EXISTS(SELECT 1 FROM public.profiles WHERE avatar_url=p_path) THEN RETURN NULL; END IF;
  RETURN public.queue_cleanup(p_path);
END $$;
CREATE FUNCTION public.guard_collecting_file() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE paths text[]; path text;
BEGIN
  IF TG_TABLE_NAME='media' THEN
    IF NOT starts_with(NEW.storage_path,NEW.author_id::text||'/'||NEW.entry_id::text||'/')
      OR (NEW.thumbnail_path IS NOT NULL AND NOT starts_with(NEW.thumbnail_path,NEW.author_id::text||'/'||NEW.entry_id::text||'/')) THEN
      RAISE EXCEPTION 'Attachment path does not belong to this note' USING ERRCODE='42501'; END IF;
    paths:=ARRAY[NEW.storage_path,NEW.thumbnail_path];
  ELSE
    IF NEW.avatar_url IS NOT NULL AND NOT starts_with(NEW.avatar_url,NEW.id::text||'/avatars/') THEN
      RAISE EXCEPTION 'Avatar path does not belong to this account' USING ERRCODE='42501'; END IF;
    paths:=ARRAY[NEW.avatar_url];
  END IF;
  FOR path IN SELECT DISTINCT p FROM unnest(paths) p WHERE p IS NOT NULL ORDER BY p LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('file:'||path,0));
    IF EXISTS(SELECT 1 FROM public.maintenance_jobs WHERE dedupe_key='file:'||path AND state<>'done') THEN
      RAISE EXCEPTION 'Attachment cleanup is in progress. Please retry shortly.' USING ERRCODE='40001';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_collecting_media BEFORE INSERT OR UPDATE OF storage_path,thumbnail_path ON public.media FOR EACH ROW EXECUTE FUNCTION public.guard_collecting_file();
CREATE TRIGGER guard_collecting_avatar BEFORE INSERT OR UPDATE OF avatar_url ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_collecting_file();
REVOKE ALL ON FUNCTION public.queue_orphan_cleanup(text),public.guard_collecting_file() FROM PUBLIC,anon,authenticated;
