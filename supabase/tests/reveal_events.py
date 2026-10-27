"""Event, calendar, exact-time and rolling-upgrade regressions on real PG/RLS."""
import concurrent.futures
import json
import reveal_guardrails as fixtures
from reveal_guardrails import sql, A, B, C, COUPLE, OTHER, E

import unittest
class EventTests(unittest.TestCase):
    setUp = fixtures.RevealGuardrails.setUp

    def overview(self, user=A):
        return json.loads(sql(f"SELECT get_reveal_overview('{COUPLE}')", user))

    def schedule(self, local=None, zone='UTC', ident=None, version=None, freq='specific_date', day=15):
        local = local or sql("SELECT to_char(now() AT TIME ZONE 'UTC' - interval '1 minute','YYYY-MM-DD HH24:MI')")
        date, time = local.split(' ')
        config = json.dumps({'frequency':freq,'specific_date':date if freq=='specific_date' else None,
            'reveal_time':time,'timezone':zone,'day_of_month':day,'is_active':True,'label':'Our moment'})
        return json.loads(sql(f"SELECT row_to_json(save_checkpoint_schedule('{COUPLE}',{repr(ident) if ident else 'NULL'},{version or 'NULL'},'{config}'::jsonb))", A))

    def claim(self, ident, user=A):
        return json.loads(sql(f"SELECT claim_reveal_occurrence('{COUPLE}','{ident}')", user))

    def test_atomic_event_cycle_tail_and_retry(self):
        sql('DELETE FROM checkpoint_configs')
        sql(f"UPDATE couples SET anniversary_date='2020-06-01',last_reveal_year=2024 WHERE id='{COUPLE}'")
        sql(f"ALTER TABLE entries DISABLE TRIGGER stamp_publication; UPDATE entries SET published_at='2024-12-01',entry_date='2024-12-01' WHERE id='{E[0]}'; ALTER TABLE entries ENABLE TRIGGER stamp_publication")
        results = []
        def open_event(_):
            return json.loads(sql(f"SELECT open_annual_event('{COUPLE}',2025)", A))
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(open_event,range(4)))
        self.assertEqual(len({r['id'] for r in results}),1)
        self.assertEqual(len({r['revealed_at'] for r in results}),1)
        event = results[0]
        self.assertEqual([e['id'] for e in event['entries']],[E[0]])
        self.assertEqual(event['stats_snapshot']['partner_2_entries'],1)
        self.assertEqual(sql('SELECT count(*) FROM reveal_history'), '2')
        self.assertEqual(self.overview()['annual_history'][0]['year'],2025)
        sql(f"SELECT read_annual_event('{COUPLE}',2025)", C, ok=False)
        sql(f"SELECT open_annual_event('{COUPLE}',2099)", A, ok=False)

    def test_history_snapshot_survives_edits_and_schedule_changes(self):
        sql(f"UPDATE couples SET last_reveal_year=2026 WHERE id='{COUPLE}'")
        original = json.loads(sql(f"SELECT read_annual_event('{COUPLE}',2026)", A))
        sql(f"UPDATE entries SET word_count=9999,entry_date='2026-12-31' WHERE id='{E[0]}'", B)
        sql(f"SELECT save_annual_schedule('{COUPLE}',1,'2020-12-01','19:30','America/Los_Angeles')", A)
        after = json.loads(sql(f"SELECT read_annual_event('{COUPLE}',2026)", A))
        self.assertEqual(original['id'],after['id'])
        self.assertEqual(original['stats_snapshot'],after['stats_snapshot'])
        self.assertEqual(original['ready_at'],after['ready_at'])
        self.assertEqual({e['id'] for e in original['entries']},{e['id'] for e in after['entries']})
        sql(f"SELECT save_annual_schedule('{COUPLE}',1,'2020-12-01','19:30','UTC')", B,ok=False)
        sql(f"DELETE FROM entries WHERE id='{E[0]}'", B)
        self.assertEqual(json.loads(sql(f"SELECT get_reveal_stats('{COUPLE}',2026)", A)),original['stats_snapshot'])

    def test_publication_is_server_controlled_and_backdating_does_not_unlock(self):
        sql(f"UPDATE couples SET last_reveal_year=2026 WHERE id='{COUPLE}'")
        sql(f"UPDATE entries SET is_draft=false,entry_date='2000-01-01',published_at='2000-01-01' WHERE id='{E[3]}'", B)
        self.assertEqual(sql(f"SELECT count(*) FROM entries WHERE id='{E[3]}'", A),'0')
        self.assertEqual(sql(f"SELECT published_at > '2026-03-01' FROM entries WHERE id='{E[3]}'", B),'t')
        sql(f"UPDATE entries SET published_at='2000-01-01' WHERE id='{E[3]}'", B)
        self.assertEqual(sql(f"SELECT published_at > '2026-03-01' FROM entries WHERE id='{E[3]}'", B),'t')

    def test_dst_gap_overlap_and_non_hour_transition(self):
        sql("SELECT resolve_reveal_time('2026-03-08 02:30','America/Los_Angeles')",ok=False)
        self.assertEqual(sql("SELECT resolve_reveal_time('2026-03-08 02:30','America/Los_Angeles',false)"),'2026-03-08 10:30:00+00')
        self.assertEqual(sql("SELECT resolve_reveal_time('2026-11-01 01:30','America/Los_Angeles')"),'2026-11-01 09:30:00+00')
        self.assertEqual(sql("SELECT resolve_reveal_time('2026-04-05 01:45','Australia/Lord_Howe')"),'2026-04-04 15:15:00+00')
        self.assertEqual(sql("SELECT resolve_reveal_time('2027-01-01 00:30','Pacific/Auckland')"),'2026-12-31 11:30:00+00')
        sql("SELECT resolve_reveal_time('2026-01-01','Not/A_Zone')",ok=False)

    def test_exact_boundary_missed_reveal_and_two_same_day_schedules(self):
        sql('DELETE FROM checkpoint_configs')
        first = self.schedule()
        second = self.schedule()
        pending = self.overview()['checkpoints']
        self.assertEqual(len(pending),2)
        ids = [p['id'] for p in pending]
        self.assertNotEqual(self.claim(ids[0])['entry']['id'],self.claim(ids[1])['entry']['id'])
        self.assertTrue(self.claim(ids[0])['already_revealed'])
        self.assertEqual(len(self.overview()['checkpoint_history']),2)
        # Missed yesterday remains ready; a future instant cannot be claimed.
        yesterday = sql("SELECT to_char(now() AT TIME ZONE 'UTC'-interval '1 day','YYYY-MM-DD HH24:MI')")
        self.schedule(yesterday)
        past = self.overview()['checkpoints'][0]
        self.assertIsNotNone(self.claim(past['id'])['entry'])
        self.schedule(sql("SELECT to_char(now() AT TIME ZONE 'UTC'+interval '1 day','YYYY-MM-DD HH24:MI')"))
        future = self.overview()['checkpoints'][0]
        sql(f"SELECT claim_reveal_occurrence('{COUPLE}','{future['id']}')", A,ok=False)

    def test_parallel_occurrence_claims_empty_retries_and_authorization(self):
        sql('DELETE FROM checkpoint_configs')
        self.schedule()
        ident = self.overview()['checkpoints'][0]['id']
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            claims=list(pool.map(lambda _: self.claim(ident),range(6)))
        self.assertEqual(len({c['entry']['id'] for c in claims}),1)
        self.assertEqual(len({c['opened_at'] for c in claims}),1)
        sql(f"SELECT claim_reveal_occurrence('{COUPLE}','{ident}')", C,ok=False)
        sql(f"SET ROLE anon; SELECT claim_reveal_occurrence('{COUPLE}','{ident}')",ok=False)
        sql('TRUNCATE entries CASCADE')
        self.assertTrue(self.claim(ident)['no_entries'])
        self.assertTrue(self.claim(ident)['already_revealed'])
        sql(f"INSERT INTO occurrence_claims(occurrence_id,recipient_id) VALUES('{ident}','{B}')", A,ok=False)

    def test_edit_versions_preserve_due_and_cancel_future(self):
        sql('DELETE FROM checkpoint_configs')
        old = self.schedule()
        ident = self.overview()['checkpoints'][0]['id']
        tomorrow = sql("SELECT to_char(now() AT TIME ZONE 'UTC'+interval '1 day','YYYY-MM-DD HH24:MI')")
        changed = self.schedule(tomorrow,ident=old['id'],version=1)
        self.assertEqual(changed['version'],2)
        self.assertEqual(len(self.overview()['checkpoints']),2)
        self.assertIsNotNone(self.claim(ident)['entry'])
        sql(f"SELECT delete_checkpoint_schedule('{COUPLE}','{old['id']}',1)", A,ok=False)
        sql(f"SELECT delete_checkpoint_schedule('{COUPLE}','{old['id']}',2)", A)
        self.assertTrue(self.claim(ident)['already_revealed'])
        self.assertEqual(self.overview()['checkpoints'],[])
        self.assertEqual(self.overview()['checkpoint_history'][0]['label'],'Our moment')

    def test_future_start_year_and_february_29(self):
        sql(f"UPDATE couples SET anniversary_date='2030-02-28' WHERE id='{COUPLE}'")
        self.assertEqual(self.overview()['annual']['year'],2030)
        self.assertFalse(self.overview()['annual']['is_ready'])
        self.assertEqual(sql("SELECT anniversary_in_year('2024-02-29',2025)"),'2025-03-01')
        sql(f"SELECT open_annual_event('{COUPLE}',2026)", A,ok=False)

    def test_recurring_rules_resolve_local_times_and_do_not_repeat_one_offs(self):
        sql('DELETE FROM checkpoint_configs')
        config=self.schedule('2026-01-01 19:30',zone='America/Los_Angeles',freq='monthly',day=15)
        self.overview()
        self.assertEqual(sql(f"SELECT bool_and((due_at AT TIME ZONE timezone)::time='19:30') FROM reveal_occurrences WHERE config_id='{config['id']}'"),'t')
        self.assertEqual(sql(f"SELECT count(*) FROM reveal_occurrences WHERE config_id='{config['id']}' AND due_at > now()"),'1')
        one=self.schedule('2025-01-01 19:30',zone='Pacific/Auckland')
        self.overview()
        self.assertEqual(sql(f"SELECT count(*) FROM reveal_occurrences WHERE config_id='{one['id']}'"),'1')
        sql(f"INSERT INTO checkpoint_configs(couple_id,frequency) VALUES('{COUPLE}','monthly')", A,ok=False)

    def test_legacy_daily_receipt_cannot_be_reclaimed_after_upgrade(self):
        sql(f"UPDATE checkpoint_configs SET legacy_schedule=true")
        first=json.loads(sql(f"SELECT get_checkpoint_entry('{COUPLE}')", A))
        # Simulate upgrading while a valid daily receipt already exists.
        sql('DELETE FROM reveal_occurrences')
        overview=self.overview()
        self.assertEqual(overview['checkpoints'],[])
        ident=sql('SELECT id FROM reveal_occurrences LIMIT 1')
        again=self.claim(ident)
        self.assertEqual(again['entry']['id'],first['entry']['id'])
        self.assertTrue(again['already_revealed'])
        self.assertEqual(sql('SELECT count(*) FROM checkpoint_reveals'),'1')

    def test_stable_schedule_create_and_same_instant_edits_are_retry_safe(self):
        sql('DELETE FROM checkpoint_configs')
        ident='cccccccc-cccc-cccc-cccc-cccccccccccc'
        local=sql("SELECT to_char(now() AT TIME ZONE 'UTC'-interval '1 minute','YYYY-MM-DD HH24:MI')")
        first=self.schedule(local,ident=ident)
        again=self.schedule(local,ident=ident)
        self.assertEqual(first['id'],again['id'])
        occurrence=self.overview()['checkpoints'][0]['id']
        self.claim(occurrence)
        self.schedule(local,ident=ident,version=1)
        self.assertEqual(self.overview()['checkpoints'],[])
        self.assertEqual(sql('SELECT count(*) FROM reveal_occurrences'),'1')
        self.assertTrue(self.claim(occurrence)['already_revealed'])
        self.assertEqual(sql('SELECT count(*) FROM checkpoint_reveals'),'1')

    def test_exact_server_boundary_and_legacy_edge_finalization(self):
        ident='dddddddd-dddd-dddd-dddd-dddddddddddd'
        result=sql(f"""BEGIN;
          INSERT INTO reveal_occurrences(id,couple_id,version,due_at,timezone) VALUES('{ident}','{COUPLE}',1,now(),'UTC');
          SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','{A}',true);
          SELECT claim_reveal_occurrence('{COUPLE}','{ident}'); COMMIT;""")
        self.assertIsNotNone(json.loads(result)['entry'])
        # Old Edge Function used a service role without auth.uid(): the trigger
        # must still atomically finalize a valid due opening during rollout.
        sql(f"SET ROLE service_role; UPDATE couples SET last_reveal_year=2026 WHERE id='{COUPLE}'")
        event=json.loads(sql(f"SELECT read_annual_event('{COUPLE}',2026)",A))
        self.assertEqual(len(event['entries']),2)
        self.assertIsNotNone(event['revealed_at'])
        sql(f"SELECT calculate_reveal_stats('{COUPLE}',2026)",A,ok=False)
        sql(f"SELECT materialize_reveal_occurrences('{COUPLE}')",A,ok=False)

    def test_month_end_recurring_days_clamp_without_spilling_or_duplicates(self):
        sql('DELETE FROM checkpoint_configs')
        # Materialize a fixed historical range, independent of the test clock.
        for day in (29, 30, 31):
            config = self.schedule('2024-01-01 19:30', zone='America/Los_Angeles', freq='monthly', day=day)
            sql(f"UPDATE checkpoint_configs SET starts_on='2024-01-01',version_started_at='2024-01-01' WHERE id='{config['id']}'")
            self.overview()
            self.overview()
            dates = json.loads(sql(f"SELECT json_agg((due_at AT TIME ZONE timezone)::date ORDER BY due_at) FROM reveal_occurrences WHERE config_id='{config['id']}'"))
            self.assertIn('2024-02-29', dates)
            self.assertIn('2025-02-28', dates)
            self.assertIn('2024-04-' + str(min(day, 30)), dates)
            self.assertNotIn('2024-03-01', dates)
            self.assertEqual(len(dates), len(set(date[:7] for date in dates)))
            self.assertEqual(sql(f"SELECT bool_and((due_at AT TIME ZONE timezone)::time='19:30') FROM reveal_occurrences WHERE config_id='{config['id']}'"), 't')
            self.assertEqual(sql(f"SELECT count(*) FROM reveal_occurrences WHERE config_id='{config['id']}' AND due_at > now()"), '1')
        for invalid in (0, 32):
            with self.assertRaises(AssertionError):
                self.schedule(freq='monthly', day=invalid)

    def test_month_end_quarterly_semiannual_and_claims_survive_edits(self):
        sql('DELETE FROM checkpoint_configs')
        for frequency, months in [('quarterly', [3, 6, 9, 12]), ('semi_annual', [6, 12])]:
            config = self.schedule('2024-01-01 12:00', freq=frequency, day=31)
            sql(f"UPDATE checkpoint_configs SET starts_on='2024-01-01',version_started_at='2024-01-01' WHERE id='{config['id']}'")
            overview = self.overview()
            self.assertEqual(sql(f"SELECT bool_and(extract(month FROM due_at AT TIME ZONE timezone)::int = ANY(ARRAY{months})) FROM reveal_occurrences WHERE config_id='{config['id']}'"), 't')
            self.assertEqual(sql(f"SELECT count(*) FROM reveal_occurrences WHERE config_id='{config['id']}' AND (due_at AT TIME ZONE timezone)::date='2024-06-30'"), '1')
            occurrence = next(item['id'] for item in overview['checkpoints'] if item['id'] == sql(f"SELECT id FROM reveal_occurrences WHERE config_id='{config['id']}' AND due_at < now() ORDER BY due_at LIMIT 1"))
            original = self.claim(occurrence)
            self.schedule('2024-01-01 12:00', ident=config['id'], version=1, freq=frequency, day=30)
            self.assertTrue(self.claim(occurrence)['already_revealed'])
            self.assertEqual(self.claim(occurrence)['entry'], original['entry'])

    def test_foreign_legacy_schedule_cannot_leak_its_label(self):
        foreign=sql(f"INSERT INTO checkpoint_configs(couple_id,frequency,specific_date,label) VALUES('{OTHER}','specific_date',CURRENT_DATE,'Private foreign label') RETURNING id")
        sql(f"INSERT INTO checkpoint_reveals(couple_id,entry_id,revealed_to_user_id,checkpoint_date,checkpoint_config_id) VALUES('{COUPLE}','{E[0]}','{A}',CURRENT_DATE,'{foreign}')")
        history=json.loads(sql(f"SELECT get_checkpoint_history('{COUPLE}')",A))
        self.assertIsNone(history[0]['config_label'])
        self.assertNotIn('Private foreign label',json.dumps(self.overview()))

    def test_legacy_injected_author_is_not_in_an_annual_event(self):
        sql(f"UPDATE entries SET couple_id='{COUPLE}',location_lat=1,location_lng=2 WHERE id='{E[4]}'")
        sql(f"UPDATE couples SET last_reveal_year=2026 WHERE id='{COUPLE}'")
        event=json.loads(sql(f"SELECT read_annual_event('{COUPLE}',2026)",A))
        self.assertNotIn(E[4],[e['id'] for e in event['entries']])
        self.assertEqual(event['stats_snapshot']['unique_location_count'],1)
