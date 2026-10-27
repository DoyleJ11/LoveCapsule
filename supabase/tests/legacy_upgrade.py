"""Upgrade fixture: preserve legitimate extra peeks while revoking forged ones."""
import json
import reveal_guardrails as fixtures
from reveal_guardrails import A, COUPLE, E, sql


def prepare():
    fixtures.RevealGuardrails().setUp()
    sql(f"""UPDATE entries SET entry_date='2025-02-01' WHERE id='{E[0]}';
    UPDATE couples SET last_reveal_year=2026 WHERE id='{COUPLE}';
    INSERT INTO reveal_history(couple_id,reveal_year,stats_snapshot) VALUES('{COUPLE}',2025,'{{}}'),('{COUPLE}',2026,'{{}}');
    INSERT INTO checkpoint_reveals(couple_id,entry_id,revealed_to_user_id,checkpoint_date,revealed_at) VALUES
    ('{COUPLE}','{E[0]}','{A}',CURRENT_DATE,now()-interval '2 minutes'),
    ('{COUPLE}','{E[1]}','{A}',CURRENT_DATE,now()-interval '1 minute'),
    ('{COUPLE}','{E[4]}','{A}',CURRENT_DATE,now());""")


def verify():
    assert sql('SELECT count(*) FROM checkpoint_reveals') == '3', 'Never delete already-revealed legitimate history during an upgrade'
    assert sql('SELECT count(*) FROM checkpoint_days') == '1', 'Canonical daily ledger backfill'
    result = json.loads(sql(f"SELECT get_checkpoint_entry('{COUPLE}')", A))
    assert result['already_revealed'] and result['entry']['id'] == E[0]
    assert len(json.loads(sql(f"SELECT get_checkpoint_history('{COUPLE}')", A))) == 2
    assert sql(f"SELECT count(*) FROM entries WHERE id='{E[4]}'", A) == '0'
    assert sql(f"SELECT reveal_year FROM annual_reveal_entries WHERE entry_id='{E[0]}'") == '2025'
    assert sql(f"SELECT reveal_year FROM annual_reveal_entries WHERE entry_id='{E[1]}'") == '2026'
