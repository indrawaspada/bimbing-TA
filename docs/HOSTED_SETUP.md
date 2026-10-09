# Hosted validation (Supabase DEV project) — setup & checklist

Scope: initial checkpoint C setup and synthetic validation on an empty dedicated DEV project. The current DEV project already has a real owner and ten migrations; do not repeat bootstrap, seed or the empty-DEV suite there. Current status and remaining acceptance are in [CHECKPOINT_D.md](CHECKPOINT_D.md). Google owner login and the native D audit have passed; student flows remain pending. The current migration runner is pinned to the documented DEV URL/database and verifies recorded SQL hashes before applying pending migrations. AI stays off until the owner explicitly authorizes activation and live tests.

Runtime: **Node 22.x** (verified 22.23.3; `@supabase/*` 2.117.2 require `>=22`). Yarn 1 classic. No `--ignore-engines`.

## 1. Configuration files (never commit, never paste in chat)
| File | Contains | Read by |
|---|---|---|
| `.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable) | Vite build, tests (URL/anon only) |
| `.secrets/admin.env` | `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `scripts/hosted-migrate.mjs`, `tests/hosted/*` only |

Templates: `.env.example`, `admin.env.example`. Both real files are git-ignored (`.env.*`, `.secrets/`). Vite never loads `.secrets/`.
Scripts print only the project ref / DB host; errors pass through a redactor.

## 2. Supabase DEV project (dedicated to testing — no real student data)
1. Auth → Providers → **Google**: enable with OAuth client ID/secret from Google Cloud Console
   (Authorized redirect URI: `https://<ref>.supabase.co/auth/v1/callback`).
