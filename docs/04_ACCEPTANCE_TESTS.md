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

A passing mock is not evidence that production credentials or all frontier models work. Record date, environment, cases, actual pass/fail, live-vs-mocked provider and remaining limits. Credit usage measured separately in Emergent dashboard.

## B01/B02 local rehearsal — 9 October 2026

`yarn test:restore`: **22/22 passed** on Windows/Node 24.15.0 (initial runner: 17/17). Manual project ZIPs are validated and restored into fresh disposable PostgreSQL WASM with all source migrations and active guards/RLS. New IDs relink source versions, revision proof, comment replies and traceability locators. PDF bytes and sealed extraction hashes match; rollback leaves no project, Auth, Storage or audit fixtures. Corrupt/missing/unmanifested files, duplicate/unsafe ZIP paths, oversized entries, cross-project or incorrectly typed IDs, stale proof hashes, invalid locators and unsupported data are refused.

The complete local UI suite also passed: its actual exported ZIP (two original PDFs, one revision, comment, meeting, resource and traceability row) passed `scripts/restore-backup.mjs`. CLI revalidation of that ZIP also passed after the latest changes. Tests cover a pending-student project without PDFs, failed uploads without inventing files, and older checkpoint C ZIPs. Deleted leading versions and gaps such as v1/v4 retain their numbers and proof; the original versions guard definition remains identical and temporary markers are absent from final rows/Storage, including when the file quota is exactly full. Invalid/duplicate sequence numbers or numbers above 2048 are refused. Locator page IDs must belong to the stated version/index, and a finding locator cannot redirect to another version. Auth/Storage remain synthetic; PDF bytes are checked in memory, not uploaded to Supabase. AI history and legacy resource attachments remain unsupported and fail explicitly. There is no hosted/apply mode. B02 hosted restore remains **pending**; original audit, private notes, drafts, real identities and global AI configuration are outside this export scope. See `CHECKPOINT_D.md` for CLI use and limits.
