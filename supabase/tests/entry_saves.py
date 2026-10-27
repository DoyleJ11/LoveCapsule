import concurrent.futures
import json
import unittest
import reveal_guardrails as fixtures
from reveal_guardrails import A, B, COUPLE, sql

ENTRY = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
OP = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
MEDIA = 'ffffffff-ffff-ffff-ffff-ffffffffffff'


class EntrySaves(unittest.TestCase):
    def setUp(self):
        fixtures.RevealGuardrails.setUp(self)

    def save(self, expected=None, op=OP, plain='One <3\n\nTwo & three', media=None, user=A, entry=ENTRY, title='Memory', remove=None):
        fields = dict(couple_id=COUPLE, title=title, content_plain=plain, is_draft=False, entry_date='2026-10-26')
        version = f"'{expected}'" if expected else 'NULL'
        args = [f"'{op}'", f"'{entry}'", version, "'" + json.dumps(fields).replace("'", "''") + "'::jsonb",
                "'" + json.dumps(media or []).replace("'", "''") + "'::jsonb",
                "ARRAY[" + ','.join("'" + x + "'::uuid" for x in (remove or [])) + "]::uuid[]"]
        return json.loads(sql('SELECT save_entry(' + ','.join(args) + ')', user))

    def test_canonical_text_and_lost_response(self):
        first = self.save()
        second = self.save()
        self.assertEqual(first, second)
        self.assertEqual(first['entry']['content_plain'], 'One <3\n\nTwo & three')
        self.assertEqual(first['entry']['content_html'], '<p>One &lt;3</p><p></p><p>Two &amp; three</p>')
        self.assertEqual(first['entry']['word_count'], 5)
        self.assertEqual(sql(f"SELECT count(*) FROM entries WHERE id='{ENTRY}'"), '1')

    def test_parallel_create_is_one_entry_and_receipt(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.save(), range(4)))
        self.assertEqual(len({r['entry']['updated_at'] for r in results}), 1)
        self.assertEqual(sql('SELECT count(*) FROM entry_save_operations'), '1')

    def test_changed_operation_and_unknown_version_are_rejected(self):
        self.save()
        with self.assertRaises(AssertionError): self.save(plain='changed')
        with self.assertRaises(AssertionError): self.save(op='99999999-9999-9999-9999-999999999999')

    def test_two_device_conflict_keeps_newer_content(self):
        first = self.save()
        version = first['entry']['updated_at']
        second = self.save(expected=version, op='99999999-9999-9999-9999-999999999999', plain='newer')
        with self.assertRaises(AssertionError):
            self.save(expected=version, op='88888888-8888-8888-8888-888888888888', plain='stale')
        self.assertEqual(sql(f"SELECT content_plain FROM entries WHERE id='{ENTRY}'", A), 'newer')
        self.assertNotEqual(version, second['entry']['updated_at'])

    def test_attachment_failure_rolls_back_publication_and_content(self):
        with self.assertRaises(AssertionError):
            self.save(media=[dict(id=MEDIA, storage_path=f'{A}/{ENTRY}/{MEDIA}.jpg',media_type='image',mime_type='image/jpeg')])
        self.assertEqual(sql(f"SELECT count(*) FROM entries WHERE id='{ENTRY}'"), '0')
        self.assertEqual(sql('SELECT count(*) FROM entry_save_operations'), '0')

    def test_media_only_note_and_checked_removal(self):
        path = f'{A}/{ENTRY}/{MEDIA}.jpg'
        sql(f"INSERT INTO storage.objects(bucket_id,name) VALUES('entry-media','{path}')")
        result = self.save(plain='', title='', media=[dict(id=MEDIA,storage_path=path,media_type='image',mime_type='image/jpeg')])
        self.assertFalse(result['entry']['is_draft'])
        result = self.save(expected=result['entry']['updated_at'], op='99999999-9999-9999-9999-999999999999', remove=[MEDIA])
        self.assertEqual(result['removed_paths'], [path])
        self.assertEqual(sql(f"SELECT count(*) FROM media WHERE id='{MEDIA}'"), '0')

    def test_deleted_save_cannot_be_resurrected_by_retry(self):
        self.save()
        sql(f"DELETE FROM entries WHERE id='{ENTRY}'", A)
        recovered = self.save()
        self.assertTrue(recovered['entry']['deleted'])
        self.assertEqual(sql(f"SELECT count(*) FROM entries WHERE id='{ENTRY}'"), '0')
        self.assertNotIn('One <3', sql('SELECT result::text FROM entry_save_operations', A))

    def test_empty_and_foreign_edits_are_rejected(self):
        with self.assertRaises(AssertionError): self.save(plain='',title='')
        first = self.save()
        with self.assertRaises(AssertionError):
            self.save(expected=first['entry']['updated_at'],op='99999999-9999-9999-9999-999999999999',user=B)
        self.assertEqual(sql(f"SELECT author_id FROM entries WHERE id='{ENTRY}'"), A)


if __name__ == '__main__':
    unittest.main()
