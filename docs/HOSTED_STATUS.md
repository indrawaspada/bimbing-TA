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
The existing synthetic HTTP suite expects global signup OFF only during its admin-created
password-persona test. Restore it before the real Google checklist; see
[HOSTED_SETUP.md](HOSTED_SETUP.md) and
[Supabase general configuration](https://supabase.com/docs/guides/auth/general-configuration).

## Still pending

The 9 structure inspections and 40 native SQL checks are real hosted database results,
not a complete hosted HTTP security acceptance suite. Supabase-issued persona JWTs,
authenticated PostgREST behavior, Storage API uploads/downloads, browser cross-user flows, and
application Google OAuth have not been tested on hosted Supabase.
The `yarn test:hosted` suite has not been run in this Codex workspace; its DB URL
and service-role configuration are unavailable here. No real owner account has
been bootstrapped. Production hosting and checkpoint D AI integration remain
pending.

Follow [HOSTED_SETUP.md](HOSTED_SETUP.md): run synthetic hosted validation before
bootstrapping the real owner, then complete the real Google login checklist and
test owner/student flows on the deployed frontend. Do not reapply migrations
blindly: inspect the recorded versions first.