2. Auth → Sign In / Providers: **Email** enabled only during synthetic password-JWT testing.
   The **"Allow new users to sign up"** switch in **User Signups** is GLOBAL, not email-only.
   Keep it ON before first Google login for the real owner or any newly invited student.
   The HTTP suite only reads Auth settings and does not change signup or call `/signup`. Turning it OFF
   blocks first-time OAuth account creation too; a public.invitations row does not create an Auth user.
   Production: disable the **Email provider**, keep Google enabled and global signup ON;
   `app_config.allowed_providers` stays `{google}`. Only the SQL membership allowlist grants app data access.
   See [Supabase general configuration](https://supabase.com/docs/guides/auth/general-configuration).
3. Auth → URL Configuration: use the actual **Cloudflare Pages** origin. Current D preview:
   `https://codex-checkpoint-d.bimbing-ta.pages.dev/`; Redirect URLs include
   `https://codex-checkpoint-d.bimbing-ta.pages.dev/**` and `http://localhost:5173/**` for local development.
   Add the verified production Cloudflare origin when releasing D. The frontend redirects Google OAuth
   to `${window.location.origin}/`; no Emergent deployment or preview script is part of the current procedure.

## 3. Apply pending migrations (eight files including checkpoint C and conflict HTTP 409 fix) (no reset, no data deletion)
```
node scripts/hosted-migrate.mjs                                   # dry run: lists applied/pending
node scripts/hosted-migrate.mjs --apply --confirm-ref=<ref> --seed  # applies pending + seeds rubric/prompt/weights
```
- Refuses without `--confirm-ref` matching the URL's project ref; aborts if our tables exist without migration records;
  aborts if a migration contains DROP TABLE/SCHEMA, TRUNCATE or auth deletes. Each migration = one transaction.
- Records: `supabase_migrations.schema_migrations` (CLI-compatible) and `supabase/hosted-migrations.log.json`
  (ref, file, sha256, timestamp — no secrets). Post-check prints tables without RLS (must be 0), bucket privacy, rubric.
- Seed is idempotent; weights are replaced only while still the old provisional placeholder (never owner edits).

## 4. Hosted security suite (synthetic personas, real Supabase Auth/PostgREST/Storage)
```
node scripts/hosted-ci.mjs preflight              # read-only connection and integrity checks
BT_HOSTED_CONFIRM_REF=tghcovjdsxirhpexpqor yarn test:hosted
node scripts/hosted-ci.mjs cleanup                # recovery if a test was interrupted
```
- Order matters: run **before** bootstrapping the real owner. The preflight requires this fixed DEV project to have zero Auth users, memberships, projects, invitations and PDF objects. It never clears pre-existing data.
- Setup/teardown (service role + DB URL): create `bt-test-*@example.test` users, SQL `bootstrap_owner` (README path),
  temporarily allow provider `email` in `app_config` for synthetic claims, then restore and delete only the current run’s synthetic rows/objects. Cleanup errors fail the suite; an interrupted run retains a git-ignored recovery journal containing only the run ID and provider baseline.
- Every asserted request uses the persona's own JWT from `POST /auth/v1/token?grant_type=password`.
- Report sections: **AUTH**, **DATABASE**, **STORAGE**, **CHECKPOINT C** (22 cases). Without config the suite reports `PENDING` and makes no connection.

### Optional native SQL validation without admin credentials

For an **empty dedicated dev project**, run the WHOLE file
[`tests/hosted/rollback.sql`](../tests/hosted/rollback.sql) through the authenticated Supabase SQL Editor.
It aborts if Auth users, memberships or projects already exist. It checks 40 native PostgreSQL
assertions covering B/C RLS, column grants, naskah sealing, autosave conflicts, private drafts,
comments, revision proof/owner decisions, notifications, safe URLs and export evidence protection.
All synthetic rows and temporary helpers live inside one transaction that ends in `ROLLBACK`.
No provider configuration is relaxed. After execution, verify counts for `auth.users`,
`public.memberships`, `public.projects`, `public.versions` and the PDF bucket's Storage rows remain zero.
If execution errors before the final rollback, issue `ROLLBACK` before the follow-up query.

This is a separate layer: identity claims and Storage metadata are simulated in SQL.
It does **not** validate Supabase-issued JWTs, PostgREST HTTP status, file transfer,
Storage API behavior or actual Google OAuth. The HTTP suite and real login checklist still apply.

## 5. Real Google OAuth — manual checklist (synthetic sessions do NOT count)
After step 4, confirm global **Allow new users to sign up = ON**, disable the Email provider,
and confirm Google remains enabled. Build with `yarn build` (Node 22), publish through the existing
Cloudflare Pages/GitHub integration, and use real Google accounts on the verified Cloudflare origin.
On current DEV, owner G1/G2 have already passed: do not bootstrap another owner. Continue with the
student/outsider checklist using separate real Google browser profiles. See `CHECKPOINT_D.md` for
the difference between synthetic password-JWT/API passes and real OAuth/browser acceptance.

| # | Action | Expected |
|---|---|---|
| G1 | Owner Google account: open preview → "Masuk dengan Google" | Google consent → returns to app → "Menunggu akses (not_invited)" |
| G2 | SQL editor: `select public.bootstrap_owner('<owner-gmail>');` → "Periksa lagi" | `owner_membership_created`; Dashboard visible |
| G3 | Owner: Mahasiswa → Undang `<student-gmail>`; Buat proyek | Invitation "Belum login"; project created |
| G4 | Student Google account (other browser/profile) → login | Lands on own project; tab "Catatan privat" absent |
| G5 | Owner: invitation shows "Terhubung" | `claimed_uid` bound |
| G6 | Uninvited Google account → login | "Menunggu akses", no data; Network tab: `/rest/v1/projects` returns `[]` |
| G7 | Logout (all) → login again | Same role/project restored without re-claim |
| G8 | Student opens `/proyek/<owner-other-project-id>` | "Proyek tidak ditemukan" |

Verification query (SQL editor): `select role, verified_email, active from public.memberships;`
Record date, accounts used (masked), pass/fail per row. Current owner OAuth passed; student/outsider
Google browser acceptance is still pending. Synthetic API tokens do not close G4–G8.

## 6. Cleanup / safety
- Never run `supabase db reset` on any project with real users.
- The synthetic suite only deletes `bt-test-*` users ending in the current journal’s unique run ID plus `@example.test`, and their projects/objects. It does not sweep other runs. Never cancel a full test while the temporary policy is active; if interrupted, run recovery with its original journal.

Checkpoint C implementation and its hosted validation limits: [CHECKPOINT_C.md](CHECKPOINT_C.md).

## 7. GitHub Actions (no local admin.env needed)

See [HOSTED_ACTIONS.md](HOSTED_ACTIONS.md). The manual workflow consumes repository Secrets/Variables inside GitHub’s runner. Default mode runs read-only preflight. Full persona mode creates synthetic fixtures, temporarily allows `email` in the app membership policy, then restores Google-only and removes that run’s data. Full mode first applies only the reviewed additive conflict-code migration 20261007000008 on an empty DEV project (or verifies it is already exact), then validates all eight migration hashes. A final read-only preflight verifies cleanup even when a test fails. Neither mode changes global Auth settings, resets the database, deploys, or calls an AI model.

The paragraph above describes the historical C job on main, which must not run on the current owner-populated DEV.
For D use its read-only audit, isolated native ledger, SQL rollback or optional current-data file-service mode.
The latter passed 26/26 with exact-scope cleanup and original data unchanged, while preserving Google-only app
policy and AI OFF. It requires Email Auth already enabled for admin-created synthetic password identities,
never changes provider settings, never generates an owner token and explicitly SQL-enrolls only fixture students.
Recovery journal upload must succeed before fixture creation. See the executed run and limits in `CHECKPOINT_D.md`.
