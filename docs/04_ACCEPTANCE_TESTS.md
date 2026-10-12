# Acceptance MVP — meaningful tests

Fixtures: one verified owner, student A, student B, outsider, anonymous; two projects with different PDF and notes. Synthetic academic text only. Tests that read through UI alone are insufficient for access control; use authorized clients/REST and object paths.

| ID | Scenario | Expected |
|---|---|---|
| S01 | A opens B project via direct URL/REST | Denied/no rows; no B metadata leak |
| S02 | A accesses B PDF, page text, finding, AI run, export | Denied, including signed-URL creation; know object path insufficient |
| S03 | A sets role/owner/student assignment using REST | Denied; owner unchanged |
| S04 | A reads/exports owner private note | No access; student backup does not include note |
| S05 | Outsider Google login and invitation spoof | No data; verified identity must match unclaimed active invite |
| S06 | Anonymous CRUD/API run | Unauthorized |
| S07 | Student directly closes finding or edits owner approval | Denied even when valid own-project ID |
| S08 | Service endpoint with spoofed role/project, arbitrary provider URL | Denied; cannot proxy arbitrary host |
| P01 | Upload PDF, select ranges, confirm, refresh/relogin | Real file/text/version retained |
| P02 | Empty/scan PDF | No invented review; paste-text fallback; graphics Not assessed |
| P03 | Oversize/quota exceeded/upload interrupted | Clear failure, retry; no ghost confirmed version |
| P04 | New version after review; old finding opened | Old locator still points to original immutable version |
| P05 | Draft edit from two sessions | Conflict reported; no silent overwrite |
| W01 | Owner accepts AI/manual finding; student submits proof | Owner verifies closure or reopens; audit preserved |
| W02 | Comment/reply, new milestone, meeting next target | Persistent; unread/due soon works; correct Jakarta display |
| W03 | Demo/video link | Valid HTTPS, safe external link, no paid video hosting |
| W04 | Phone and desktop | PDF accessible, touch targets and forms usable; route refresh works |
| A01 | No keys/budget disabled | All manual workflows usable; AI clearly unavailable |
| A02 | Invalid key/unavailable model/429/refusal/timeout | Actionable state; no fabricated success or silent paid fallback |
| A03 | Two simultaneous same idempotency requests | One provider call and one reservation; no double run |
| A04 | Concurrent runs exceed monthly cap | Atomic limit enforced; no overspend within configured reservation model |
| A05 | Exact same sealed scope/rubric/model review | Cache reused without new provider call; edit hash invalidates cache |
| A06 | Invalid JSON/unknown rule/out-of-scope page/quote mismatch | Failed or unverified; never auto-approved; no revision creation |
| A07 | Prompt injection inside PDF | Treated as thesis content; cannot obtain keys/change instructions |
| A08 | Claims about diagram or paper indexing in text mode | Not assessed/unverified; no confirmed visual/index verdict |
| A09 | Long chapter clipping | User sees exact sent range and excluded parts; no whole-chapter conclusion |
| A10 | Each adapter contract fixture + live configured model | Parse normalized content/usage; mark mock-only adapters; tiny live test only on enablement |
| B01 | CSV/JSON/file backup | Correct authorized records/files and hashes, no secrets/private notes for student |
| B02 | Backup restored to test project in maintenance dry-run | Versions and findings relinked correctly; production untouched |
| D01 | Cloudflare frontend + Supabase functions production | Login redirects, CORS, JWT, RLS, preview and routes work |

Scoring kernel tests: all full ratings→100; Not assessed reduces coverage not score; N/A excluded; no assessed dimensions→null score; invalid rating/weight raises; critical fails show despite high score. Frontend must not accept LLM-provided totals.

A passing mock is not evidence that production credentials or all frontier models work. Record date, environment, cases, actual pass/fail, live-vs-mocked provider and remaining limits. Live provider usage/cost is recorded only after explicit owner permission; this project uses Cloudflare Pages + Supabase, without Emergent deployment or credits.

## B01/B02 local rehearsal — 9 October 2026

This section records offline/SQL evidence. The newer current-data Auth/PostgREST/Storage run below now supplies 26/26 synthetic native service checks; general operator/production recovery and Google/browser acceptance remain pending.

