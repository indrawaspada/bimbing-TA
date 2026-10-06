# Kontrak data dan API — implementasikan dalam migrations

Semua UUID generated server; FK dan unique constraints nyata. Timestamp UTC, tampilan Asia/Jakarta. Default project ownership immutable; owner workspace tunggal. Semua tabel mempunyai created_at/updated_at; row_version untuk perubahan bersamaan. RLS deny-by-default. Relasi penting tidak boleh diubah mahasiswa melalui REST maupun fungsi.

| Entitas | Kolom/relasi inti | Hak akses |
|---|---|---|
| memberships | auth_user_id unique, verified_email, role owner/student, active | Server claims undangan; role/active hanya owner/admin function; student baca identitas sendiri |
| invitations | normalized_email unique, claimed_uid, active | Owner menambah; server claim dari verified auth identity; tidak student-editable |
| projects | id, student_uid, owner_uid, title, research_profile, stage, storage_limit_bytes | Student baca/edit field naskah proyek sendiri; assignment dan quota hanya owner |
| versions | id, project_id, sequence, file_path, file_hash, extraction_hash, status uploaded/extracting/confirmed/failed, submitted_by, change_summary | Student insert/upload own draft; confirmed immutable; sequence unique per proyek |
| pages | version_id, pdf_page, printed_label, text, text_hash | Own project; edit hanya draft; RLS melalui version→project |
| chapter_ranges | version_id, chapter B1…B5, start/end, confirmed | Rentang tidak melampaui PDF; hash masuk review context |
| comments | project_id, version_id?, pdf_page?, finding_id?, parent_id?, author_uid, body | Shared in own project; author edit own body; immutable parent/project/author; parent FK harus proyek sama |
| private_notes | project_id, owner_uid, body | Hanya owner select/write, termasuk ekspor |
| findings | project_id, version_id, run_id?, rule_id?, severity, confidence, rule_status, evidence, page/scope, quote_validation, recommendation, acceptance_criterion, approval_state draft/accepted/rejected, workflow_status, revision_proof | Owner approval/close/reopen; student hanya progress/submission proof lewat RPC terbatas; tidak edit temuan dosen |
| milestones | project_id, name, due_at, status, completed_at | Owner menyetujui completion; student menyampaikan progress |
| meetings | project_id, date, agenda, decisions, next_targets, meeting_url | Owner keputusan; student baca, usulan melalui comments |
| resources | project_id, kind paper/repo/demo/video, title, https_url, optional_file_path | Own project; authorized private attachments; tidak fetch URL otomatis di server |
| notifications | user_id, project_id, type, read_at, entity_id | Recipient only; event server validates project; unique event to avoid duplicates |
| traceability_rows | project_id, objective_id, problem, theory_locator, method_locator, evaluation, result_locator, conclusion_locator, status | Student propose/edit own project; owner verifies; locator version-aware |
| rubric_versions | version, content_json, hash, dimension_weights | Auth users read; owner versioned updates; old reviewed snapshot immutable |
| model_settings | provider enum, model_id, price_config, capability, enabled, roles_allowed, config_hash, last_tested | Owner edits; student reads safe allowlisted fields only; contains no key |
| ai_runs | project_id, version_id, scope_hash, rubric_hash, model_hash, prompt_version, idempotency_key unique, state, requester_uid, normalized_result, usage, error_code | Own project read; server writes; user cannot mark succeeded or refund budget |
| usage_reservations | run_id unique, month, max_cost, actual_cost?, status held/reconciled/unknown | Server atomic updates; owner reads; student own sanitized usage |
| budget_settings | month, max_cost, max_calls, per_student_calls, ai_enabled | Owner only; atomic reserve against active month |
| audit_events | actor_uid, project_id, action, entity_id, version, timestamp | Server writes for approve/reject/close/permissions; owner reads; no raw secret or full provider prompt in logs |

Jumlah tabel dapat digabung secara wajar oleh implementer tanpa mengubah ownership dan privacy. Tidak menggabung private notes ke shared comments. JSON untuk locator/evidence/config menghemat tabel; ownership tetap FK terverifikasi.

## State dan transisi

