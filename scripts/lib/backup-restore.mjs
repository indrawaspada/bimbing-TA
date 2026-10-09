// Offline project-backup rehearsal. No hosted clients, credentials or provider calls.
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { PGlite } from "@electric-sql/pglite";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
export const MAX_VERSION_SEQUENCE = 2048;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TABLES = ["versions", "findings", "comments", "meetings", "resources", "milestones", "traceability_rows"];
const AI_TABLES = ["ai_runs", "ai_messages", "ai_rating_reviews"];
const EXCLUDED = ["private_notes", "workspace_drafts", "auth", "credentials"];
const REF_KEYS = new Set(["id", "project_id", "version_id", "source_version_id", "page_id", "finding_id", "parent_id", "invitation_id", "owner_uid", "student_uid", "created_by", "author_uid", "submitted_by", "confirmed_by", "approved_by", "closed_by"]);
export class BackupError extends Error {
  constructor(code) { super(code); this.name = "BackupError"; this.code = code; }
}
const ensure = (ok, code) => { if (!ok) throw new BackupError(code); };
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const digest = (v) => createHash("sha256").update(v).digest("hex");
const parse = (v) => {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(v)); }
  catch { throw new BackupError("invalid_backup_json"); }
};

export function inspectBackup(bytes) {
  ensure(bytes instanceof Uint8Array && bytes.length <= MAX_BACKUP_BYTES, "archive_size_limit");
  const seenPaths = new Set();
  let total = 0, files;
  try {
    files = unzipSync(bytes, { filter: (entry) => {
      ensure(!seenPaths.has(entry.name), "duplicate_archive_path");
      seenPaths.add(entry.name);
      ensure(seenPaths.size <= 2048, "archive_entry_limit");
      ensure(["manifest.json", "metadata.json", "revisi.csv", "laporan.html"].includes(entry.name) || /^files\/[0-9a-f-]{36}\.pdf$/.test(entry.name), "unexpected_archive_path");
      const cap = entry.name === "metadata.json" ? 64 * 1024 * 1024
        : entry.name === "manifest.json" ? 1024 * 1024
        : entry.name.endsWith(".pdf") ? 26214400 : 16 * 1024 * 1024;
      ensure(Number.isSafeInteger(entry.originalSize) && entry.originalSize >= 0 && entry.originalSize <= cap, "archive_entry_size_limit");
      total += entry.originalSize;
      ensure(total <= MAX_BACKUP_BYTES, "archive_expanded_size_limit");
      ensure(entry.compression === 0 || entry.compression === 8, "unsupported_zip_compression");
      return true;
    } });
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError("invalid_zip_archive");
  }
  ensure(files["manifest.json"] && files["metadata.json"] && files["revisi.csv"] && files["laporan.html"], "incomplete_zip_archive");
  const manifest = parse(files["manifest.json"]), metadata = parse(files["metadata.json"]);
  ensure(object(manifest) && manifest.format === "bimbingta-backup" && manifest.schema_version === 1, "unsupported_manifest_schema");
  ensure(Object.keys(manifest).every((k) => ["format", "schema_version", "project_id", "created_at", "metadata_sha256", "files", "excluded", "not_included"].includes(k)), "unexpected_manifest_section");
  ensure(object(metadata) && metadata.format === "bimbingta-project" && metadata.schema_version === 1 && metadata.scope === "authorized_project_without_private_notes", "unsupported_metadata_schema");
  const allowed = new Set(["format", "schema_version", "exported_at", "scope", "project", "documents", ...TABLES, ...AI_TABLES]);
  ensure(Object.keys(metadata).every((k) => allowed.has(k)), "unexpected_metadata_section");
  ensure(object(metadata.project) && UUID.test(metadata.project.id) && UUID.test(metadata.project.owner_uid), "invalid_project_identity");
  ensure(metadata.project.student_uid == null || UUID.test(metadata.project.student_uid), "invalid_student_identity");
  ensure(manifest.project_id === metadata.project.id, "manifest_project_mismatch");
  ensure(digest(files["metadata.json"]) === manifest.metadata_sha256, "metadata_hash_mismatch");
  ensure(Array.isArray(manifest.excluded) && manifest.excluded.length === EXCLUDED.length && EXCLUDED.every((k) => manifest.excluded.includes(k)), "invalid_exclusion_manifest");
  ensure(Array.isArray(manifest.files) && Array.isArray(manifest.not_included), "invalid_file_manifest");
  // Older checkpoint C archives have no traceability/AI arrays.
  for (const table of [...TABLES, ...AI_TABLES]) {
    if (metadata[table] === undefined && (table === "traceability_rows" || AI_TABLES.includes(table))) metadata[table] = [];
    ensure(Array.isArray(metadata[table]) && metadata[table].length <= 50000, "invalid_table_rows");
    for (const row of metadata[table])
      ensure(object(row) && UUID.test(row.id) && row.project_id === metadata.project.id, "row_project_mismatch");
  }
  ensure(Array.isArray(metadata.documents) && metadata.documents.length === metadata.versions.length, "incomplete_documents");
  const versions = new Map(metadata.versions.map((v) => [v.id, v]));
  ensure(versions.size === metadata.versions.length, "duplicate_version_id");
  const entries = new Map();
  for (const entry of manifest.files) {
    ensure(object(entry) && UUID.test(entry.version_id) && entry.path === `files/${entry.version_id}.pdf`, "invalid_file_manifest_entry");
    ensure(!entries.has(entry.version_id), "duplicate_file_manifest_entry");
    const version = versions.get(entry.version_id), content = files[entry.path];
    ensure(version && version.status !== "upload_failed" && content, "missing_or_unexpected_pdf");
    ensure(Number.isSafeInteger(entry.size) && entry.size === content.length && Number(version.file_size) === content.length, "pdf_size_mismatch");
    ensure(entry.original_name === version.file_name && digest(content) === entry.sha256 && entry.sha256 === version.file_hash, "pdf_hash_mismatch");
    entries.set(entry.version_id, entry);
  }
  const omitted = new Set();
  for (const row of manifest.not_included) {
    ensure(object(row) && !omitted.has(row.id) && versions.get(row.id)?.status === "upload_failed" && row.status === "upload_failed", "invalid_omitted_version");
    omitted.add(row.id);
  }
  for (const version of versions.values()) {
    ensure(version.status !== "uploading", "unresolved_upload");
    ensure(version.file_path === `${metadata.project.id}/${version.id}.pdf`, "invalid_source_file_path");
    ensure(version.status === "upload_failed" ? omitted.has(version.id) && !entries.has(version.id) : entries.has(version.id), "incomplete_pdf_manifest");
  }
  ensure(Object.keys(files).length === manifest.files.length + 4, "unmanifested_pdf");
  const documentIds = new Set();
  for (const document of metadata.documents) {
    ensure(object(document) && versions.has(document.version_id) && !documentIds.has(document.version_id), "invalid_document_version");
    documentIds.add(document.version_id);
    ensure(Array.isArray(document.pages) && Array.isArray(document.chapter_ranges), "invalid_document_children");
    const version = versions.get(document.version_id), numbers = new Set(), chapters = new Set();
    if (version.status === "upload_failed")
      ensure(document.pages.length === 0 && document.chapter_ranges.length === 0 && version.file_hash == null && version.extraction_hash == null && version.confirmed_at == null && version.confirmed_by == null, "failed_upload_has_document_state");
    for (const page of document.pages) {
      ensure(object(page) && UUID.test(page.id) && page.version_id === document.version_id, "invalid_page_relation");
      ensure(Number.isInteger(page.pdf_page) && page.pdf_page >= 1 && page.pdf_page <= version.page_count && !numbers.has(page.pdf_page), "invalid_pdf_page");
      numbers.add(page.pdf_page);
      ensure(typeof page.text === "string" && page.text_hash === digest(Buffer.from(page.text)) && page.char_count === [...page.text].length, "page_text_hash_mismatch");
    }
    for (const range of document.chapter_ranges) {
      ensure(object(range) && UUID.test(range.id) && range.version_id === document.version_id && !chapters.has(range.chapter), "invalid_chapter_relation");
      chapters.add(range.chapter);
      ensure(Number.isInteger(range.start_page) && Number.isInteger(range.end_page) && range.start_page >= 1 && range.end_page >= range.start_page && range.end_page <= version.page_count, "invalid_chapter_range");
    }
    if (version.status === "confirmed") {
      ensure(numbers.size === version.page_count && document.chapter_ranges.length > 0 && document.chapter_ranges.every((r) => r.confirmed === true), "incomplete_sealed_version");
      const ranges = [...document.chapter_ranges].sort((a, b) => a.start_page - b.start_page);
      for (let i = 0; i < ranges.length; i++) {
        ensure(i === 0 || ranges[i].start_page > ranges[i - 1].end_page, "overlapping_chapter_ranges");
        ensure(document.pages.some((p) => p.pdf_page >= ranges[i].start_page && p.pdf_page <= ranges[i].end_page && p.text.trim()), "empty_sealed_chapter");
      }
    }
  }
  return { metadata, manifest, files, bytesHash: digest(bytes) };
}

