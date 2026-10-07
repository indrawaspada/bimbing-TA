# Supabase dev: migration status

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

## Still pending

These are real hosted SQL inspection results, not the hosted security acceptance
suite. Persona JWTs, PostgREST behavior, Storage API uploads/downloads, cross-user
flows, and application Google OAuth have not been tested on hosted Supabase.
The `yarn test:hosted` suite has not been run in this Codex workspace; its DB URL
and service-role configuration are unavailable here. No real owner account has
been bootstrapped. Production hosting and checkpoint D AI integration remain
pending.

Follow [HOSTED_SETUP.md](HOSTED_SETUP.md): run synthetic hosted validation before
bootstrapping the real owner, then complete the real Google login checklist and
test owner/student flows on the deployed frontend. Do not reapply migrations
blindly: inspect the recorded versions first.