`yarn test:restore`: **28/28 passed** on Windows/Node 24.15.0 (initial runner: 17/17; offline cases: 22/22). Manual project ZIPs are validated and restored into fresh disposable PostgreSQL WASM with all source migrations and active guards/RLS. New IDs relink source versions, revision proof, comment replies and traceability locators. PDF bytes and sealed extraction hashes match; rollback leaves no project, Auth, Storage or audit fixtures. Corrupt/missing/unmanifested files, duplicate/unsafe ZIP paths, oversized entries, cross-project or incorrectly typed IDs, stale proof hashes, invalid locators and unsupported data are refused.

The complete local UI suite also passed: its actual exported ZIP (two original PDFs, one revision, comment, meeting, resource and traceability row) passed `scripts/restore-backup.mjs`. CLI revalidation of that ZIP also passed after the latest changes. Tests cover a pending-student project without PDFs, failed uploads without inventing files, and older checkpoint C ZIPs. Deleted leading versions and gaps such as v1/v4 retain their numbers and proof; the original versions guard definition remains identical and temporary markers are absent from final rows/Storage, including when the file quota is exactly full. Invalid/duplicate sequence numbers or numbers above 2048 are refused. Locator page IDs must belong to the stated version/index, and a finding locator cannot redirect to another version. Auth/Storage remain synthetic; PDF bytes are checked in memory, not uploaded to Supabase. AI history and legacy resource attachments remain unsupported and fail explicitly. The offline CLI has no hosted/apply mode. Full B02 file-service restore remains **pending**; original audit, private notes, drafts, real identities and global AI configuration are outside this export scope. See `CHECKPOINT_D.md` for CLI use and limits.