export function planRestore(archive, { existingOwnerUid, existingStudentUid, targetProjectUid } = {}) {
  const m = archive.metadata;
  ensure(AI_TABLES.every((t) => m[t].length === 0) && m.findings.every((f) => !f.run_id && f.source !== "ai" && !f.original_ai) && m.traceability_rows.every((r) => r.source !== "ai_suggestion"), "ai_history_restore_not_supported");
  ensure(m.resources.every((r) => !r.optional_file_path), "resource_attachment_restore_not_supported");
  const versions = [...m.versions].sort((a, b) => a.sequence - b.sequence);
  ensure(versions.every((v) => Number.isSafeInteger(v.sequence) && v.sequence >= 1) && new Set(versions.map((v) => v.sequence)).size === versions.length, "invalid_version_sequence");
  ensure(versions.every((v) => v.sequence <= MAX_VERSION_SEQUENCE), "version_sequence_rehearsal_limit");
  const ids = new Map(), sourceIds = new Set();
  const sourceRows = [m.project, ...TABLES.flatMap((t) => m[t]), ...m.documents.flatMap((d) => [...d.pages, ...d.chapter_ranges])];
  for (const row of sourceRows) {
    ensure(!sourceIds.has(row.id), "duplicate_entity_id");
    sourceIds.add(row.id);
  }
  for (const uid of [m.project.owner_uid, m.project.student_uid, m.project.invitation_id].filter(Boolean)) {
    ensure(UUID.test(uid) && !sourceIds.has(uid), "invalid_identity_reference");
    sourceIds.add(uid);
  }
  const targetIds = new Set();
  if (existingOwnerUid) {
    ensure(UUID.test(existingOwnerUid) && (!sourceIds.has(existingOwnerUid) || existingOwnerUid === m.project.owner_uid), "invalid_existing_owner_mapping");
    ids.set(m.project.owner_uid, existingOwnerUid);
    targetIds.add(existingOwnerUid);
  }
  if (existingStudentUid) {
    ensure(m.project.student_uid && UUID.test(existingStudentUid) && !targetIds.has(existingStudentUid)
      && (!sourceIds.has(existingStudentUid) || existingStudentUid === m.project.student_uid), "invalid_existing_student_mapping");
    ids.set(m.project.student_uid, existingStudentUid);
    targetIds.add(existingStudentUid);
  }
  if (targetProjectUid) {
    ensure(UUID.test(targetProjectUid) && !sourceIds.has(targetProjectUid) && !targetIds.has(targetProjectUid), "invalid_target_project_mapping");
    ids.set(m.project.id, targetProjectUid);
    targetIds.add(targetProjectUid);
  }
  for (const id of sourceIds) {
    if (ids.has(id)) continue;
    let replacement;
    do { replacement = randomUUID(); } while (sourceIds.has(replacement) || targetIds.has(replacement));
    ids.set(id, replacement);
    targetIds.add(replacement);
  }
  const userIds = new Set([m.project.owner_uid, m.project.student_uid].filter(Boolean));
  const typedRefs = new Map([
    ...["owner_uid", "student_uid", "created_by", "author_uid", "submitted_by", "confirmed_by"].map((k) => [k, userIds]),
    ...["approved_by", "closed_by"].map((k) => [k, new Set([m.project.owner_uid])]),
    ["project_id", new Set([m.project.id])], ["invitation_id", new Set([m.project.invitation_id].filter(Boolean))],
    ...["version_id", "source_version_id"].map((k) => [k, new Set(versions.map((r) => r.id))]),
    ["page_id", new Set(m.documents.flatMap((d) => d.pages.map((p) => p.id)))],
    ["finding_id", new Set(m.findings.map((r) => r.id))], ["parent_id", new Set(m.comments.map((r) => r.id))],
  ]);
  const remap = (v, depth = 0) => {
    ensure(depth <= 32, "nested_metadata_depth_limit");
    if (Array.isArray(v)) return v.map((item) => remap(item, depth + 1));
    if (!object(v)) return v;
    return Object.fromEntries(Object.entries(v).map(([key, value]) => {
      if (REF_KEYS.has(key) && value != null) {
        ensure(typeof value === "string" && ids.has(value) && (!typedRefs.has(key) || typedRefs.get(key).has(value)), "unmapped_identity_or_entity");
        return [key, ids.get(value)];
      }
      return [key, remap(value, depth + 1)];
    }));
  };
  const versionMap = new Map(versions.map((v) => [v.id, v]));
  const pageMap = new Map(m.documents.flatMap((d) => d.pages.map((p) => [p.id, p])));
  const checkLocator = (value, inherited = null, depth = 0) => {
    ensure(depth <= 32, "nested_metadata_depth_limit");
    if (Array.isArray(value)) { value.forEach((v) => checkLocator(v, inherited, depth + 1)); return; }
    if (!object(value)) return;
    let versionId = value.version_id ?? value.source_version_id ?? inherited;
    if (value.version_id != null) ensure(versionMap.has(value.version_id), "locator_version_missing");
    if (value.source_version_id != null) ensure(versionMap.has(value.source_version_id), "locator_version_missing");
    if (value.project_id != null) ensure(value.project_id === m.project.id, "locator_project_mismatch");
    if (value.page_id != null) {
      const page = pageMap.get(value.page_id);
      ensure(page, "locator_page_missing");
      ensure(versionId == null || page.version_id === versionId, "locator_page_version_mismatch");
      ensure(value.pdf_page == null || value.pdf_page === page.pdf_page, "locator_page_index_mismatch");
      versionId ??= page.version_id;
    }
    const version = versionMap.get(versionId);
    if (value.pdf_page != null)
      ensure(version && Number.isInteger(value.pdf_page) && value.pdf_page >= 1 && value.pdf_page <= version.page_count, "locator_page_outside_version");
    if (value.start_page != null || value.end_page != null)
      ensure(version && Number.isInteger(value.start_page) && Number.isInteger(value.end_page) && value.start_page >= 1 && value.end_page >= value.start_page && value.end_page <= version.page_count, "locator_range_outside_version");
    if (value.pdf_pages != null)
      ensure(version && Array.isArray(value.pdf_pages) && value.pdf_pages.every((p) => Number.isInteger(p) && p >= 1 && p <= version.page_count), "locator_page_outside_version");
    Object.values(value).forEach((v) => checkLocator(v, versionId, depth + 1));
  };
  for (const row of m.traceability_rows)
    for (const key of ["theory_locator", "method_locator", "result_locator", "conclusion_locator"]) checkLocator(row[key]);
  for (const finding of m.findings) {
    if (finding.version_id) ensure(versionMap.has(finding.version_id), "finding_version_missing");
    for (const key of ["version_id", "source_version_id"])
      if (finding.locator?.[key] != null)
        ensure(finding.locator[key] === finding.version_id, "finding_locator_version_mismatch");
    checkLocator(finding.locator, finding.version_id);
    if (finding.revision_proof) {
      const proof = finding.revision_proof, v = versionMap.get(proof.version_id), base = versionMap.get(finding.version_id);
      ensure(v?.status === "confirmed" && (base ? v.sequence > base.sequence : Date.parse(v.confirmed_at) > Date.parse(finding.created_at)), "invalid_revision_proof_version");
      ensure(Number.isInteger(proof.start_page) && Number.isInteger(proof.end_page) && proof.start_page >= 1 && proof.end_page >= proof.start_page && proof.end_page <= v.page_count, "invalid_revision_proof_pages");
      ensure(proof.file_hash === v.file_hash && proof.extraction_hash === v.extraction_hash, "revision_proof_hash_mismatch");
    }
  }
  const rows = Object.fromEntries(TABLES.map((t) => [t, m[t].map((row) => remap(row))]));
  rows.versions.sort((a, b) => a.sequence - b.sequence);
  const project = remap(m.project);
  if (project.student_uid && !project.invitation_id) project.invitation_id = randomUUID();
  rows.versions.forEach((v) => { v.file_path = `${project.id}/${v.id}.pdf`; });
  // Parents must precede replies; a cycle is refused, never repaired silently.
  const remaining = new Map(rows.comments.map((r) => [r.id, r])), comments = [], done = new Set();
  while (remaining.size) {
    const ready = [...remaining.values()].filter((r) => !r.parent_id || done.has(r.parent_id));
    ensure(ready.length > 0, "comment_parent_cycle_or_missing");
    for (const row of ready) { comments.push(row); done.add(row.id); remaining.delete(row.id); }
  }
  rows.comments = comments;
  return { project, rows, documents: m.documents.map((d) => remap(d)), ids };
}

