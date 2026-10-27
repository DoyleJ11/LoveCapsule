"""Real Postgres/RLS regressions. Only run against the disposable harness database."""
import concurrent.futures
import json
import os
import subprocess
import unittest

from db_support import DB
A, B, C, D = [str(i) * 8 + '-' + str(i) * 4 + '-' + str(i) * 4 + '-' + str(i) * 4 + '-' + str(i) * 12 for i in range(1, 5)]
COUPLE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
E = [f'00000000-0000-0000-0000-{i:012}' for i in range(1, 6)]


def sql(statement, user=None, ok=True):
    prefix = "SET TIME ZONE 'UTC'; "
    if user:
        prefix += f"SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','{user}',false); "
    p = subprocess.run(['psql', DB, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', prefix + statement], capture_output=True, text=True)
    if ok and p.returncode:
        raise AssertionError(p.stderr)
    if not ok:
        assert p.returncode, 'Expected authorization/conflict failure: ' + statement
        return p.stderr
    lines = [s for s in p.stdout.splitlines() if s and s != user]
    return lines[-1] if lines else ''


class RevealGuardrails(unittest.TestCase):
    def setUp(self):
        sql(f"""TRUNCATE auth.users CASCADE;
        INSERT INTO auth.users(id) VALUES('{A}'),('{B}'),('{C}'),('{D}');
        INSERT INTO couples(id,partner_1_id,partner_2_id,anniversary_date) VALUES
        ('{COUPLE}','{A}','{B}','2020-03-01'),('{OTHER}','{C}','{D}','2020-03-01');
        INSERT INTO entries(id,couple_id,author_id,is_draft,entry_date,location_lat,location_lng) VALUES
        ('{E[0]}','{COUPLE}','{B}',false,'2026-02-01',47,-122),
        ('{E[1]}','{COUPLE}','{B}',false,'2026-02-02',null,null),
        ('{E[2]}','{COUPLE}','{B}',false,'2026-08-01',null,null),
        ('{E[3]}','{COUPLE}','{B}',true,'2026-02-01',null,null),
        ('{E[4]}','{OTHER}','{D}',false,'2026-02-01',null,null);
        INSERT INTO checkpoint_configs(couple_id,frequency,specific_date) VALUES ('{COUPLE}','specific_date',(now() AT TIME ZONE 'UTC')::date);
        INSERT INTO media(entry_id,author_id,storage_path,media_type,mime_type)
        SELECT id,author_id,author_id||'/'||id||'/photo.jpg','image','image/jpeg' FROM entries;
        TRUNCATE storage.objects;
        INSERT INTO storage.objects(bucket_id,name) SELECT 'entry-media',storage_path FROM media;""")

    def claim(self):
        return json.loads(sql(f"SELECT get_checkpoint_entry('{COUPLE}')", A))

    def test_repeat_nullable_entry(self):
        first, second = self.claim(), self.claim()
        self.assertEqual(first['entry']['id'], second['entry']['id'])
        self.assertTrue(second['already_revealed'])
        self.assertEqual(sql('SELECT count(*) FROM checkpoint_reveals'), '1')

    def test_parallel_claims(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: self.claim(), range(6)))
        self.assertEqual(len({r['entry']['id'] for r in results}), 1)
        self.assertEqual(sql('SELECT count(*) FROM checkpoint_reveals'), '1')

    def test_schedule_and_foreign_config(self):
        sql('UPDATE checkpoint_configs SET is_active=false')
        sql(f"SELECT get_checkpoint_entry('{COUPLE}')", A, ok=False)
        config = sql(f"INSERT INTO checkpoint_configs(couple_id,frequency,specific_date) VALUES('{OTHER}','specific_date',CURRENT_DATE) RETURNING id")
        sql(f"SELECT get_checkpoint_entry('{COUPLE}','{config}')", A, ok=False)

    def test_forged_checkpoint(self):
        sql(f"INSERT INTO checkpoint_reveals(couple_id,entry_id,revealed_to_user_id,checkpoint_date) VALUES('{COUPLE}','{E[4]}','{A}',CURRENT_DATE)", A, ok=False)
        # Even a legacy bad row cannot grant access through SELECT or history RPC.
        sql(f"INSERT INTO checkpoint_reveals(couple_id,entry_id,revealed_to_user_id,checkpoint_date) VALUES('{COUPLE}','{E[4]}','{A}',CURRENT_DATE)")
        self.assertEqual(sql(f"SELECT count(*) FROM entries WHERE id='{E[4]}'", A), '0')
        self.assertEqual(json.loads(sql(f"SELECT get_checkpoint_history('{COUPLE}')", A)), [])

    def test_checkpoint_attachments_and_drafts(self):
        result = self.claim()
        entry = result['entry']['id']
        self.assertEqual(sql(f"SELECT count(*) FROM media WHERE entry_id='{entry}'", A), '1')
        self.assertEqual(sql('SELECT count(*) FROM storage.objects', A), '1')
        self.assertEqual(sql(f"SELECT count(*) FROM entries WHERE id='{E[3]}'", A), '0')

    def test_sealed_stats_and_history_writes(self):
        sql(f"SELECT get_reveal_stats('{COUPLE}',2026)", A, ok=False)
        sql(f"SELECT save_reveal_snapshot('{COUPLE}',2099,'{{}}')", A, ok=False)
        sql(f"INSERT INTO reveal_history(couple_id,reveal_year,stats_snapshot) VALUES('{COUPLE}',2099,'{{}}')", A, ok=False)
        sql(f"SELECT get_reveal_stats('{OTHER}',2026)", A, ok=False)

    def test_annual_manifest_and_snapshot(self):
        sql(f"UPDATE couples SET last_reveal_year=2026 WHERE id='{COUPLE}'")
        stats = json.loads(sql(f"SELECT get_reveal_stats('{COUPLE}',2026)", A))
        self.assertEqual(stats['partner_2_entries'], 2)
        self.assertEqual(sql(f"SELECT count(*) FROM entries WHERE id='{E[2]}'", A), '0')
        sql(f"UPDATE couples SET anniversary_date='2020-12-31' WHERE id='{COUPLE}'", A, ok=False)
        sql(f"INSERT INTO entries(couple_id,author_id,is_draft,entry_date) VALUES('{COUPLE}','{B}',false,'2026-01-01')", B)
        self.assertEqual(sql('SELECT count(*) FROM entries', A), '2')
        sql(f"SELECT save_reveal_snapshot('{COUPLE}',2026,'{{\"fake\":true}}')", A)
        before = sql('SELECT row_to_json(reveal_history)::text FROM reveal_history')
        sql(f"SELECT save_reveal_snapshot('{COUPLE}',2026,'{{\"fake\":false}}')", A)
        self.assertEqual(before, sql('SELECT row_to_json(reveal_history)::text FROM reveal_history'))
        self.assertNotIn('fake', before)

    def test_forged_pairing_and_multiple_memberships(self):
        sql(f"INSERT INTO couples(partner_1_id,partner_2_id,last_reveal_year) VALUES('{A}','{D}',2099)", A, ok=False)
        sql(f"INSERT INTO couples(partner_1_id) VALUES('{A}')", A, ok=False)

    def test_join_keeps_existing_notes_and_invalid_code(self):
        sql(f"DELETE FROM couples WHERE id='{COUPLE}'")
        old = sql(f"INSERT INTO couples(partner_1_id) VALUES('{A}') RETURNING id", A)
        sql(f"INSERT INTO entries(couple_id,author_id) VALUES('{old}','{A}')", A)
        sql(f"DELETE FROM couples WHERE id='{OTHER}'")
        code = sql(f"INSERT INTO couples(partner_1_id) VALUES('{C}') RETURNING invite_code", C)
        sql(f"SELECT join_couple_by_code('invalid')", A, ok=False)
        sql(f"SELECT join_couple_by_code('{code}')", A, ok=False)
        self.assertEqual(sql(f"SELECT count(*) FROM entries WHERE couple_id='{old}'", A), '1')
        sql(f"DELETE FROM entries WHERE couple_id='{old}'", A)
        sql(f"SELECT join_couple_by_code('{code}')", A)
        self.assertEqual(sql('SELECT count(*) FROM couples', A), '1')

    def test_concurrent_membership_changes(self):
        sql('DELETE FROM couples')
        codes = [sql(f"INSERT INTO couples(partner_1_id) VALUES('{u}') RETURNING invite_code", u) for u in (C,D)]
        def join(code):
            try:
                sql(f"SELECT join_couple_by_code('{code}')", A)
                return True
            except AssertionError:
                return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(join, codes))
        self.assertEqual(sum(results), 1)
        self.assertEqual(sql('SELECT count(*) FROM couples', A), '1')

    def test_anonymous_and_entitlement_writes(self):
        sql(f"SET ROLE anon; SELECT get_checkpoint_entry('{COUPLE}')", ok=False)
        sql(f"INSERT INTO annual_reveal_entries(couple_id,entry_id,reveal_year) VALUES('{COUPLE}','{E[0]}',2026)", A, ok=False)
        sql(f"SELECT save_reveal_snapshot('{COUPLE}',1,'{{}}')", A, ok=False)

    def test_annual_notes_are_not_random_peeks(self):
        sql(f"UPDATE couples SET last_reveal_year=2026 WHERE id='{COUPLE}'")
        self.assertEqual(self.claim()['entry']['id'], E[2])

    def test_claim_survives_schedule_deletion(self):
        config = sql(f"SELECT id FROM checkpoint_configs WHERE couple_id='{COUPLE}'")
        first = self.claim()
        sql('DELETE FROM checkpoint_configs')
        retry = json.loads(sql(f"SELECT get_checkpoint_entry('{COUPLE}','{config}')", A))
        self.assertEqual(first['entry']['id'], retry['entry']['id'])
        self.assertTrue(retry['already_revealed'])

    def test_recurring_schedule_decisions(self):
        sql(f"DELETE FROM checkpoint_configs; INSERT INTO checkpoint_configs(couple_id,frequency,day_of_month,months) VALUES('{COUPLE}','quarterly',15,ARRAY[3,6,9,12])")
        self.assertEqual(sql("SELECT checkpoint_due(cc,'2026-03-15') FROM checkpoint_configs cc", A), 't')
        self.assertEqual(sql("SELECT checkpoint_due(cc,'2026-04-15') FROM checkpoint_configs cc", A), 'f')
        self.assertEqual(sql("SELECT checkpoint_due(cc,'2026-03-14') FROM checkpoint_configs cc", A), 'f')
        sql("UPDATE checkpoint_configs SET frequency='monthly',months=null")
        self.assertEqual(sql("SELECT checkpoint_due(cc,'2026-04-15') FROM checkpoint_configs cc", A), 't')
        sql("UPDATE checkpoint_configs SET frequency='semi_annual',months=ARRAY[6,12]")
        self.assertEqual(sql("SELECT checkpoint_due(cc,'2026-06-15') FROM checkpoint_configs cc", A), 't')
        self.assertEqual(sql("SELECT checkpoint_due(cc,'2026-03-15') FROM checkpoint_configs cc", A), 'f')

    def test_empty_claim_is_retry_safe(self):
        sql(f"UPDATE entries SET is_draft=true WHERE couple_id='{COUPLE}'")
        self.assertTrue(self.claim()['no_entries'])
        sql(f"UPDATE entries SET is_draft=false WHERE id='{E[0]}'")
        self.assertTrue(self.claim()['no_entries'])


if __name__ == '__main__':
    unittest.main()