- Version confirmed immutable. Pasted correction menghasilkan versi/ekstraksi baru dengan hash, bukan mengganti konteks review lama.
- Finding draft tidak sama dengan revision Open. Dosen accept → Open; mahasiswa In progress → Submitted dengan proof; dosen Verified closed atau Reopened.
- ai_run pending → running (atomic claim) → succeeded/failed/unknown. Browser polling berakhir pada terminal state. Provider success dengan response JSON invalid = failed. Cancellation browser tidak menjamin provider batal/biaya nol.
- Simpan reject reason dan approved edits; gunakan audit. Assignment transfer antarmahasiswa tidak tersedia pada MVP.

## Edge Functions / RPC minimal

| Operasi | Input | Pemeriksaan/keluaran |
|---|---|---|
| claim-membership | JWT; tidak email/role dari client | Get verified identity; active invitation; UID bind; noninvited denial |
| owner-invite | email, active | Owner only; normalized verified claim, tanpa email delivery otomatis |
| ai-config-status | JWT | Safe model list, configured flags, quota; tidak key |
| ai-test | provider, model_id | Owner only explicit click; tiny request, usage logged; whitelist model/host |
| ai-run | project_id, version_id, chapter/scope, operation review/chat/traceability, model_id, user question, idempotency key | JWT; project authorization; context loaded server; reservation; result/run_id |
| ai-run-status | run_id | Own project auth; sanitized state/error/result |
| finding-transition | id, new_status, row_version, proof | Role-based allowed transition; atomic compare-and-update |
| finding-approve | id, edited_fields, row_version | Owner only; preserve original AI draft/audit |
| export-project | project_id | Own access; student export excludes private notes/owner settings; owner full authorized backup |

CRUD via Supabase client only where RLS + grants provide exact field permissions; use RPC for column restrictions/state. Row RLS alone tidak membatasi kolom role/owner/status. Jangan membuat generic service-role CRUD proxy.

## Review JSON normalized

```json
{
  "schema_version": "1.0",
  "summary": "...",
  "inspected_scope": {"chapter": "B3", "pdf_pages": [12,13]},
  "rule_assessments": [{"rule_id": "B3-R01", "status": "Not assessed", "reason": "Text extraction does not expose diagrams"}],
  "findings": [{
    "rule_id": "B3-R17", "severity": "Critical", "confidence": "high",
    "status": "Fail", "evidence_type": "quote",
    "locator": {"pdf_page": 13, "printed_label": null, "section": "3.4"},
    "quote": "EXACT TEXT THAT MUST OCCUR ON PAGE",
    "reason": "...", "impact": "...", "recommendation": "...",
    "acceptance_criterion": "..."
  }],
  "dimension_ratings": [{"dimension": "evaluation", "status": "Not assessed", "rating": null, "reason": "..."}],
  "limitations": ["No image or full referenced-paper inspection"],
  "next_steps": ["..."]
}
```

Validator: known enum and rule IDs; rule chapter valid; max arrays/strings; page exists in sent scope; quote whitespace-normalized containment. Evidence type gap uses quote=null and inspected page scope, never fabricated missing-section quotation. If incompatible scope/invalid rating mark failed validation or unverified finding. LLM cannot supply provider costs, confirmed indexing, authoritative approval, user IDs or final score.

## Provider adapter contract

`generate({modelId, systemText, contextText, question, limits}) → {text, nativeUsage, inputTokens, billedOutputTokens, finishReason, requestId}`.

- OpenAI: official Responses endpoint; `store:false` where supported; parse output text content, no assumption all output items text. Cap max output and supported effort; usage includes reasoning details.
- Anthropic: official Messages; system separate; parse text blocks, handle refusal/tool/stop reason; cap max_tokens and supported thinking budget. Header version per current docs.
- Gemini: official generateContent; systemInstruction, contents, generationConfig; parse candidates/parts and safety/finish reason; total usage normalized without losing thought tokens.
- API URL and secret source fixed per provider; model whitelist config; no arbitrary URL fetch. Validate supported parameters with current model docs before shipping; do not force a parameter for all models.
- All adapters text-only in P0. Visual mode is unimplemented until P1, even if the seed model supports vision. Structured schema used where supported, otherwise strict parse/validation; no hidden second paid correction call.
