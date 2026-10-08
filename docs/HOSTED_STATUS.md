# Supabase dev: migration and validation status

Verified: **2026-10-07 18:44:53 WIB** (11:44:53 UTC).
Project: **bimbingTA-dev**, `tghcovjdsxirhpexpqor`; PostgreSQL 17.11.

All seven migrations and the toolkit seed were applied through the authenticated
Supabase Dashboard SQL Editor after owner confirmation. Each migration ran in its
own transaction and was recorded in `supabase_migrations.schema_migrations`, with
its exact SQL in `statements[1]`. No database reset, user deletion, or data purge
was run. Source: GitHub checkpoint C commit
`cb0cfc967a29136d985298122bb0b9627f9b31ec`.

The initial read-only inspection found no public tables, no project Auth users,
no thesis-files bucket, and zero recorded migrations. Dashboard sign-in is not
an application Google OAuth test.

## Hosted SQL inspection: 9/9 passed

| Inspection | Verified result |
| --- | --- |
| Migrations | All 7 recorded; SHA-256 of each stored SQL matches the tested source |
| Public tables | 27 tables; all have RLS enabled |
| PDF bucket | `thesis-files` is private; PDF only; maximum 26,214,400 bytes |
| Rubric | 92 rules; stored JSON equals the source; original source hash matches |
| Weights | Exact toolkit defaults; not provisional; final Bab I–V: 20/20/25/25/10 |
| Master prompt | Exact 2,448 bytes; computed content SHA-256 equals the source hash |
| App configuration | Google only; project quota 35 MiB; file cap 25 MiB; global guard 800 MiB |
| Anonymous privileges | No table-level CRUD privilege on public tables |
| Owner bootstrap | EXECUTE denied to both anon and authenticated API roles |

Rubric source SHA-256:
`756c63c4f0c4de476a37aa20d8f83386a39f09ce7c1e44359e94491e64b45569`.
Prompt source SHA-256:
`40a46c128cb2630c2e614cfce47342e4a037fcb754fd6fca2b0a5ec19f14672d`.

## Native hosted SQL validation: 40/40 passed

Verified **2026-10-07 19:02:23 WIB** (12:02:23 UTC) on the same PostgreSQL 17.11 project.
Source: [`tests/hosted/rollback.sql`](../tests/hosted/rollback.sql), GitHub commit
`3332b86b587f691abe2d733caa0080551795fe30`.
SQL SHA-256: `d4aeff48d941d01b9ca1a21d45139ee78390c955e5b0711fa7d49d1d474df700`.
The exact script first passed a local PostgreSQL/WASM rehearsal, then ran on hosted Supabase.
All 40 exported result rows had `passed = true`.

| Area | Native hosted behavior verified |
| --- | --- |
| Access | Owner/student claims; cross-project isolation; private notes; forbidden stage/owner bootstrap; outsider/unverified/email identities and anon denied |
| Naskah | Bound PDF path; final metadata size mismatch; chapter overlap; stale extraction; sealing and immutable text; printed labels independent of PDF page numbers |
| Autosave | Successful compare-and-swap; stale second session rejected; drafts private even from owner; cross-project draft/RPC denial |
| Collaboration | Comment/reply page scope; student cannot alter meeting decisions; notifications retained; unsafe HTTPS authority rejected |
| Revisions | Old proof refused; newer sealed proof accepted; student cannot close; owner closes; reopening requires reason and preserves audit |
| Export | Owner-only export receipt; incomplete manifest refused; referenced evidence cannot enter deletion |

Fixtures used simulated identity claims and synthetic Storage metadata, with real PostgreSQL
`SET LOCAL ROLE`, grants, RLS, triggers and RPCs. The complete transaction ended in `ROLLBACK`.
A separate hosted follow-up query confirmed **0 Auth users, 0 memberships, 0 projects,
0 versions, 0 PDF Storage rows, 0 audit events and 0 invitations**. Google-only configuration
was unchanged, including `app_config.row_version = 1`. No real owner was activated.

## Auth configuration inspection

The authenticated Dashboard currently shows Google and Email providers enabled,
global new-user signup ON, email confirmation ON, anonymous sign-in OFF, and manual linking OFF.
Site URL is the Emergent preview, with its `/**` redirect allowlist entry.
No Auth settings were changed. First-time application Google OAuth is still untested.

Additional read-only HTTP checks from this Codex workspace used only the existing publishable key:
`GET /auth/v1/settings` returned **200**, confirming Google/Email enabled, `disable_signup=false`,
and `mailer_autoconfirm=false`. Anonymous `GET /rest/v1/projects?select=id` and
`GET /rest/v1/app_config?select=id` both returned **401 / SQLSTATE 42501**, with no table data.
These verify public connectivity and two actual anonymous REST denials, not authenticated persona flows.

