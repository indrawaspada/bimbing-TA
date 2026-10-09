# Hosted validation through GitHub Actions

The checkpoint C job on `main` is historical: its pinned source and preflight expect eight migrations and an empty DEV baseline. Do not run that job against the current project with a real owner. The `codex/checkpoint-d` branch adds a separate current-data audit described below. See [CHECKPOINT_D.md](CHECKPOINT_D.md) for current status; production main remains checkpoint C and PR #2 remains draft.

## Current-data checkpoint D audit

Dispatch the existing workflow on `codex/checkpoint-d`, with `run_persona_tests=false` and `confirm_ref=tghcovjdsxirhpexpqor`. The D job checks out the exact dispatch SHA, installs frozen dependencies without lifecycle scripts, builds/typechecks and runs local audit safety tests before injecting only `SUPABASE_DB_URL`. No service key is needed. `scripts/hosted-audit.mjs` compares migration hashes, guards/ACLs, RLS/policies, grants, private PDF bucket, immutable toolkit sources, Google-only membership and AI OFF inside a read-only transaction. It accepts existing owner/project data and prints only aggregate counts. It never creates test users, changes app/Auth settings, resets data, deploys or calls providers.

The optional `apply_rubric_guard_repair=true` applies only additive `20261009000010` after the source-matched nine-migration audit, then repeats the audit against all ten migrations. This option changes only the rubric/prompt trigger function and records the new migration; no reseed, owner-weight rewrite, PDF/user deletion or provider activation occurs. Existing migration hashes must match and any other pending migration blocks this mode. Default remains read-only. A passing audit does not prove real student OAuth, authenticated UI/PDF workflows, hosted restore or live providers.