export async function createRehearsalDb({ throughVersion = '99999999999999' } = {}) {
  const db = await PGlite.create();
  try {
    await db.exec(await readFile(join(ROOT, "supabase/tests/local/00_supabase_shim.sql"), "utf8"));
    for (const name of (await readdir(join(ROOT, "supabase/migrations"))).filter((n) => /^\d{14}_.+\.sql$/.test(n) && n.slice(0, 14) <= throughVersion).sort())
      await db.exec(`begin;${await readFile(join(ROOT, "supabase/migrations", name), "utf8")};commit;`);
    await db.exec(execFileSync(process.execPath, [join(ROOT, "scripts/seed-rubric.mjs")], { encoding: "utf8" }));
    return db;
  } catch (e) { await db.close(); throw e; }
}

export async function extractionDigest(db, versionId) {
  return (await db.query(`select encode(sha256(convert_to(jsonb_build_object(
    'pages',(select jsonb_agg(jsonb_build_array(pdf_page,printed_label,text_hash,source) order by pdf_page) from public.pages where version_id=$1),
    'ranges',(select jsonb_agg(jsonb_build_array(chapter,start_page,end_page) order by chapter) from public.chapter_ranges where version_id=$1)
  )::text,'UTF8')),'hex') as hash`, [versionId])).rows[0].hash;
}

