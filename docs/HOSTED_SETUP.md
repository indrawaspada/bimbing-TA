# Hosted validation (Supabase DEV project) — setup & checklist

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
   The existing HTTP suite expects it OFF while testing admin-created personas. Restore it ON
   before first Google login for the real owner or any newly invited student. Turning it OFF
   blocks first-time OAuth account creation too; a public.invitations row does not create an Auth user.
   Production: disable the **Email provider**, keep Google enabled and global signup ON;
   `app_config.allowed_providers` stays `{google}`. Only the SQL membership allowlist grants app data access.
   See [Supabase general configuration](https://supabase.com/docs/guides/auth/general-configuration).
3. Auth → URL Configuration: Site URL = preview origin; Redirect URLs:
   `https://bimbing-ta-copilot.preview.emergentagent.com/**`, `http://localhost:5173/**`.

## 3. Apply pending migrations (seven files including checkpoint C) (no reset, no data deletion)
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
yarn test:hosted
```
- Order matters: run **before** bootstrapping the real owner. The suite aborts if a non-synthetic owner exists.
- Setup/teardown (service role + DB URL): create `bt-test-*@example.test` users, SQL `bootstrap_owner` (README path),
  temporarily allow provider `email` in `app_config` for synthetic claims, then restore and delete only synthetic rows/objects.
- Every asserted request uses the persona's own JWT from `POST /auth/v1/token?grant_type=password`.
- Report sections: **AUTH**, **DATABASE**, **STORAGE**. Without config the suite reports `PENDING` and makes no connection.

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
After step 4, restore global **Allow new users to sign up = ON**, disable the Email provider,
and confirm Google remains enabled. Then rebuild the preview
(`bash scripts/preview-emergent.sh`, Node 22) and use real Google accounts:

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
Record date, accounts used (masked), pass/fail per row. Until done, OAuth status = **not tested**.

## 6. Cleanup / safety
- Never run `supabase db reset` on any project with real users.
- The synthetic suite only deletes `bt-test-*@example.test` users and their projects/objects.

Checkpoint C implementation and its hosted validation limits: [CHECKPOINT_C.md](CHECKPOINT_C.md).
