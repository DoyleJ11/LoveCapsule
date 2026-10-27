"""Run before/after 014 and 015 with an actual Batch 1/2-shaped database."""
import json
import reveal_guardrails as f

def prepare():
    f.RevealGuardrails().setUp()
    f.sql(f"UPDATE couples SET last_reveal_year=2026 WHERE id='{f.COUPLE}'")
    # Reproduce old split transaction: access committed but snapshot never saved.
    f.sql('DELETE FROM reveal_history')
    f.sql(f"INSERT INTO checkpoint_configs(couple_id,frequency,day_of_month) VALUES('{f.COUPLE}','quarterly',15)")
    claim=json.loads(f.sql(f"SELECT get_checkpoint_entry('{f.COUPLE}')",f.A))
    assert claim['entry']['id']==f.E[2]

def verify_events():
    event=json.loads(f.sql(f"SELECT read_annual_event('{f.COUPLE}',2026)",f.A))
    assert event['legacy']
    assert len(event['entries'])==2
    assert event['stats_snapshot']['partner_2_entries']==2
    assert f.sql('SELECT count(*) FROM reveal_history')=='1'

def verify_occurrences():
    result=json.loads(f.sql(f"SELECT get_reveal_overview('{f.COUPLE}')",f.A))
    assert result['checkpoints']==[]
    assert f.sql("SELECT count(*) FROM checkpoint_configs WHERE NOT is_active AND schedule_error IS NOT NULL")=='1'
    ident=f.sql('SELECT id FROM reveal_occurrences LIMIT 1')
    claim=json.loads(f.sql(f"SELECT claim_reveal_occurrence('{f.COUPLE}','{ident}')",f.A))
    assert claim['already_revealed'] and claim['entry']['id']==f.E[2]
    assert f.sql('SELECT count(*) FROM checkpoint_reveals')=='1'