async function importPlan(db, archive, plan, { existingOwnerUid } = {}) {
  const columns = new Map();
  for (const table of ["projects", ...TABLES, "pages", "chapter_ranges"]) {
    const result = await db.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1", [table]);
    columns.set(table, new Set(result.rows.map((r) => r.column_name)));
  }
  const insert = async (table, row) => {
    ensure(Object.keys(row).every((k) => columns.get(table).has(k)), "unsupported_row_field");
    const values = { ...row, row_version: 1 };
    const names = Object.keys(values);
    return (await db.query(`insert into public.${table} (${names.map((n) => `"${n}"`).join(",")}) values (${names.map((_, i) => `$${i + 1}`).join(",")}) returning *`, Object.values(values))).rows[0];
  };
  for (const [uid, role] of [[plan.project.owner_uid, "owner"], [plan.project.student_uid, "student"]]) {
    if (!uid) continue;
    if (role === "owner" && existingOwnerUid) {
      ensure(uid === existingOwnerUid, "restored_owner_binding_mismatch");
      const existing = (await db.query(`select count(*)::int n from public.memberships m join auth.users u on u.id=m.auth_user_id
        where m.auth_user_id=$1 and m.role='owner' and m.active and u.email_confirmed_at is not null
        and (u.raw_app_meta_data->>'provider'='google' or u.raw_app_meta_data->'providers' ? 'google')`, [uid])).rows[0];
      ensure(existing.n === 1, "existing_verified_google_owner_required");
      continue;
    }
    const email = `restore-${role}-${uid}@example.test`;
    await db.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),$3)", [uid, email, { provider: "google", providers: ["google"] }]);
    await db.query("insert into public.memberships(auth_user_id,verified_email,role) values($1,$2,$3)", [uid, email, role]);
  }
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: plan.project.owner_uid, role: "authenticated" })]);
  if (plan.project.invitation_id)
    await db.query("insert into public.invitations(id,normalized_email,claimed_uid,created_by) values($1,$2,$3,$4)", [plan.project.invitation_id, `restore-student-${plan.project.invitation_id}@example.test`, plan.project.student_uid, plan.project.owner_uid]);
  const project = await insert("projects", plan.project);
  ensure(project.student_uid === plan.project.student_uid, "restored_student_binding_mismatch");
  const documents = new Map(plan.documents.map((d) => [d.version_id, d]));
  const sourceIdsByTarget = new Map([...plan.ids].map(([source, target]) => [target, source]));
  const bytesByPath = new Map();
  const sequenceMarkers = new Set();
  let nextSequence = 1;
  for (const version of plan.rows.versions) {
    // Exercise the original max(sequence)+1 guard without changing its definition.
    // Markers exist only in this private transaction, have no PDF, and are removed
    // before dependent records, verification or the caller's inspection.
    while (nextSequence < version.sequence) {
      let id;
      do { id = randomUUID(); } while (plan.ids.has(id) || sourceIdsByTarget.has(id) || sequenceMarkers.has(id));
      const marker = await insert("versions", {
        id, project_id: project.id, file_name: "restore-sequence-marker.pdf",
        file_size: 1, status: "upload_failed", error_message: "Local rehearsal sequence marker",
      });
      ensure(marker.sequence === nextSequence, "restored_version_binding_mismatch");
      sequenceMarkers.add(id);
      nextSequence++;
    }
    const failed = version.status === "upload_failed";
    const created = await insert("versions", { ...version, status: failed ? "upload_failed" : "uploading", file_hash: null, extraction_hash: null, confirmed_at: null, confirmed_by: null });
    ensure(created.sequence === version.sequence && created.file_path === version.file_path, "restored_version_binding_mismatch");
    nextSequence++;
    if (!failed) {
      const oldId = sourceIdsByTarget.get(version.id);
      const bytes = archive.files[`files/${oldId}.pdf`];
      bytesByPath.set(version.file_path, bytes);
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('thesis-files',$1,$2)", [version.file_path, { size: bytes.length, mimetype: "application/pdf" }]);
      await db.query("update public.versions set status='extracted',file_hash=$2 where id=$1", [version.id, version.file_hash]);
    }
    const document = documents.get(version.id);
    for (const page of document.pages) await insert("pages", page);
    for (const range of document.chapter_ranges) await insert("chapter_ranges", range);
    if (version.status === "confirmed")
      ensure(await extractionDigest(db, version.id) === version.extraction_hash, "sealed_snapshot_hash_mismatch");
    if (!failed)
      await db.query("update public.versions set status=$2,extraction_hash=$3,confirmed_at=$4,confirmed_by=$5 where id=$1", [version.id, version.status, version.extraction_hash, version.confirmed_at, version.confirmed_by]);
  }
  if (sequenceMarkers.size) {
    const removed = await db.query("delete from public.versions where id=any($1::uuid[]) and project_id=$2 and status='upload_failed' returning id", [[...sequenceMarkers], project.id]);
    ensure(removed.rows.length === sequenceMarkers.size, "sequence_marker_cleanup_failed");
  }
  for (const table of ["findings", "comments", "meetings", "resources", "milestones", "traceability_rows"])
    for (const row of plan.rows[table]) await insert(table, row);
  for (const [path, bytes] of bytesByPath) {
    const row = (await db.query("select file_hash,file_size from public.versions where file_path=$1", [path])).rows[0];
    ensure(row.file_hash === digest(bytes) && Number(row.file_size) === bytes.length, "restored_pdf_hash_mismatch");
  }
  await db.query("select app.audit($1,'restore_rehearsal','projects',$1,1,$2)", [plan.project.id, { source_backup_sha256: archive.bytesHash, mode: existingOwnerUid ? "native_sql_rollback" : "local_disposable" }]);
  const counts = {};
  for (const table of TABLES) {
    counts[table] = Number((await db.query(`select count(*) as count from public.${table} where project_id=$1`, [plan.project.id])).rows[0].count);
    ensure(counts[table] === plan.rows[table].length, "restored_row_count_mismatch");
  }
  for (const table of ["private_notes", "workspace_drafts", "ai_runs"])
    ensure(Number((await db.query(`select count(*) as count from public.${table} where project_id=$1`, [plan.project.id])).rows[0].count) === 0, "unexpected_private_or_ai_state");
  if (!existingOwnerUid)
    for (const table of ["budget_settings", "model_settings"])
      ensure(Number((await db.query(`select count(*) as count from public.${table}`)).rows[0].count) === 0, "unexpected_private_or_ai_state");
  return { counts, pdf_files: bytesByPath.size, version_sequence_gaps_preserved: sequenceMarkers.size, temporary_sequence_markers_removed: sequenceMarkers.size };
}

