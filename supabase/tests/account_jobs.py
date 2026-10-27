import json
import concurrent.futures
import unittest
import reveal_guardrails as f
from reveal_guardrails import sql,A,B,C,COUPLE,E

class AccountJobs(unittest.TestCase):
    def setUp(self):
        f.RevealGuardrails().setUp()
        sql('TRUNCATE maintenance_jobs,deletion_requests CASCADE')
    def register(self,user=A,ident='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',token='ExpoPushToken[device_a]'):
        sql(f"SELECT register_push_device('{ident}','{token}',true)",user)
    def test_unpair_collects_both_partners_full_paths_and_retries(self):
        ident='cccccccc-cccc-cccc-cccc-cccccccccccc'
        receipt=json.loads(sql(f"SELECT request_deletion('{ident}','unpair','{COUPLE}')",A))
        self.assertEqual(receipt['cleanup_pending'],4)
        self.assertEqual(sql(f"SELECT count(*) FROM couples WHERE id='{COUPLE}'"),'0')
        self.assertEqual(sql("SELECT count(*) FROM maintenance_jobs WHERE payload->>'path' LIKE '%/%/%/photo.jpg'"),'0') # no double prefix
        self.assertEqual(json.loads(sql(f"SELECT request_deletion('{ident}','unpair','{COUPLE}')",A))['id'],ident)
        sql(f"SELECT deletion_status('{ident}')",C,ok=False)
    def test_direct_media_delete_also_enqueues_and_paths_are_scoped(self):
        sql(f"DELETE FROM entries WHERE id='{E[0]}'",B)
        self.assertEqual(sql("SELECT count(*) FROM maintenance_jobs WHERE kind='cleanup'"),'1')
        sql(f"UPDATE profiles SET avatar_url='{C}/avatars/private.jpg' WHERE id='{A}'",A,ok=False)
        sql(f"UPDATE profiles SET avatar_url=NULL WHERE id='{A}'",A)
        self.assertEqual(sql("SELECT count(*) FROM maintenance_jobs WHERE payload->>'path' LIKE '%avatars%'"),'0')
    def test_jobs_cannot_be_forged_and_foreign_deletion_is_denied(self):
        sql("INSERT INTO maintenance_jobs(kind,dedupe_key,payload) VALUES('cleanup','fake','{}')",A,ok=False)
        sql('SELECT claim_maintenance()',A,ok=False)
        sql('SET ROLE anon; SELECT prepare_maintenance()',ok=False)
        sql(f"SELECT request_deletion(gen_random_uuid(),'entry','{E[0]}')",A,ok=False)
        sql(f"SELECT request_deletion(gen_random_uuid(),'account','{B}')",A,ok=False)
    def test_parallel_leases_and_stale_acknowledgement(self):
        sql(f"DELETE FROM entries WHERE id IN('{E[0]}','{E[1]}')",B)
        def claim(_):return json.loads(sql("SELECT COALESCE(json_agg(j),'[]') FROM claim_maintenance(1) j"))
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: claims=list(pool.map(claim,range(2)))
        self.assertEqual(len({r[0]['id'] for r in claims}),2)
        job=claims[0][0]
        self.assertEqual(sql(f"SELECT finish_maintenance('{job['id']}',gen_random_uuid(),'done')"),'f')
        self.assertEqual(sql(f"SELECT finish_maintenance('{job['id']}','{job['lease_id']}','retry','network')"),'t')
        self.assertEqual(sql(f"SELECT state FROM maintenance_jobs WHERE id='{job['id']}'"),'pending')
    def test_first_publication_is_the_only_new_note_notice(self):
        self.register(A)
        sql(f"UPDATE entries SET is_draft=false WHERE id='{E[3]}'",B)
        sql(f"UPDATE entries SET title='Edited',is_draft=true WHERE id='{E[3]}'",B)
        sql(f"UPDATE entries SET is_draft=false WHERE id='{E[3]}'",B)
        self.assertEqual(sql("SELECT count(*) FROM maintenance_jobs WHERE kind='push'"),'1')
        self.assertNotIn('Edited',sql("SELECT payload::text FROM maintenance_jobs WHERE kind='push'"))
    def test_token_switch_and_invalid_receipt_cannot_remove_replacement(self):
        ident='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
        self.register(A,ident)
        self.register(B,ident)
        self.assertEqual(sql(f"SELECT user_id FROM push_devices WHERE id='{ident}'"),B)
        sql(f"SELECT unregister_push_device('{ident}')",A)
        self.assertEqual(sql('SELECT count(*) FROM push_devices'),'1')
    def test_reveal_notices_are_deduplicated_and_claim_independent(self):
        self.register(A)
        sql("UPDATE push_devices SET created_at=now()-interval '2 days'")
        sql('SELECT prepare_maintenance(); SELECT prepare_maintenance()')
        self.assertEqual(sql("SELECT count(*) FROM maintenance_jobs WHERE kind='push' AND dedupe_key LIKE 'checkpoint:%'"),'1')
        self.assertEqual(sql('SELECT count(*) FROM occurrence_claims'),'0')
    def test_orphan_grace_and_known_references(self):
        sql(f"INSERT INTO storage.objects(bucket_id,name,created_at) VALUES('entry-media','{A}/orphan/old.jpg',now()-interval '2 days'),('entry-media','{A}/orphan/new.jpg',now())")
        sql('SELECT prepare_maintenance()')
        self.assertEqual(sql("SELECT count(*) FROM maintenance_jobs WHERE kind='cleanup'"),'1')
        self.assertTrue(sql("SELECT payload->>'path' FROM maintenance_jobs WHERE kind='cleanup'").endswith('old.jpg'))
    def test_account_deletion_is_durable_and_blocks_new_couples(self):
        receipt=json.loads(sql(f"SELECT request_deletion(gen_random_uuid(),'account','{A}')",A))
        self.assertGreater(receipt['cleanup_pending'],0)
        self.assertEqual(sql("SELECT count(*) FROM maintenance_jobs WHERE kind='account'"),'1')
        sql(f"INSERT INTO couples(partner_1_id) VALUES('{A}')",A,ok=False)
        self.assertEqual(sql(f"SELECT count(*) FROM auth.users WHERE id='{A}'"),'1') # worker deletes auth only after job commit
    def test_pages_bound_bodies_and_stats_are_circular_and_include_audio(self):
        sql(f"INSERT INTO entries(couple_id,author_id,entry_date,content_plain) SELECT '{COUPLE}','{A}','2026-01-01',repeat('x',5000) FROM generate_series(1,105)")
        page=json.loads(sql(f"SELECT list_diary_entries('{COUPLE}')",A))
        self.assertEqual(len(page),50)
        self.assertEqual(len(page[0]['content_plain']),180)
        last=page[-1]
        next_page=json.loads(sql(f"SELECT list_diary_entries('{COUPLE}','{last['entry_date']}','{last['id']}',50)",A))
        self.assertFalse({e['id'] for e in page}&{e['id'] for e in next_page})
        sql(f"UPDATE entries SET created_at=CASE WHEN id='{E[0]}' THEN '2026-02-01 23:00Z'::timestamptz ELSE '2026-02-02 01:00Z'::timestamptz END WHERE id IN('{E[0]}','{E[1]}')")
        sql(f"INSERT INTO media(entry_id,author_id,storage_path,media_type,mime_type,duration_ms) VALUES('{E[0]}','{B}','{B}/{E[0]}/memo.m4a','audio','audio/mp4',12000)")
        sql(f"UPDATE couples SET last_reveal_year=2026 WHERE id='{COUPLE}'")
        stats=json.loads(sql(f"SELECT get_reveal_stats('{COUPLE}',2026)",A))
        self.assertEqual(stats['partner_2_avg_hour'],3)
        self.assertEqual(stats['total_media_audio'],1)
        self.assertEqual(stats['total_audio_duration_ms'],12000)
    def test_canonical_delivery_rechecks_claims_and_active_token(self):
        self.register(A)
        sql("UPDATE push_devices SET created_at=now()-interval '2 days'")
        sql('SELECT prepare_maintenance()')
        job=sql("SELECT id FROM maintenance_jobs WHERE dedupe_key LIKE 'checkpoint:%' LIMIT 1")
        self.assertEqual(sql(f"SELECT can_deliver_notice('{job}')"),'t')
        occurrence=sql(f"SELECT split_part(dedupe_key,':',2) FROM maintenance_jobs WHERE id='{job}'")
        sql(f"SELECT claim_reveal_occurrence('{COUPLE}','{occurrence}')",A)
        self.assertEqual(sql(f"SELECT can_deliver_notice('{job}')"),'f')
        sql(f"SELECT register_push_device(gen_random_uuid(),'ExpoPushToken[bad]',true,'{B}')",A,ok=False)
    def test_invalid_token_receipt_does_not_delete_a_new_registration(self):
        self.register(A)
        sql(f"UPDATE entries SET is_draft=false WHERE id='{E[3]}'",B)
        job=json.loads(sql("SELECT row_to_json(j) FROM claim_maintenance(1) j"))
        self.register(A,token='ExpoPushToken[replacement]')
        sql(f"SELECT finish_maintenance('{job['id']}','{job['lease_id']}','invalid_token','DeviceNotRegistered')")
        self.assertEqual(sql('SELECT token FROM push_devices'),'ExpoPushToken[replacement]')
    def test_empty_and_tied_stats_have_stable_attribution(self):
        sql(f"UPDATE couples SET last_reveal_year=2026 WHERE id='{COUPLE}'")
        sql(f"DELETE FROM entries WHERE couple_id='{COUPLE}'")
        empty=json.loads(sql(f"SELECT calculate_reveal_stats('{COUPLE}',2026)"))
        self.assertEqual(empty['partner_1_entries'],0)
        self.assertIsNone(empty['longest_entry_author_id'])
        self.assertEqual(empty['total_audio_duration_ms'],0)
        sql(f"INSERT INTO entries(id,couple_id,author_id,entry_date,content_plain,is_draft) VALUES ('{E[0]}','{COUPLE}','{B}','2025-01-01','same words',false),('{E[1]}','{COUPLE}','{A}','2025-01-01','same words',false)")
        sql(f"INSERT INTO annual_reveal_entries(couple_id,reveal_year,entry_id) VALUES('{COUPLE}',2026,'{E[0]}'),('{COUPLE}',2026,'{E[1]}')")
        tied=json.loads(sql(f"SELECT calculate_reveal_stats('{COUPLE}',2026)"))
        self.assertEqual(tied['longest_entry_author_id'],B if E[0]<E[1] else A)
    def test_janitor_and_reference_commits_cannot_race(self):
        path=f'{B}/{E[2]}/staged.jpg'
        sql(f"SELECT queue_orphan_cleanup('{path}')")
        sql(f"INSERT INTO media(entry_id,author_id,storage_path,media_type,mime_type) VALUES('{E[2]}','{B}','{path}','image','image/jpeg')",B,ok=False)
        sql("UPDATE maintenance_jobs SET state='done' WHERE kind='cleanup'")
        sql(f"INSERT INTO media(entry_id,author_id,storage_path,media_type,mime_type) VALUES('{E[2]}','{B}','{path}','image','image/jpeg')",B)
        self.assertEqual(sql(f"SELECT queue_orphan_cleanup('{path}') IS NULL"),'t')
