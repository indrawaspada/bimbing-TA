# BimbingTA Copilot

Private Indonesian thesis-supervision app: 1 supervisor (owner) + invited students.
Stack: React + TypeScript + Vite + Tailwind + React Router · Supabase (Auth, Postgres + RLS, private Storage, Edge Functions) · Cloudflare Pages.

Status: **Checkpoint D implemented; hosted acceptance in progress**. Ten migrations and the AI function are deployed to Supabase dev. The additive rubric/prompt guard repair and current-data native audit passed [GitHub Actions](https://github.com/indrawaspada/bimbing-TA/actions/runs/37867323836): ten exact migration hashes, 28 RLS tables, 56 functions, 62 policies and 47 triggers match source; AI budgets/models/runs/reservations remain zero. Real Google owner login, authenticated AI status, project creation, manual traceability, two-session private-note conflict handling and metadata/ZIP export have been checked on the Cloudflare branch preview. Student login, hosted PDF workflows, AI ledger concurrency, provider calls and full hosted restore remain pending. Offline manual-backup rehearsal is available; a separate opt-in native SQL rollback runner is prepared with synthetic ZIPs and existing-data checks. PR #2 stays draft; production main remains checkpoint C. See [Checkpoint D setup and current validation](docs/CHECKPOINT_D.md) and [historical checkpoint C results](docs/HOSTED_STATUS.md).

## Layout
```
data/                     rule_engine.json (92 rules), master_prompt.txt, model_catalog.json — verbatim kit files
docs/                     SDD, data/API contract, acceptance tests (owner kit)
supabase/migrations/      0001 identity … 0009 AI ledger, 0010 rubric/prompt guard repair (RLS, grants, RPCs)
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
Node **22.x or 24.x** + Yarn Classic **1.22.22** (pinned in `packageManager`). C was verified on 24.19.0 locally and 22.23.3 in hosted CI. `@supabase/*` 2.117.2 declare `engines.node >=22`; install and build are
verified with `yarn install --frozen-lockfile` **without** `--ignore-engines`. Cloudflare Pages: set `NODE_VERSION=22.23.3` and `YARN_VERSION=1.22.22` in Settings → Environment variables for Production (and Preview if used). `.nvmrc` also pins 22.23.3. Pages defaults to Yarn 4; using it with this Classic lockfile causes `YN0028`. Keep the existing lockfile and override the Yarn version, then retry deployment.
Use a local Node installation meeting the engine requirement; the old Emergent workspace path is not required. Hosting remains Cloudflare Pages + Supabase.

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
1. Create project → Authentication → Providers → **Google**: enable, paste Google OAuth client ID/secret (Google Cloud Console → OAuth client "Web"; authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`). Disable the Email provider in production; keep global signup enabled so invited first-time Google users can register. Application invitations and RLS control data access.
2. Authentication → URL configuration: Site URL = production origin; Redirect URLs = `http://localhost:5173/**`, preview origin, `https://<your>.pages.dev/**`.
3. Apply migrations + seed: `node scripts/hosted-migrate.mjs` (dry run), then `--apply --confirm-ref=<ref> --seed`
   (alternatives: `supabase db push`, or SQL editor in file order + `node scripts/seed-rubric.mjs > seed.sql`).
4. Rubric weights: seeded as **"Bobot awal toolkit v1.0"** (chapters final 20/20/25/25/10; proposal normalized over Bab I–III), adjustable by the owner.
5. Owner bootstrap (once, SQL editor): `select public.bootstrap_owner('owner-google-email@example.com');` then log in with Google.
6. Invite students in the app (Mahasiswa → Undang) and create their projects.

## Tests
```
yarn test:ai                # mock provider contracts + real SQL/WASM execution ledger
yarn typecheck:edge         # server core/adapters/service TypeScript
yarn test:workspace         # portable real SQL/WASM; synthetic HTTP/Auth/Storage adapter (27 checks)
yarn test:ui:local          # Chromium UI + bundled PDF worker; synthetic Auth/Storage
yarn test:restore           # manual ZIP integrity + disposable local SQL restore/rollback (22 checks)
yarn test:workspace:rest    # native PostgreSQL + PostgREST regression; requires the B local stack
yarn test:security:local    # LOCAL: fresh Postgres 15 + PostgREST emulation, 12 isolation tests
yarn test:score             # scoring kernel (kit tests, score_reference.ts unchanged) + toolkit weights
yarn test:hosted            # HOSTED dev project: AUTH / DATABASE / STORAGE sections; PENDING without config
```
The local harness emulates Supabase roles/auth/storage; it is not Supabase itself. A run against the real
dev project using synthetic persona JWTs passed 22/22 for checkpoint C; see `docs/HOSTED_STATUS.md` for that historical run. Real Google owner login and some hosted UI flows subsequently passed on the D preview; student login, hosted PDF workflows and complete D acceptance remain pending. See `docs/CHECKPOINT_D.md` for current status.

The UI harness uses bundled Chromium on Linux. On Windows/macOS set `BIMBINGTA_UI_BROWSER` to the executable path of an installed Chromium browser before running `yarn test:ui:local`. It uses disposable local SQL and synthetic Auth/Storage, never the hosted project. Traceability desktop/mobile screenshots are written to ignored `dist-harness/qa/`.

Windows revalidation on 9 October 2026 passed the production build, Edge TypeScript, workspace 27/27, AI mocks 14/14, scoring 4/4 and the complete UI suite, including traceability at 1280/390/320 px. Commit `e240a7f` passed Cloudflare Pages and is published to the D branch preview; the mobile width rule and static SPA fallback were verified over HTTP. Authenticated hosted acceptance remains incomplete; see `docs/CHECKPOINT_D.md` for evidence and remaining work. Hashed rubric/prompt/migration sources use LF via `.gitattributes` so Windows checkout preserves their original byte hashes.

Offline restore rehearsal is available through `node scripts/restore-backup.mjs <backup.zip> [--report=<new-report.json>]`. It validates the app's manual project ZIP and imports it into fresh in-memory PostgreSQL WASM, checks relinked records and file/snapshot hashes, then rolls back and closes the database. Original version numbers, including gaps after deletion, are preserved up to 2048; temporary failed markers have no PDF and are removed before final validation, with the original SQL guard unchanged. Locator page IDs must match their version/index. It has no hosted/apply mode, does not load credentials, and refuses AI history, legacy resource attachments and incomplete uploads. The report contains counts and limits, not thesis text or source identities. UI acceptance also rehearses the ZIP actually exported by the app; synthetic backup/report artifacts are in ignored `dist-harness/qa/`. This does not complete hosted restore acceptance or constitute a full workspace backup.

Hosted public read-only smoke on 9 October 2026 passed 7/7: anonymous table access and missing/invalid bearer requests were denied, exact-preview CORS worked and an unlisted origin was rejected. Public Auth settings showed Google/Email and global signup enabled; nothing was changed. This adds hosted connectivity/denial evidence, not authenticated student/PDF/restore acceptance. Current evidence is in `docs/CHECKPOINT_D.md`.

## Build
`yarn build` → `dist/` (Cloudflare Pages: production branch `main`, repository root, build command `yarn build`, output `dist`, `NODE_VERSION=22.23.3`, `YARN_VERSION=1.22.22`; `public/_redirects` gives SPA fallback).

The older full hosted persona suite requires an empty disposable DEV project. Do not run it against the project now containing a real owner. Checkpoint D introduces no automatic provider calls or deployment. See docs/CHECKPOINT_D.md for ordered activation.
