#!/usr/bin/env python3
"""Print SQL for a NEW empty Supabase public app schema. Never run on existing data.
Auth/Storage must already be supplied by Supabase. See docs/reveal-rollout.md.
"""
import pathlib
from migration_source import migration_source
root = pathlib.Path(__file__).resolve().parents[1]
print('-- EMPTY app schema only. Review output before execution. Existing installations use db push.')
for path in sorted((root / 'supabase/migrations').glob('*.sql')):
    print('-- ' + path.name + '\nBEGIN;\n' + migration_source(path) + '\nCOMMIT;')
