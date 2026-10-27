# Batches 1 and 2: reveal guardrails and reliable entry saves

Implements the October audit's R01, R02, R06, R11–R14 and R16. R05 now
has frozen annual entry entitlements plus temporary anniversary-edit protection.
R07's writes are secured and immutable, but annual history creation and the
history UI still need Batch 3. Checkpoint media authorization is fixed; the
recipient reader still needs Batch 3's image/audio rendering.

## Behavior

- A recipient gets at most one checkpoint result per UTC day. Parallel calls,
  repeated taps, and lost responses return the canonical result, even if it is
  empty. A new claim needs an active due schedule belonging to that couple.
- Direct checkpoint/history/entitlement writes are forbidden. Both row access
  and Storage use the same recipient/partner authorization check.
- Annual opening captures a fixed set of eligible published entries. Publishing
  a backdated note afterward cannot add it to an old reveal. Existing legitimate
  duplicate checkpoint history is retained; malformed legacy rows grant no access.
- Stats use annual entitlements, and snapshots are computed by the server, never
  from caller JSON. Replays cannot replace the first stored timestamp/snapshot.
- Couple INSERT cannot set another partner or reveal fields. Membership checks
  lock users across both partner positions. Joining never cascades away a diary
  that already contains notes.
- Plain text is canonical; markup characters and paragraphs survive repeated
  saves. An edit must load both the entry and media successfully before saving.
- The editor persists account/couple/entry-scoped drafts and immutable pending
  save plans. Local attachments are copied into Documents before upload.
- Each save keeps the same entry/attachment/operation UUIDs until confirmed.
  Upload failures retain the draft. A single SQL transaction checks the loaded
  version and commits text, media metadata, removals, and publication. An
  operation receipt recovers a committed save whose response was lost. Deleted
  entries retain only a redacted receipt so a retry cannot resurrect them.
- Save/navigation/recording guards prevent ordinary exits during work; background
  and unexpected-unmount recording finalization attempt durable recovery.

## Verification

Run the app checks:

```sh
npm run validate
npm run test:ci
```

The database suite needs a **local disposable PostgreSQL database** whose name
starts with `lovecapsule_test_`. It drops and recreates schemas inside that database.
It refuses remote hosts and ordinary database names; never use a production URL.

```sh
createdb lovecapsule_test_local
LOVE_CAPSULE_TEST_DB='postgresql://localhost/lovecapsule_test_local' python3 scripts/test_database.py
```

The harness shims Supabase auth/storage and tests as authenticated/anon roles,
not the table owner. Migration 001 has a pre-existing forward policy reference;
the harness reorders that policy only in its in-memory scratch copy. All other
migrations are applied unchanged. An upgrade fixture checks old duplicate and
forged claims and existing annual history before the regression suite.

PR checks now include `dev` and run the database suite with PostgreSQL 17.
Client regressions cover failed edit loads, draft restoration, duplicate taps,
remount/retry, interrupted recordings, text round trips, failed media operations,
and Storage's legacy/new duplicate-upload errors.

## Deployment order and limits

1. Back up the database and review the migration list and existing membership /
   reveal history. Migration 011 stops on multiple active memberships rather than
   choosing which diary to delete. Resolve those manually if found.
2. Apply migrations **011 then 012** to staging; rehearse the reveal and save flows
   using two test accounts and physical iPhones. These changes have only been
   exercised in the local harness, not deployed to the live project.
3. Deploy the app only after those RPCs/tables exist. The old snapshot/claim RPC
   names remain, but invalid/off-day calls and arbitrary history writes now fail.
4. Check production migration parity before releasing through the established
   tag/TestFlight workflow. No Edge Function change is needed for these batches.

Checkpoint timezone/exact-time scheduling, annual event/history atomicity,
recipient reader/navigation, and production orphan cleanup are later batches.
Anniversary edits after a reveal are intentionally blocked until future-cycle
rescheduling has a safe API. February 29 behavior remains March 1.

Existing damaged diary text is not automatically rewritten: ambiguous legacy
HTML requires a backup and reviewed repair diff. The old unscoped
`new_entry_draft` value is retained and not automatically assigned to the current
account. It needs explicit account attribution before safe recovery. Recording
interruption/device lifecycle and push behavior still need physical-device tests.