Six additional tests cover a nonempty target with existing owner/project/private data, explicit owner mapping, SQL RLS, rollback after mid-restore failure, unchanged 31 table counts/content hashes, version gaps and rejection of apply/missing target confirmation. Separate `scripts/hosted-restore-rehearsal.mjs` has no commit/API/provider path. [Native hosted run 37875028465](https://github.com/indrawaspada/bimbing-TA/actions/runs/37875028465), source `170b984`, passed **2/2** scenarios at **02:33:47 UTC, 9 October 2026**: v1/v2 and v1/v4, relinked manual data/proof, SQL role/Storage RLS, rollback and identical original data across 31 tables. PDFs/Storage metadata/JWT claims are synthetic; no real Auth/Storage APIs, Google login or persistent restore occurred. This is partial native B02 evidence, not full file-service acceptance.

## Native ledger concurrency in isolated CI — 9 October 2026

`yarn test:ledger:native` requires a fresh dedicated localhost PostgreSQL 17 database in `BT_NATIVE_LEDGER_DB_URL`, never Supabase env. [Run 37877916874](https://github.com/indrawaspada/bimbing-TA/actions/runs/37877916874), source `f4023bd`, **11/11 passed** at **03:09:30 UTC**, PostgreSQL 17.11: nine database cases with actual distinct backend connections and **seven observed budget-lock waits**, plus two target/initialization safeguards. A03/A04/A05 and A01/ACL now have this native SQL evidence: one committed idempotent claim/reservation, atomic monthly cost/count caps, single active project run, rollback, cache provenance and no fresh dispatch/reservation, conflicting idempotency scope, disabled budget and service-only RPCs. No provider callback is executed and no production/dev AI setting is changed. This is separate from PGlite/mock tests and Supabase Edge/HTTP/live acceptance; A03 does not yet prove a live provider call path. See `CHECKPOINT_D.md` for exact environment and remaining acceptance.

## Current-data file service rehearsal — 9 October 2026

`yarn test:file:qa`: **9/9 local tests passed** on a nonempty disposable SQL target with original owner/project/private notes, simulated Auth/Storage transport and actual RLS. Original-project/user journal substitution, fixture ZIP changes, partial-transfer/cleanup failure and retry are covered.

[Run 37880731555](https://github.com/indrawaspada/bimbing-TA/actions/runs/37880731555), source `c356258`, **26/26 hosted checks passed** at **03:47:39 UTC** on documented DEV. Three admin-confirmed password identities received actual Supabase JWTs; two memberships were explicitly SQL-enrolled fixtures, not Google claims. Original Google-only policy still refused the invited email outsider. Asserted PostgREST/Storage/Edge requests used public key + relevant student JWT, never admin key. Two opaque synthetic PDF files (**94 bytes**) transferred through real upload/download/signed URL APIs with matching hashes and relinked versions/proof/replies/pages. Cross-user/anon/private-note/role/owner/overwrite denials passed. Student Edge status returned no provider configuration or provider action.

Recovery scope was artifacted before mutation. All committed Auth/project/Storage/record fixtures were removed, and **31 original table counts/content hashes matched exactly**. No owner session, migration, seed, provider/Auth setting change or AI activation occurred. This is native service-layer S01–S07 and manual B02 evidence; source is a synthetic ZIP, fixture membership bypasses first-time OAuth, file bytes are not parsed/rendered, and no operator ZIP or persistent production recovery is supported by this runner. Google student/browser PDF and full maintenance/production acceptance remain separate.

## Account-switch browser regression — 11 October 2026

The local UI suite now delays a valid owner membership response, broadcasts a synthetic student sign-in through the installed Supabase client, waits for student navigation, then releases the old response. Before the fix it incorrectly restored owner menus/name/private-note navigation; after the fix only the latest claim controls membership, errors and loading. Old initialization/claim results are invalidated on session changes and unmount. Database access remains enforced by JWT/RLS.

Production build/frontend TypeScript, Edge TypeScript and the complete local browser suite passed, including PDF upload/render/extraction/sealing/reload, traceability at desktop/mobile widths, drafts, collaboration, revisions and ZIP export/restore. These are synthetic sessions/Storage and disposable SQL/WASM. They do not complete Google OAuth, hosted browser PDF or production acceptance. AI remains OFF.

## Partial PDF page recovery — 11 October 2026

The local UI suite reproduces a two-page PDF with only the first manual page saved. Before the fix no manual continuation action was available. The editable version now offers **Lengkapi halaman untuk teks manual**, adding only missing indices with the existing version compare-and-swap guard. Existing text/labels/source/page IDs/hashes are preserved; initialization waits for the saved page list and fixes the already-recorded page count.

The browser regression injects one failed save (503), verifies the error/retry action and unchanged first page, then retries successfully. Only the empty second page is created; the entire first-page row including hash and row version stays identical, the version becomes `extracted`, and manual text survives reload. Production build, Edge TypeScript and the complete local UI suite passed. This supplements local PDF/manual-fallback evidence; it does not prove hosted upload interruption, Google OAuth or production acceptance. Auth/Storage are synthetic, SQL/RLS disposable and AI remains OFF.

## Slow autosave and two-tab conflicts — 12 October 2026

A local browser regression reproduced false saved status: while a first SQL save had committed but its response was withheld, a newer edit used the old row version, conflicted and was never persisted. The late first response then showed **Tersimpan**. Saves from one hook instance are now serialized, use the acknowledged version and continue with the latest values; success is shown only when current input matches the acknowledged snapshot.

The regression holds the first response beyond the 1,200 ms debounce, checks the newest database text and reload persistence. Separate owner browser contexts then prove the genuine stale second-tab save still reports conflict and leaves the first tab's text unchanged; loading the latest version resolves the view. Production build, Edge TypeScript and the complete local UI suite passed. This is local optimistic-lock/UI evidence, with synthetic Auth/Storage and real disposable SQL/RLS, not new Google OAuth or hosted acceptance. No migration, hosted data or AI configuration changed; AI stays OFF.

## Project navigation and stale loaders — 12 October 2026

The local SPA regression holds the new project's GET response and checks that previous-project metadata/forms are absent under its URL. Before the fix the previous project's heading and summary form remained visible. Workspaces now remount on project-ID changes, giving loaders, forms and drafts a fresh project scope.

Two further cases hold project A's response, navigate back to B, edit B and then release A with either success or a 503 error. B's title/student identity/input stay intact, its new summary is persisted and the entire original A project row stays identical. Production build, Edge TypeScript and the complete local UI suite passed. This tests same-owner navigation using synthetic Auth/Storage and disposable SQL/RLS; it is not cross-user hosted/Google acceptance. AI remains OFF.
