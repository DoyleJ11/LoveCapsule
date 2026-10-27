# LoveCapsule

Expo (React Native + TypeScript) + Supabase couples diary. Entries stay sealed until the couple's anniversary.

**Phase:** V1 stabilization — fixing audit findings before a V2 UX/feature overhaul and wider release. Prefer surgical fixes over redesign; note bigger ideas as follow-ups instead of building them.

## Sources of truth

- **Notion — [V1 Stabilization Audit](https://app.notion.com/p/3bafb935cec98188b34ecd080dcb1025)**: the full findings list (C = critical, H/M/L = lower). New work comes from here.
- **Linear — [LoveCapsule project](https://linear.app/jdoyle/project/lovecapsule-af63fc1ee4e5)**: active tickets. Audit C1–C12 are `DEV-1`–`DEV-12`. Issue IDs are `DEV-n` (team key is `Dev`, not `LC`).
- Only the C findings are ticketed so far. When asked for more work, pull the next item from the audit's H/M/L sections and create a Linear issue for it.

## Workflow (per issue)

1. **Analyze** the Linear issue and read the actual code it points at.
2. **Plan** before editing: state the fix (with code/SQL sketches) and how it will be tested. Flag it if the ticket's suggested fix turns out to be wrong.
3. **Branch** from `dev` using Linear's generated branch name (on the issue: `Cmd/Ctrl+Shift+.`), e.g. `jackconnerdoyle/dev-8-...`.
4. **Implement**, then verify — see Testing below.
5. **PR into `dev`** with `Fixes DEV-n` in the body, then squash-merge. That auto-closes the Linear issue.

Batch related issues into one PR when they share a migration or domain (e.g. DEV-5/6/7 were one RLS migration). Use `Fixes DEV-5, DEV-6, DEV-7`.

`main` is release-only. Never commit directly to `main` or `dev`.

## Commands

```bash
npm run validate      # lint + typecheck + test — run before every PR
npx jest              # tests
npx tsc --noEmit      # typecheck
npm run ios           # simulator (needs .env, see .env.example)
```

CI (`pr-checks.yml`) runs on PRs into `dev` and release branches: formatting, lint warning ceiling, TypeScript, Jest, PostgreSQL 17/RLS plus generated type drift, and Deno checks/worker tests. Run `validate` locally too; lower the warning ceiling as debt is removed.

## Testing

- **Pure logic → Jest.** Extract testable logic rather than leaving it in components (see `supabase/functions/check-anniversary/reveal-logic.ts`, shared with Jest; Edge entrypoints are also typechecked with Deno 2 in CI).
- **SQL / RLS / policies → real Postgres.** Do not eyeball SQL. Spin up a scratch cluster and prove it:
  - Use a disposable local PostgreSQL 17 database named `lovecapsule_test_*`, then run `python3 scripts/test_database.py`. Never run fixtures against production.
  - Shim Supabase: `auth.users`, `auth.uid()` reading `request.jwt.claim.sub`, `storage.buckets`/`objects`/`foldername`, and roles `anon`/`authenticated`/`service_role`.
  - Act as a user with `SET ROLE authenticated;` + `SELECT set_config('request.jwt.claim.sub','<uuid>',false);` — RLS is skipped for table owners, so never test as `postgres`.
  - Migration 001 isn't replayable as-is (see Gotchas); reorder it in the scratch copy only.
- **Always reproduce the bug against the current code first**, then re-run after the fix. This caught a wrong plan on DEV-6: dropping the invite-code policy silently broke pairing, because the join `UPDATE ... WHERE invite_code` needs SELECT visibility to match the row.
- Test the legitimate path too, not just the blocked one. Security fixes break features silently.

## Deploying

DB first, then app — migrations are backward-compatible with the shipped build, but new client code depends on new DB objects.

```bash
supabase migration list                        # ALWAYS check before pushing
supabase db push                               # migrations only
supabase functions deploy check-anniversary    # db push does NOT deploy functions
```

Release to TestFlight is tag-triggered (`production-release.yml`): synchronize app/package/lockfile versions in a reviewed release PR, tag the merged main commit and push only that tag. The job uses auto-submit for its own build; never submit `--latest` or run a parallel production build. See `docs/reveal-rollout.md` for staging, worker secrets/Cron, Auth redirects, migrations/Edge deployments and phone installation.

## Gotchas

- **supabase-js never throws.** It returns `{ data, error }`. Always destructure and check `error` — unchecked calls were a top source of silent failures in this repo.
- **Migration 001 needs an empty-project baseline**: `scripts/build_bootstrap.py` uses the same tested ordering helper as database CI. Existing installations use normal migrations. Never mark migrations applied just because history is empty: verify/apply actual effects first. See the rollout guide.
- **Reveal visibility** uses frozen annual manifests and recipient occurrence receipts. Do not reconstruct access with a movable anniversary cutoff or `couples.is_revealed`; that flag is legacy.
- **Reveal/pairing columns are trigger-protected** (`is_revealed`, `last_reveal_year`, `invite_code`, partner ids). Only `SECURITY DEFINER` functions and `service_role` can write them. The Supabase **Table Editor can't** edit them — use the SQL Editor. Anniversary schedules use the versioned `save_annual_schedule` RPC; direct app writes are denied.
- **New `SECURITY DEFINER` app APIs** must authenticate/authorize the target (use `assert_couple_member` for couple APIs), set an explicit search_path and revoke PUBLIC/anon execution. Trigger and service-only worker helpers are not exposed to app users; revoke authenticated execution too.
- **Edge function auth** (`verify_jwt`) lives in `supabase/config.toml` and is applied by the CLI at deploy time.
- **Edge functions must return 200 with `{ error }`** for business-rule failures — supabase-js discards bodies on non-2xx, so a 4xx reaches the app as "Edge Function returned a non-2xx status code". Reserve real status codes for auth/server errors.
- **In-app dev tools** need both `EXPO_PUBLIC_DEV_TOOLS=true` and `profiles.is_admin = true` (set from the Supabase dashboard only).
- The editor and Settings remain large; reader, schedule, location and data boundaries have been extracted. Read the region you're changing; don't load them whole.

## Conventions

- Match surrounding style. Comments explain _why_, not _what_.
- Only claim something works if it was run. PR bodies state what was actually verified.
- Call out scope creep explicitly, and list known-but-unfixed issues under "Not in scope" in the PR.
- Migrations are append-only and numbered (`NNN_description.sql`). Never edit an applied migration; write a new one.
- Commit messages: plain prose describing the defect and the fix. No issue IDs in commits (they belong in the PR body).
