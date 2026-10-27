# LoveCapsule stabilization: test and rollout guide

Batches 5/6 build on PR #34 and PR #33, which must be reviewed/merged in order. Migrations 016–017 follow 011–015; never renumber or rewrite applied migrations. This guide covers staging tests, database and Edge Function deployment, worker scheduling, and TestFlight installation. No production migration, function deployment, push send, or EAS build was performed during implementation.

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

## Batches 5 and 6 behavior and limits

- Entry deletion removes records transactionally and saves canonical full media paths before cascades. Unpair deletes the entire shared diary, reveal history, schedules and invite; it affects both partners. Account deletion also queues Auth user deletion and disables that account’s devices. The other partner’s account remains. Offer each other a chance to save wanted memories first; a self-service export is not implemented.
- Storage and Auth are external services. They run through a service-only durable queue with five-minute leases, bounded retries/backoff and stable deletion receipts. `records_deleted` confirms the logical deletion; `cleanup_pending` is not physical completion. Failed jobs require operator attention. UI wording says cleanup is queued. A newly issued signed media link can remain usable until it expires or the blob is removed; SQL access revocation is immediate. Backup retention follows your Supabase project policy, not this queue.
- A janitor discovers unreferenced objects in the app’s bucket/UUID namespace after a 24-hour staging grace. It uses the Storage API, never deletes only `storage.objects` metadata. Do not intentionally leave an uncommitted upload retry idle for more than 24 hours: its local draft survives but its uploaded blob may be collected. Retrying the preserved save plan re-uploads its local files. A path actively being collected cannot be attached until cleanup finishes; this prevents a worker race from deleting a newly committed attachment.
- Notifications require explicit opt-in on each phone/account. Foreground/token refresh does not prompt or undo Disable. First publication queues one generic new-note notice; edits/re-publishing do not. Due reveal notices use server readiness, deduplicated per occurrence/device. Claimed, cancelled, rescheduled or inactive-recipient jobs are checked again before sending. Unlocking still works with notifications denied, delayed, offline or disabled.
- Expo tickets and later receipts are tracked separately. Neither proves the user saw a notification. A worker crash/lost provider response can still cause a duplicate generic push: Expo does not provide an exactly-once send transaction with Postgres. Duplicate delivery cannot claim a second note. Inactive registrations expire after seven days without refresh. The next opted-in foreground registers again.
- Sessions and draft text migrate from legacy plaintext into chunked Keychain storage; failed/incomplete writes are surfaced and never silently replaced by a blank draft. Sign-out retains account-scoped drafts for recovery; other accounts cannot restore them through the app. Unpair/account deletion clears indexed local draft text and staged files on the initiating phone. Offline/other phones may retain local drafts; iOS Keychain data can survive app removal. Attachments use private app files and OS protection, not application-level encryption. There is no biometric lock or end-to-end encryption.
- Diagnostics are an in-memory ring of fixed failure codes, timestamps and numeric references, visible in Settings and cleared on account switch. There is no external telemetry upload. Never paste diary text, tokens, signed URLs or coordinates into bug reports.
- Diary and annual libraries fetch 50 lightweight rows at a time; full text/media loads on selection. Totals use a separate aggregate. New recap snapshots include audio counts/duration, timezone writing buckets, stable ties and at most 200 map points. Existing recap snapshots stay unchanged. Voice memos stop at five minutes; new attachments are capped at 25 MiB in both client and bucket.
- The Valentine popup and bundled letter are retired. Recap slides can scroll, respect system Reduce Motion and always offer Skip to notes. Legacy native dependencies stay installed until a fresh iOS/Android build proves removal safe; removing packages and a broad redesign are follow-up work.

## 1. Run automated tests before any deployment

Use Node 20 (CI), npm, Python 3, PostgreSQL 17 client/server and Deno 2. Start from the reviewed branch with no accidental local changes:

```bash
npm ci
npm run validate
npm run test:ci
npm run test:edge
```

The database runner **drops the app/auth/storage fixture schemas**. Only pass a disposable local database named `lovecapsule_test_*`; its guard rejects remote hosts and other names. For example, with a local PostgreSQL service already running:

```bash
createdb lovecapsule_test_local
export LOVE_CAPSULE_TEST_DB='postgresql://localhost/lovecapsule_test_local'
python3 scripts/test_database.py
python3 scripts/generate_database_types.py --check
```

This exercises the same empty-database bootstrap ordering helper plus legacy upgrade fixtures. After changing migrations, regenerate `src/types/supabase.generated.ts` with `npm run types:database`; CI detects drift. Handwritten JSON result contracts live separately in `src/types/supabase.ts`. SQL shims exercise authorization, constraints and concurrency, but do not replace staging with real Auth, Storage and Edge Functions.

### Two-phone staging rehearsal

Create a separate Supabase staging project, with synthetic accounts and notes (or a sanitized restoration). Set the EAS **preview** environment’s Supabase URL/anon key to staging. Keep production variables only in the **production** environment. Public Expo variables are bundled into the app; never put service-role, worker or Expo push access secrets in them. Check `EXPO_PUBLIC_DEV_TOOLS=false` for any shared build. The Places key is client-visible: verify API restrictions, quotas and billing in Google Cloud; use a server proxy if the selected restrictions cannot safely support this REST flow. Its live configuration has not been inspected.

For a local development build, use `.env` with staging values and `npm run ios` / `npm start -- --dev-client`. `preview` is an internal/ad hoc build, **not TestFlight**: both iPhone UDIDs must already be registered in the provisioning profile. After reviewing the changes, build preview through your controlled EAS workflow. Do not point a preview build at your real diary. A separate staging bundle identifier/App Store Connect app is needed if you want a staging TestFlight app installed alongside production; it is not configured by this PR. The same bundle ID replaces the installed app.

Use two physical iPhones, one account each:

| Test                                                                                                                                   | Expected result                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign up with email confirmation; open a cold/warm confirmation link; request/reset a password; retry an expired link                   | In-app completion or a useful retry path; duplicate callbacks do not exchange twice. PKCE links must be opened on the phone that initiated the flow. Verify hosted Supabase redirect allowlist and email templates/SMTP. |
| Slow/offline startup; token expiry; sign out/switch accounts while loading                                                             | Profile error has Retry and Sign out; no blank profile is created after a failed read, and no old account data appears.                                                                                                  |
| Write text/photo/audio; force-quit during upload/save; restore draft; deny permissions; use a 25+ MiB file and a five-minute recording | Recovery preserves content, clear limits/errors, no duplicate save. Check large Keychain sessions/Unicode drafts on a real device.                                                                                       |
| View >100 diary notes and an annual capsule with >50 notes; open a long note from later pages                                          | Correct totals, no truncation, full reader content and attachments.                                                                                                                                                      |
| Schedule a reveal a few minutes ahead; foreground/background across it; deny push on one phone; change device timezone/clock           | Both phones converge on server readiness and the same occurrence; push is optional.                                                                                                                                      |
| Tap/open concurrently; repeat after dropped network response; view past years while current year is locked; edit/cancel a due schedule | Stable saved result/history, no extra random reveal or vanished due event.                                                                                                                                               |
| Enable push, publish a draft, edit/re-publish, disable, foreground; switch account; tap an old notification                            | One first-publication job; no automatic re-enable; stale notifications cannot navigate into another couple. Check APNs credentials and physical delivery.                                                                |
| Delete a note/unpair/delete a synthetic account; stop worker temporarily then restart                                                  | Records disappear immediately; queue retains both authors’ full paths; Storage files/Auth user finish deleting after retries. Verify no partner account is deleted.                                                      |
| Expire signed links; resume after an hour; use camera/audio, dark mode, largest text, VoiceOver, Reduce Motion                         | Media renews/retries, avatar refreshes on foreground/before expiry, controls remain reachable, recap can be skipped.                                                                                                     |

Review EAS build output for native modules. Only after a verified native build should unused editor/MMKV/camera/zustand packages be removed. Automated JavaScript/SQL tests cannot verify APNs, iOS pickers, audio interruption or accessibility on a phone.

