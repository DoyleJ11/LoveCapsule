# Batches 3 and 4: reveal events and exact times

This change depends on Batch 1/2 PR #33. It adds migrations 014 and 015 after the existing 011–013; do not renumber applied migrations. Nothing in this branch deploys a production database, Edge Function, or app.

## Behavior

- Annual opening saves the boundary, eligible note IDs, original opening time and recap together. Retry/open from another device returns the same event. Readers use these IDs across calendar years, with partner notes selected by default. Recap replay does not open anything new.
- Recaps preserve opening statistics. Libraries show the saved notes' **current** text and attachments and honor later drafts/deletions. Historical content versioning is outside this change.
- `published_at` is stamped by the database on first publication. Editing a diary date cannot move a note into an opened event. Late opening includes notes published by its scheduled boundary; later notes wait for a later cycle.
- First annual opening catches up to the latest anniversary at or after the relationship start year. Later missed years open in order. February 29 becomes March 1 in non-leap years. Future anniversary changes do not change opened events.
- Custom checkpoints reveal one random partner note, not a selected note. One-time dates save a resolved instant plus timezone. Recurring times follow the schedule's named timezone, regardless of travel. Missed occurrences stay available. A due occurrence remains saved when its rule is edited, paused or deleted; changes cancel only future occurrences.
- A repeated wall time uses the later instant. One-time DST gaps are rejected; recurring gaps move forward by the clock change. Settings explains this before saving. Dates and time fields are serialized as wall fields, without UTC ISO date slicing.
- Distinct schedules can grant separate notes on the same day. Double taps/retries use the same occurrence ID and recipient receipt, including empty results. A stable create ID prevents lost schedule-save responses from creating duplicates. Editing a rule at the same instant preserves its occurrence identity.
- Overview/eligibility use server time. Shared state refreshes on tab focus, foreground, the next deadline and every 30 seconds while active. This does not depend on push or Realtime configuration. Account/couple changes discard reader state, signed URLs and stale requests.

## Migration and rollout

1. Back up and inspect deployed migration history. Apply the upstream 011 and Batch 1/2 migrations 012–013 first if missing. Dry-run 014–015 on a restored staging copy. Review existing history, membership and malformed schedules before production.
2. Apply **014_reveal_events** and **015_exact_reveal_occurrences**. Existing date-only schedules retain **UTC midnight** until explicitly edited, rather than silently taking the first device's timezone. Recurring backlog begins on migration day; existing one-time dates retain their original instant. Incomplete legacy schedules stay visible but paused with a repair message.
3. Legacy annual entitlements and snapshots remain intact. Missing history for known entitlement years / the last committed opening is repaired and marked `legacy`; `couple.updated_at` is only an approximate historical opening time. Previously published notes use `created_at` because the original first-publication time was not recorded. No migration can reconstruct unknown missing years or historical content versions. Existing duplicate checkpoint history is retained, while legacy daily receipts prevent another claim during upgrade.
4. Deploy **check-anniversary** from this branch immediately after the migrations. It delegates to the authenticated transactional RPC; no service key is needed in its code. The old Edge Function's due transition also finalizes history through the new trigger, and cannot bypass a configured future instant. Old direct schedule writes are intentionally denied; use the new app for schedule edits. Old date-only client display can remain inaccurate until updated.
5. Release the app through the repository's normal TestFlight workflow after staging verification. The app requires the new RPCs. Confirm deployed migrations/function versions and the exact build; database push alone does not deploy Edge Functions.
6. Rehearse on two iPhones with test accounts: before/at/after a deadline; different device timezones and wrong clock; foreground after missing a deadline; concurrent taps and lost responses; current year locked while opening history; non-January cycle tail; checkpoint photo/audio and expired links; edit a future schedule on the other phone; unpair/sign out while a request is pending. Check dark mode, VoiceOver, large text and silent-mode audio. Physical/native behavior has not been verified by the automated suites.

Roll forward with a corrective migration if needed. Do not roll back by deleting reveal events/receipts or restoring broad partner media access; this could erase history or grant another random note. Pause a faulty future rule using the versioned schedule API and retain already due/opened receipts.

## Reproducible checks

`npm run validate` and `npm run test:ci` cover TypeScript, hooks, readers, forms and flow. `scripts/test_database.py` bootstraps all migrations and upgrade fixtures and runs SQL/RLS/concurrency tests under real authenticated/anonymous roles. It requires `LOVE_CAPSULE_TEST_DB` to name a local disposable database beginning with `lovecapsule_test_`; it refuses remote/production targets. GitHub PR checks run both suites against a clean npm install and PostgreSQL 17.
