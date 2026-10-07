# Hosted validation through GitHub Actions

The manual workflow **BimbingTA hosted validation** runs on GitHub's Ubuntu runner with Node 22 and Yarn 1.22.22. It checks out an exact reviewed checkpoint C commit, not a moving branch. The small launcher must exist on the default `main` branch for GitHub to show **Run workflow**; the application remains in the checkpoint C draft PR. No automatic push, pull-request or schedule trigger is configured.

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

1. **Read-only preflight (default):** leave `run_persona_tests` unchecked. It verifies the URL/DB project match, empty dev baseline, seven exact migration SQL hashes, 27 RLS tables, private 25 MiB PDF bucket, 92 rules, Google and Email Auth settings, and admin key read access. No users, projects, files, invitations, provider settings or migrations are changed. Successful preflight does not mean persona tests or real Google OAuth passed.
2. **Full persona validation:** check `run_persona_tests` only after authorizing synthetic tests on this empty DEV project. It creates seven admin-confirmed test personas (one deliberately unconfirmed), obtains their real Supabase-issued JWTs, and runs 22 Auth/Database/Storage/Checkpoint C cases. For invited synthetic password identities to exercise membership flows it temporarily adds `email` to **app_config.allowed_providers**. It restores `{google}` and removes only the current run's synthetic users, projects, invitations and PDF objects. It never changes the global Auth signup switch, disables RLS, grants bootstrap execution to API roles, resets, deploys or calls AI.

All tested requests use public API key plus persona JWT; the admin key and SQL connection are only for preflight and fixture setup/cleanup. The three checkpoint C HTTP cases cover uploaded PDF sealing with hash/ranges and immutable text, private draft CAS, and revision evidence/owner closure/reopening. PDF page text in these RPC tests is synthetic; browser PDF extraction and real Google login still need their own verification.

## Running and reading results

Repository **Actions → BimbingTA hosted validation → Run workflow**, branch `main`. Keep the default DEV ref. First run the default preflight; after it passes, run full mode when authorized. Check the job's **Read-only hosted preflight**, **Persona Auth / Database / Storage / C** and **Recover current run and restore policy** steps. Missing or placeholder credentials fail preflight; they cannot create a green skipped hosted suite.

The launcher grants the GitHub token only `contents: read`, pins Actions by commit, limits time, and serializes runs. Full-mode recovery runs even if tests fail. Cleanup failures are failures, not warning-only passes. Do not cancel a full run while its temporary app provider allowance is active. A force-stopped runner can prevent cleanup: inspect the DEV dashboard and use its original `.secrets/hosted-run.json` recovery journal to rerun `node scripts/hosted-ci.mjs cleanup` in that runner while still available. The journal contains run ID/ref/provider baseline, never passwords or tokens, and is git-ignored; do not sweep unrelated users.

After full tests and verified cleanup, disable the Email provider in Supabase, keep Google and global signup enabled for new Google accounts, then follow G1–G8 in [HOSTED_SETUP.md](HOSTED_SETUP.md). No real owner has been activated by preparing this workflow.

References: [GitHub manual workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [GitHub Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).