## 2. Migrate an existing Supabase project

Use the pinned local Supabase CLI (`npx supabase`). Explicitly check the project reference each time you change targets. Take a backup and confirm a restoration path before production. Inspect existing multiple memberships, malformed schedules and migration history; stop and reconcile differences rather than deleting data to make a preflight pass.

```bash
npx supabase login
npx supabase link --project-ref YOUR_STAGING_PROJECT_REF
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
npx supabase migration list
```

`--dry-run` lists pending migrations; it does not execute or prove their safety. Rehearse the actual push and smoke tests on staging first. Depending on what is already applied, this release needs 011 through **017** in numeric order. 016 adds account/jobs/devices; 017 adds bounded queries/recap statistics/bucket limits. Pause legacy unauthenticated `notify-partner` database webhooks before enabling the new worker. Older builds do not register the new opt-in devices or use deletion receipts. Old direct schedule writes are denied by prior batches; update both phones.

If history says migrations are missing but objects already exist, compare schema/functions/grants with the repository and verify their effects first. `migration repair --status applied VERSION...` changes only bookkeeping; it must never substitute for applying SQL. Do not run `db reset --linked` or use the disposable test runner against a real project.

### Brand-new empty Supabase project

Migration 001 historically creates a policy before its referenced table. A later migration cannot fix an error that stops 001. Applied migration files remain unchanged. For **only a new project with an empty public app schema**, the shared bootstrap builder moves that one policy after table creation:

```bash
python3 scripts/build_bootstrap.py > /tmp/lovecapsule-bootstrap.sql
# Review this file, then execute it with psql against the NEW staging database.
psql "$NEW_STAGING_DB_URL" -X -v ON_ERROR_STOP=1 -f /tmp/lovecapsule-bootstrap.sql
```

Supabase supplies real Auth/Storage schemas/roles; do not copy the test shims. Verify tables, RLS, grants, triggers, RPC behavior and bootstrap completion before recording the applied versions 001–017 with `npx supabase migration repair --status applied 001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017`. Link to that same new project first. Then `migration list` and `db push --dry-run` should show no pending migrations. If a bootstrap transaction fails, inspect where it stopped; do not blindly mark all versions applied or rerun a partial bootstrap on live data. This deliberate baseline replaces raw `db reset` for this historical migration chain.

## 3. Deploy Edge Functions and activate maintenance

Database migration and Edge Function deployment are separate operations. With staging still explicitly linked:

```bash
npx supabase secrets set --env-file /absolute/private/path/lovecapsule-staging-functions.env
npx supabase functions deploy check-anniversary
npx supabase functions deploy maintenance
npx supabase functions deploy notify-partner
npx supabase functions list
```

The private environment file contains `MAINTENANCE_SECRET` (at least 32 random characters; use a password manager) and, if Expo push security is enabled, `EXPO_ACCESS_TOKEN`. Never commit it. Hosted Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the server; neither belongs in the app. The `maintenance` function intentionally uses `verify_jwt=false` and **requires its own constant-time checked `x-worker-secret` header before any queue access**. `check-anniversary` retains user JWT validation. The retired `notify-partner` returns 410 and sends nothing. Remove old database webhooks targeting it.

In the hosted project Dashboard, add `lovecapsule://auth/callback` to Auth redirect URLs (local `config.toml` alone does not change hosted Auth settings). Verify confirmation/recovery email templates and SMTP. Configure Expo/APNs credentials for the existing iOS bundle/project and opt in from each phone.

Enable Supabase Cron/pg_net and Vault using Dashboard integrations. Store the same worker secret as a Vault secret named `lovecapsule_maintenance_secret`, and store the function URL as `lovecapsule_maintenance_url`. Then create exactly one schedule in SQL Editor (check `cron.job` for that name before creating a duplicate):

```sql
select cron.schedule(
  'lovecapsule-maintenance', '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'lovecapsule_maintenance_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'lovecapsule_maintenance_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
```