Executed [run 37867323836](https://github.com/indrawaspada/bimbing-TA/actions/runs/37867323836) on 9 October 2026: build/Edge typecheck, 11 local safety tests, source-matched nine-migration pre-audit, guarded 0010 repair and final ten-migration native audit all passed. Source SHA `a2a106c836707db41e74ad483969e37c10639aa1`. Final read-only audit at **00:58:02 UTC** confirmed 28 RLS tables, 56 functions, 62 policies, 47 triggers, one owner/project, no students/PDFs and AI fully OFF. Existing-data aggregate counts stayed unchanged. Normal future D runs should keep the repair option **false**, because 0010 is already applied.

The remaining sections describe the historical checkpoint C job and must not be used as instructions to test the nonempty current DEV project.

## Optional native SQL restore rollback on current DEV

On `codex/checkpoint-d`, use `run_restore_sql_rehearsal=true`, `run_persona_tests=false`, `apply_rubric_guard_repair=false`, and the exact DEV ref. The runner first checks source-matched migrations/guards and AI OFF. It maps the synthetic source owner to the sole existing active verified Google owner without modifying that account, then restores two synthetic manual-ZIP scenarios (v1/v2 and v1/v4) into private SQL transactions. Auth/student/project/Storage metadata fixtures are never committed. Every path rolls back; 31 table counts/content hashes verify original data unchanged. Authenticated SQL-role checks verify owner/student access and student isolation. Locks/timeouts are bounded; no reset, seed, migration, provider activation or network Auth/Storage call occurs.

This uses native PostgreSQL but synthetic PDF bytes, Storage metadata and simulated JWT claims. It does not pass real Google OAuth, browser extraction, upload/download/signed URL APIs or persistent maintenance restore. The offline CLI remains separate and refuses hosted/apply flags. Results and limits belong in `CHECKPOINT_D.md`; opt-in preparation alone is not a hosted pass.

Executed [run 37875028465](https://github.com/indrawaspada/bimbing-TA/actions/runs/37875028465), source `170b984b2b4a034773452f555dfe942ee11c7fe7`, **SUCCESS** at 02:33:47 UTC on 9 October 2026. Both native restore scenarios passed with role/Storage RLS checks, verified rollback and identical counts/content hashes across 31 original tables. Build/Edge typecheck, local safety tests and native audit also passed. No migration, reseed, provider/API call or committed fixture data occurred. Full B02 restore via file services remains pending.

The manual workflow **BimbingTA hosted validation** runs on GitHub's Ubuntu runner with Node 22 and Yarn 1.22.22. It checks out an exact reviewed checkpoint C commit, not a moving branch. The small launcher must exist on the default `main` branch for GitHub to show **Run workflow**. No automatic push, pull-request or schedule trigger is configured.

## Repository configuration

GitHub repository **Settings → Secrets and variables → Actions**:

| Location | Name | Value source |
|---|---|---|
| Secrets | `SUPABASE_DB_URL` | Supabase Connect → Session pooler, IPv4, port 5432; password URL-encoded |
| Secrets | `SUPABASE_SERVICE_ROLE_KEY` | Admin-only legacy `service_role` JWT or modern `sb_secret_…` key |
| Variables | `VITE_SUPABASE_URL` | `https://tghcovjdsxirhpexpqor.supabase.co` |
| Variables | `VITE_SUPABASE_ANON_KEY` | The project's publishable key |

Never put admin credentials into repository files, workflow YAML, commits, chat or downloadable artifacts. Secrets are injected only into the hosted preflight/test/recovery steps, after dependency installation. The frontend build uses only the two public Variables.

## Two modes

1. **Read-only preflight (default):** leave `run_persona_tests` unchecked. It verifies the URL/DB project match, empty dev baseline, eight exact migration SQL hashes, 27 RLS tables, private 25 MiB PDF bucket, 92 rules, Google and Email Auth settings, and admin key read access. No users, projects, files, invitations, provider settings or migrations are changed. Successful preflight does not mean persona tests or real Google OAuth passed.
2. **Full persona validation:** check `run_persona_tests` only after authorizing synthetic tests on this empty DEV project. Before fixtures, it applies only reviewed migration `20261007000008_conflict_http409.sql` on an empty DEV project, or verifies the existing patch hash. This keeps the seven historical migrations immutable and changes only business conflict responses to HTTP 409. It then creates seven admin-confirmed test personas (one deliberately unconfirmed), obtains their real Supabase-issued JWTs, and runs 22 Auth/Database/Storage/Checkpoint C cases. For invited synthetic password identities to exercise membership flows it temporarily adds `email` to **app_config.allowed_providers**. It restores `{google}` and removes only the current run's synthetic users, projects, invitations and PDF objects. It never changes the global Auth signup switch, disables RLS, grants bootstrap execution to API roles, resets, deploys or calls AI.

All tested requests use public API key plus persona JWT; the admin key and SQL connection are only for preflight, the reviewed guarded conflict-code repair, and fixture setup/cleanup. The three checkpoint C HTTP cases cover uploaded PDF sealing with hash/ranges and immutable text, private draft CAS, and revision evidence/owner closure/reopening. The always-run recovery is followed by a read-only empty-baseline check. PDF page text in these RPC tests is synthetic; browser PDF extraction and real Google login still need their own verification.

## Running and reading results

Repository **Actions → BimbingTA hosted validation → Run workflow**, branch `main`. Keep the default DEV ref. First run the default preflight; after it passes, run full mode when authorized. Check the job's **Read-only hosted preflight**, **Persona Auth / Database / Storage / C** and **Recover current run and restore policy** steps. Missing or placeholder credentials fail preflight; they cannot create a green skipped hosted suite.

The launcher grants the GitHub token only `contents: read`, pins Actions by commit, limits time, and serializes runs. Full-mode recovery runs even if tests fail. Cleanup failures are failures, not warning-only passes. Do not cancel a full run while its temporary app provider allowance is active. A force-stopped runner can prevent cleanup: inspect the DEV dashboard and use its original `.secrets/hosted-run.json` recovery journal to rerun `node scripts/hosted-ci.mjs cleanup` in that runner while still available. The journal contains run ID/ref/provider baseline, never passwords or tokens, and is git-ignored; do not sweep unrelated users.

After full tests and verified cleanup, disable the Email provider in Supabase, keep Google and global signup enabled for new Google accounts, then follow G1–G8 in [HOSTED_SETUP.md](HOSTED_SETUP.md). No real owner has been activated by preparing this workflow.

References: [GitHub manual workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [GitHub Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).
