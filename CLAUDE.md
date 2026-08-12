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

CI (`pr-checks.yml`) only runs on PRs to `main`, so **PRs into `dev` get no CI** — run `validate` locally.
ESLint rules are all `warn`, so lint exits 0 with ~90 warnings. Exit code 0 ≠ clean; don't add new warnings.

## Testing

- **Pure logic → Jest.** Extract testable logic rather than leaving it in components (see `supabase/functions/check-anniversary/reveal-logic.ts`, split out so Jest could cover it since Deno isn't available).
- **SQL / RLS / policies → real Postgres.** Do not eyeball SQL. Spin up a scratch cluster and prove it:
  - `pg_ctl` refuses to run as root — run as the `postgres` user with a data dir under `/var/lib/postgresql`.
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

Release to TestFlight is tag-triggered (`production-release.yml`): bump `version` in `app.json`, commit, `git tag vX.Y.Z`, `git push origin main --tags`. Don't run `eas build` manually.

## Gotchas

- **supabase-js never throws.** It returns `{ data, error }`. Always destructure and check `error` — unchecked calls were a top source of silent failures in this repo.
- **Migration 001 is not replayable from scratch**: it creates a `profiles` policy referencing `public.couples` before that table exists, so `supabase db reset` fails on a clean DB. If `migration list` shows an empty remote column, `supabase migration repair --status applied 001 ... 00N` rather than replaying.
- **Reveal visibility** = `entry_date <= anniversary_in_year(anniversary_date, last_reveal_year)`. `couples.is_revealed` is **legacy** and is not used for access control anywhere — don't reintroduce it as a gate.
- **Reveal/pairing columns are trigger-protected** (`is_revealed`, `last_reveal_year`, `invite_code`, partner ids). Only `SECURITY DEFINER` functions and `service_role` can write them. The Supabase **Table Editor can't** edit them — use the SQL Editor. `anniversary_date` is intentionally still app-writable.
- **New `SECURITY DEFINER` functions** must call `assert_couple_member(couple_id)`, set `SET search_path = public`, and `REVOKE EXECUTE ... FROM PUBLIC, anon`.
- **Edge function auth** (`verify_jwt`) lives in `supabase/config.toml` and is applied by the CLI at deploy time.
- **Edge functions must return 200 with `{ error }`** for business-rule failures — supabase-js discards bodies on non-2xx, so a 4xx reaches the app as "Edge Function returned a non-2xx status code". Reserve real status codes for auth/server errors.
- **In-app dev tools** need both `EXPO_PUBLIC_DEV_TOOLS=true` and `profiles.is_admin = true` (set from the Supabase dashboard only).
- Three screens are 1,000+ lines (`reveal/index.tsx`, `entries/new.tsx`, `settings/index.tsx`). Read the region you're changing; don't load them whole.

## Conventions

- Match surrounding style. Comments explain _why_, not _what_.
- Only claim something works if it was run. PR bodies state what was actually verified.
- Call out scope creep explicitly, and list known-but-unfixed issues under "Not in scope" in the PR.
- Migrations are append-only and numbered (`NNN_description.sql`). Never edit an applied migration; write a new one.
- Commit messages: plain prose describing the defect and the fix. No issue IDs in commits (they belong in the PR body).