// The caller owns the connection; this helper has no COMMIT or service API path.
// Hashes are computed in SQL: original rows (including Auth) never leave the database.
export async function captureRehearsalState(db) {
  const tables = (await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map((r) => r.tablename);
  ensure(tables.length > 0 && tables.every((t) => /^[a-z_][a-z_0-9]*$/.test(t)), "unsupported_rehearsal_table_set");
  const names = [...tables.map((t) => `public.${t}`), "auth.users", "storage.objects", "storage.buckets"];
  const result = await db.query(names.map((name) => `select '${name}' as table_name,count(*)::int rows,
    encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]'),'UTF8')),'hex') as content_hash
    from ${name} t`).join(" union all ") + " order by table_name");
  return result.rows;
}

// Native SET LOCAL ROLE/JWT claims check only; this does not obtain an Auth token.
export async function verifyRestoredSqlAccess(db, plan) {
  const actor = async (uid) => db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
  await db.query("set local role authenticated");
  try {
    await actor(plan.project.owner_uid);
    ensure((await db.query("select count(*)::int n from projects where id=$1", [plan.project.id])).rows[0].n === 1, "restored_owner_sql_access_denied");
    if (plan.project.student_uid) {
      await actor(plan.project.student_uid);
      const projects = (await db.query("select id from projects order by id")).rows;
      ensure(projects.length === 1 && projects[0].id === plan.project.id, "restored_student_project_isolation_failed");
      ensure((await db.query("select count(*)::int n from private_notes")).rows[0].n === 0, "restored_student_private_note_isolation_failed");
      for (const table of ["versions", "findings", "comments"])
        ensure((await db.query(`select count(*)::int n from public.${table} where project_id=$1`, [plan.project.id])).rows[0].n === plan.rows[table].length, "restored_student_sql_access_denied");
      const files = (await db.query("select count(*)::int n from storage.objects where bucket_id='thesis-files' and name like $1", [`${plan.project.id}/%`])).rows[0].n;
      ensure(files === plan.rows.versions.filter((v) => v.status !== "upload_failed").length, "restored_student_storage_rls_denied");
    }
  } finally { await db.query("reset role"); }
  return { sql_role_access_checked: true, api_auth_tested: false, api_storage_tested: false };
}

export async function rehearseBackupInTransaction(db, bytes, { existingOwnerUid, inspectRestored } = {}) {
  const archive = inspectBackup(bytes), plan = planRestore(archive, { existingOwnerUid });
  let before, result;
  await db.query("begin isolation level repeatable read");
  try {
    await db.query("set local statement_timeout='20s'");
    await db.query("set local lock_timeout='5s'");
    before = await captureRehearsalState(db);
    result = await importPlan(db, archive, plan, { existingOwnerUid });
    await verifyRestoredSqlAccess(db, plan);
    if (inspectRestored) await inspectRestored(db, plan);
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError("transactional_sql_restore_validation_failed");
  } finally { await db.query("rollback"); }
  await db.query("begin read only");
  try {
    const after = await captureRehearsalState(db);
    ensure(JSON.stringify(after) === JSON.stringify(before), "rehearsal_original_data_changed");
  } finally { await db.query("rollback"); }
  return { ...result, backup_sha256: archive.bytesHash, rollback_verified: true,
    original_tables_verified: before.length, original_data_unchanged: true,
    sql_role_access_checked: true, api_auth_tested: false, api_storage_tested: false, provider_called: false };
}

export async function rehearseBackup(bytes, { inspectRestored } = {}) {
  const archive = inspectBackup(bytes), plan = planRestore(archive);
  const db = await createRehearsalDb();
  try {
    await db.exec("begin");
    const result = await importPlan(db, archive, plan);
    if (inspectRestored) await inspectRestored(db, plan);
    await db.exec("rollback");
    for (const table of ["public.projects", "auth.users", "storage.objects", "public.audit_events"])
      ensure(Number((await db.query(`select count(*) as count from ${table}`)).rows[0].count) === 0, "rehearsal_rollback_failed");
    return {
      mode: "local_disposable_sql_rehearsal", passed: true,
      backup_sha256: archive.bytesHash, ...result, rollback_verified: true,
      hosted_tested: false, ai_enabled: false,
      excluded: EXCLUDED,
      limits: ["Manual project ZIP only; AI history and legacy attachments are refused. Original version sequence numbers are preserved up to 2048.", "Auth/Storage are synthetic. PDFs are verified as bytes in memory, not uploaded to Supabase.", "No original audit history, private notes, drafts, memberships, consent, budgets or model configuration are restored.", "Updated timestamps and optimistic lock counters follow the target SQL triggers."],
    };
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    if (e instanceof BackupError) throw e;
    // Never echo SQL errors with a failing row's thesis text or identity data.
    throw new BackupError("local_sql_restore_validation_failed");
  } finally { await db.close(); }
}
