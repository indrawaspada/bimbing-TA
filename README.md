# BimbingTA Copilot

Private Indonesian thesis-supervision app: 1 supervisor (owner) + invited students.
Stack: React + TypeScript + Vite + Tailwind + React Router · Supabase (Auth, Postgres + RLS, private Storage, Edge Functions) · Cloudflare Pages.

Status: **Checkpoint B (foundation)**. Workspace (PDF/revisions/discussion), AI and export are later checkpoints.

## Layout
```
data/                     rule_engine.json (92 rules), master_prompt.txt, model_catalog.json — verbatim kit files
docs/                     SDD, data/API contract, acceptance tests (owner kit)
supabase/migrations/      0001 identity … 0006 finalize (RLS deny-by-default, column grants, RPCs, storage policies)
supabase/tests/local/     TEST HARNESS ONLY: Supabase emulation (roles/auth/storage) for local Postgres
scripts/seed-rubric.mjs   emits SQL that stores rule_engine.json + master prompt verbatim with sha256
scripts/local-test-db.sh  TEST HARNESS: local Postgres 15 + PostgREST, applies migrations
scripts/ui-harness.mjs    TEST HARNESS: serves UI against local PostgREST with synthetic sessions
tests/security/           owner / student A / student B / outsider / anonymous isolation tests (direct REST + storage)
src/                      frontend
```

## Security model (summary)
- Role lives only in `public.memberships`; never in `user_metadata`/`app_metadata`/client state.
- `claim_membership()` (SECURITY DEFINER) reads identity from `auth.users`: email must be verified, provider must be in `app_config.allowed_providers` (default `{google}`), and an active unclaimed invitation must match. Unknown users get `pending` and see no data.
- `bootstrap_owner(email)` is callable **only from the SQL editor** (revoked from API roles) and only once.
- Every table: RLS enabled (migration 0006 fails if any table lacks RLS), anon revoked, column-level grants; guard triggers block owner-only fields, relation changes and sealed-version edits. Optimistic locking via `row_version`.
- Storage bucket `thesis-files` is private; upload allowed only to `{project_id}/{version_id}.pdf` of a version row the caller created in state `uploading`; no UPDATE policy (no overwrite); read requires project access (signed URLs need it too).
- `private_notes` is a separate owner-only table.

## Runtime
Node **22.x** (verified 22.23.3) + Yarn 1. `@supabase/*` 2.117.2 declare `engines.node >=22`; install and build are
verified with `yarn install --frozen-lockfile` **without** `--ignore-engines`. Cloudflare Pages: `NODE_VERSION=22` (also `.nvmrc`).
In the Emergent workspace Node 22 lives at `/root/tools/node22/bin` (system Node 20 is not used for this project).

## Configuration
Frontend and admin config are separate files. Admin/test secrets: `.secrets/admin.env` (see `admin.env.example`,
git-ignored, never read by Vite). Hosted setup & validation: `docs/HOSTED_SETUP.md`.

Frontend (`.env.local` for dev, Cloudflare Pages env vars for prod) — publishable values only:
```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable/anon key>
```
Server secrets (Supabase → Edge Functions → Secrets; used from checkpoint D; all optional, manual mode works without):
```
OPENAI_API_KEY  ANTHROPIC_API_KEY  GEMINI_API_KEY  ALLOWED_ORIGINS  AI_TIMEOUT_MS=100000
```
Never put service_role keys, DB passwords or provider keys in `VITE_*`, the repo, chat or exports.

## Supabase setup (dev or prod project)
1. Create project → Authentication → Providers → **Google**: enable, paste Google OAuth client ID/secret (Google Cloud Console → OAuth client "Web"; authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`). Disable Email signups in production.
2. Authentication → URL configuration: Site URL = production origin; Redirect URLs = `http://localhost:5173/**`, preview origin, `https://<your>.pages.dev/**`.
3. Apply migrations + seed: `node scripts/hosted-migrate.mjs` (dry run), then `--apply --confirm-ref=<ref> --seed`
   (alternatives: `supabase db push`, or SQL editor in file order + `node scripts/seed-rubric.mjs > seed.sql`).
4. Rubric weights: seeded as **"Bobot awal toolkit v1.0"** (chapters final 20/20/25/25/10; proposal normalized over Bab I–III), adjustable by the owner.
5. Owner bootstrap (once, SQL editor): `select public.bootstrap_owner('owner-google-email@example.com');` then log in with Google.
6. Invite students in the app (Mahasiswa → Undang) and create their projects.

## Tests
```
yarn test:security:local    # LOCAL: fresh Postgres 15 + PostgREST emulation, 12 isolation tests
yarn test:score             # scoring kernel (kit tests, score_reference.ts unchanged) + toolkit weights
yarn test:hosted            # HOSTED dev project: AUTH / DATABASE / STORAGE sections; PENDING without config
```
The local harness emulates Supabase roles/auth/storage; it is not Supabase itself. A run against the real
dev project (Google personas or service-role-created synthetic personas) is still required before production.

## Build
`yarn build` → `dist/` (Cloudflare Pages: build command `npm run build`, output `dist`, Node 22; `public/_redirects` gives SPA fallback).
