#!/usr/bin/env python3
"""Bootstrap and test ONLY a local, explicitly disposable database."""
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'supabase/tests'))
from db_support import DB  # validates host and disposable name before any write


def run(statement):
    subprocess.run(['psql', DB, '-X', '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, check=True, stdout=subprocess.DEVNULL)


run('''DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS storage CASCADE;
DROP SCHEMA public CASCADE; CREATE SCHEMA public;
CREATE SCHEMA auth; CREATE SCHEMA storage;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_user_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon,authenticated,service_role;
''')
for migration in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
    source = migration.read_text()
    if migration.name.startswith('011_'):
        import legacy_upgrade
        legacy_upgrade.prepare()
    if migration.name.startswith('001_'):
        # Scratch-only ordering shim. Never rewrite an applied migration.
        start = source.index('CREATE POLICY "Users can view partner profile"')
        end = source.index('CREATE POLICY "Users can update own profile"')
        policy = source[start:end]
        source = source[:start] + source[end:] + '\n' + policy
    run(source)
    if migration.name.startswith('011_'):
        legacy_upgrade.verify()
        print('Legacy upgrade fixture: passed', flush=True)
suite = unittest.TestSuite()
for name in ('reveal_guardrails', 'entry_saves'):
    suite.addTests(unittest.defaultTestLoader.loadTestsFromName(name))
sys.exit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