There is intentionally no live scheduler created by the migration. Cron may overlap; leases prevent two workers claiming the same job simultaneously. This worker claims three jobs per invocation to bound external work. Monitor backlog age, especially during bulk cleanup. A direct test invocation using the same secret header can verify staging, but **will send queued notices and delete queued synthetic data**. An unauthenticated invocation must return 401 with no job effects. Confirm receipt polling and retry outcomes, not just a successful HTTP invocation. Do not log secret headers or tokens.

Operator checks (service SQL Editor only; omit payload/token columns from reports):

```sql
select kind, state, count(*), min(created_at) as oldest
from public.maintenance_jobs group by kind, state;
select id, kind, state, attempts, error_code, updated_at
from public.maintenance_jobs where state = 'failed';
```

After fixing a failed external dependency, requeue selected inspected jobs with `state='pending', attempts=0, next_at=now(), lease_id=null, lease_until=null`; retain ticket IDs when rechecking an Expo receipt. Do not mass-requeue completed push jobs. A deletion receipt’s `cleanup_pending=0` means all linked jobs finished. Keep failed deletion jobs visible until resolved. Define backup retention in Supabase; done queue/receipt rows are retained for audit/idempotency and restricted to trusted server access. Rotating the worker secret requires updating Edge secrets and Vault together.

## 4. Release to TestFlight and install on your phones

First merge/review PR #33, then #34, then Batches 5/6 into `dev`. Require the app, database and Edge CI jobs to pass. Rehearse staging, review the `dev` → `main` release PR, and deploy the reviewed production migrations/functions/scheduler **before** releasing the app that needs them. Repeat the linked-project checks with the **production** reference; never rely on the last CLI link silently being correct.

In Expo, verify the production environment has the production Supabase URL/anon key, correct Places key and `EXPO_PUBLIC_DEV_TOOLS=false`. GitHub needs `EXPO_TOKEN`; EAS needs valid Apple distribution/APNs credentials and App Store Connect submission access. Existing identifiers are `com.timecapsule.diary`, EAS project `be73ec20-7325-419e-81c5-dd0e9adb1f93`, and App Store Connect app `6758754917`. Confirm these match the app you already use. EAS remotely increments the iOS build number.

Choose a new marketing version, for example **1.1.0**; update `app.json`, `package.json` and the root/package metadata in `package-lock.json` together in the release PR. After it is merged, tag that reviewed `main` commit:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git tag v1.1.0
git push origin v1.1.0
```

Use your actual approved version. The production workflow checks that tag/app/package versions match and the commit is on `origin/main`, validates the app and runs `eas build --platform ios --profile production --auto-submit --non-interactive`. Auto-submit submits **that build**, eliminating `--latest` selection races. Release concurrency prevents two jobs running together. Do not manually launch a parallel production build. A build/submission failure is not a completed release; inspect its EAS build ID/submission status before retrying.

After Apple processing, open **App Store Connect → LoveCapsule → TestFlight**, resolve any compliance prompts and add the processed build to your testing group. Invite your Apple IDs; install Apple’s TestFlight app on both phones, accept invitations and install/update LoveCapsule. Internal testers need an eligible App Store Connect role. If your girlfriend uses external testing, create an external group and complete Beta App Review when required. TestFlight submission does not automatically publish to the public App Store. Verify the installed marketing/build number and perform a final synthetic-account reveal on production before trusting an important date.

Record release evidence: Git SHA/tag, migration list, deployed function revisions, Cron job/last successful run, EAS build/submission IDs, App Store Connect build number and two-phone smoke results. These live settings and credentials have not been verified in this implementation task. Roll forward with fixes; never remove reveal receipts/events to retry a rollout.

Primary operational references: [Supabase migrations](https://supabase.com/docs/guides/local-development/database-migrations), [CLI deployment/history commands](https://supabase.com/docs/reference/cli/supabase-migration-repair), [scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [native Auth links](https://supabase.com/docs/guides/auth/native-mobile-deep-linking), [Expo push receipts](https://docs.expo.dev/push-notifications/sending-notifications/), [EAS auto-submit](https://docs.expo.dev/build/automate-submissions/), [TestFlight](https://docs.expo.dev/submit/testflight/).