Correction to the earlier setup instructions: the global signup switch affects new OAuth users
as well. Keep it ON for first Google logins; disable the Email provider for production.
The synthetic HTTP suite leaves global signup unchanged and uses admin-created
password personas. It temporarily adds Email only to the application's provider allowlist,
then restores Google-only policy during cleanup; see
[HOSTED_SETUP.md](HOSTED_SETUP.md) and
[Supabase general configuration](https://supabase.com/docs/guides/auth/general-configuration).

## Remaining acceptance work

The hosted HTTP persona suite now passed **22/22** through GitHub Actions; see the
executed results below. This Codex workspace still has no admin credential values.
Real Google application login, browser cross-user flows on a hosted frontend,
browser PDF extraction, real owner bootstrap, production hosting and checkpoint D
AI integration remain pending. Synthetic password identities and RPC page text do
not prove real OAuth or browser extraction.

Follow [HOSTED_SETUP.md](HOSTED_SETUP.md): run synthetic hosted validation before
bootstrapping the real owner, then complete the real Google login checklist and
test owner/student flows on the deployed frontend. Do not reapply migrations
blindly: inspect the recorded versions first.

## GitHub Actions preparation

The manual hosted workflow has a default read-only preflight and an optional explicitly confirmed persona mode. The runner is pinned to this DEV ref, verifies the eight exact recorded migration SQL hashes and empty fixture baseline, supports legacy JWT and modern secret API-key headers, and fails on cleanup errors. Recovery only targets the current run, using a git-ignored journal. The full suite contains 22 cases including three checkpoint C HTTP/RPC flows. Full mode includes the guarded eighth conflict-code migration and a read-only cleanup verification. Preparation and successful preflight alone do not constitute persona/OAuth acceptance; see the executed run below. See [HOSTED_ACTIONS.md](HOSTED_ACTIONS.md).

## GitHub Actions read-only preflight: passed

Verified **2026-10-08 04:02:57 WIB** (2026-10-07 21:02:57 UTC).
[Workflow run 37684941532](https://github.com/indrawaspada/bimbing-TA/actions/runs/37684941532),
attempt 2, [job 113015664119](https://github.com/indrawaspada/bimbing-TA/actions/runs/37684941532/job/113015664119).
Launcher commit `9be58767cf121b33110895450d4a301b13fa4d5e` checked out reviewed source
`da3f69fe94680521c9bb4df6691f47e0ce2a3fbe` with Node 22.23.3.

Dependency installation, TypeScript validation, production frontend build and hosted preflight all passed.
The runner confirmed the empty DEV baseline, seven exact migration SQL hashes, 27 RLS tables,
private PDF bucket with its size/type limits, 92 rubric rules, public Auth settings and admin Auth read access.
Database access used a read-only transaction. No database, Storage, Auth-provider or migration writes occurred.
Admin values remained in GitHub Actions Secrets; none were retrieved into this workspace or published.

The persona and recovery steps were deliberately skipped in default preflight mode.
At that preflight run, the 22 persona cases were still pending. They subsequently passed below.
Real Google login, owner bootstrap and production hosting remain pending.

## Hosted HTTP persona validation: 22/22 passed

Verified **2026-10-08 04:25:54 WIB** (2026-10-07 21:25:54 UTC).
[Workflow run 37689118489](https://github.com/indrawaspada/bimbing-TA/actions/runs/37689118489),
[job 113024468784](https://github.com/indrawaspada/bimbing-TA/actions/runs/37689118489/job/113024468784).
Launcher `729b93f94ab369fa2896280da98edbfb34a95972` checked out reviewed source
`bfdfd479d1c4d75b088833ada56c21e748b12258`. Dependency installation,
TypeScript validation, frontend build, guarded conflict repair, preflight,
22 persona cases, recovery and final read-only cleanup verification all passed.

| Hosted suite | Result |
| --- | --- |
| Auth: Supabase-issued JWTs, unconfirmed email, provider restriction, spoofed metadata and tampered token | 5/5 |
| Database: project isolation, grants/RLS, private notes, outsider/anon denial, owner decisions, CAS and rubric | 9/9 |
| Storage API: bound PDF uploads, cross-user/unbound/overwrite denial, content type, signed URL/download isolation and deletion denial | 5/5 |
| Checkpoint C RPC: sealed PDF, stale/sealed text denial, private draft CAS and revision evidence/owner closure/reopening | 3/3 |

The initial full run [37687240188](https://github.com/indrawaspada/bimbing-TA/actions/runs/37687240188)
passed 20/22: the stale PDF edit timed out at the `40001` business conflict,
and revision submission then failed because its prerequisite PDF had not been sealed.
Cleanup passed, and independent read-only run
[37687996106](https://github.com/indrawaspada/bimbing-TA/actions/runs/37687996106)
confirmed the empty Google-only DEV baseline at 04:15:16 WIB.

The corrective migration `20261007000008_conflict_http409.sql` changes only the
conflict SQLSTATE in `app.editable_version` and `public.finding_transition` to
`PT409`. The seven historical migration files remain immutable; function access
checks, security-definer settings and existing ACLs are preserved. This follows
[Supabase's documented PostgREST retry issue](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).
The HTTP suite now asserts **409 / PT409 / edit_conflict**, rather than bypassing
the stale-edit case. The revised source passed 27/27 disposable local SQL/serializer
checks and the frontend build before the hosted rerun. All eight stored migration
SQL hashes matched the reviewed source during the final hosted preflight.

Seven synthetic users were created; the six confirmed personas obtained real
Supabase Auth tokens, while the unconfirmed login was denied. All requests under
test used the public key and the relevant persona JWT. Admin credentials stayed in
GitHub Secrets and were used only for guarded repair, setup and cleanup.
The temporary application Email allowance was restored to **Google only**.
Cleanup passed at 04:25:49 WIB; final read-only preflight at 04:25:54 WIB verified
**0 Auth users, 0 memberships, 0 projects, 0 invitations and 0 thesis PDF objects**.
No real owner was activated; no reset, production deployment or AI call occurred.

This verifies authenticated hosted APIs with synthetic personas and PDF/text
fixtures. Real application Google OAuth, browser PDF extraction and deployed
owner/student UI flows still require separate acceptance checks.
