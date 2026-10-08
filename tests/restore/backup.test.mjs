import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { inspectBackup, planRestore, rehearseBackup, digest } from "../../scripts/lib/backup-restore.mjs";
import { makeBackupFixture, packBackup } from "./fixtures.mjs";
let fixture;
before(async () => { fixture = await makeBackupFixture(); });
const metadata = () => structuredClone(fixture.metadata);
const changeZip = (fn) => { const files = unzipSync(fixture.zip); fn(files); return zipSync(files, { level: 0 }); };

test("B02 local SQL: restore regenerates IDs, preserves sealed snapshots, proof, reply scope and manual records; rollback verified", async () => {
  const report = await rehearseBackup(fixture.zip, { inspectRestored: async (db, plan) => {
    const q = (s, p) => db.query(s, p);
    assert.notEqual(plan.project.id, fixture.metadata.project.id);
    assert.notEqual(plan.project.owner_uid, fixture.metadata.project.owner_uid);
    assert.notEqual(plan.project.student_uid, fixture.metadata.project.student_uid);
    const versions = (await q("select * from versions order by sequence")).rows;
    assert.deepEqual(versions.map((v) => v.sequence), [1, 2]);
    for (const row of fixture.metadata.versions) {
      const restored = versions.find((v) => v.id === plan.ids.get(row.id));
      assert.equal(restored.file_hash, row.file_hash);
      assert.equal(restored.extraction_hash, row.extraction_hash);
      assert.equal(restored.status, "confirmed");
      assert.equal(restored.file_path, `${plan.project.id}/${restored.id}.pdf`);
    }
    const finding = (await q("select * from findings")).rows[0];
    assert.equal(finding.version_id, plan.ids.get(fixture.metadata.findings[0].version_id));
    assert.equal(finding.revision_proof.version_id, versions[1].id);
    assert.equal(finding.revision_proof.submitted_by, plan.project.student_uid);
    assert.equal(finding.closed_by, plan.project.owner_uid);
    const comments = (await q("select * from comments")).rows;
    assert.equal(comments.find((c) => c.parent_id).parent_id, comments.find((c) => !c.parent_id).id);
    assert.equal(comments.find((c) => !c.parent_id).body, fixture.metadata.comments.find((c) => !c.parent_id).body);
    const trace = (await q("select * from traceability_rows")).rows[0];
    assert.equal(trace.result_locator.version_id, versions[1].id);
    assert.equal(trace.owner_note, "Catatan pembimbing untuk restore");
    assert.equal(trace.status, "verified");
    assert.equal(Number((await q("select count(*) n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity")).rows[0].n), 0);
    assert.equal(Number((await q("select count(*) n from private_notes")).rows[0].n), 0);
    // Sealed-version guards remain active in the target, not disabled for restore.
    await q("savepoint guard_check");
    await assert.rejects(q("update pages set text='overwrite'"), /version_sealed/);
    await q("rollback to guard_check");
  } });
  assert.equal(report.passed, true);
  assert.equal(report.rollback_verified, true);
  assert.equal(report.hosted_tested, false);
  assert.equal(report.ai_enabled, false);
  assert.equal(report.pdf_files, 2);
  assert.equal(report.counts.comments, 2);
});

test("B01 integrity: altered PDF and metadata bytes are rejected", () => {
  assert.throws(() => inspectBackup(changeZip((files) => { files[Object.keys(files).find((p) => p.endsWith(".pdf"))][0] ^= 1; })), /pdf_hash_mismatch/);
  assert.throws(() => inspectBackup(changeZip((files) => { files["metadata.json"] = strToU8("{}"); })), /unsupported_metadata_schema|metadata_hash_mismatch/);
});

test("B01 completeness: missing and unmanifested PDFs are rejected", () => {
  assert.throws(() => inspectBackup(changeZip((files) => { delete files[Object.keys(files).find((p) => p.endsWith(".pdf"))]; })), /missing_or_unexpected_pdf/);
  assert.throws(() => inspectBackup(changeZip((files) => { files[`files/${randomUUID()}.pdf`] = strToU8("extra"); })), /unmanifested_pdf/);
});

test("Archive paths and expansion limits are checked before extraction", () => {
  assert.throws(() => inspectBackup(packBackup(metadata(), fixture.pdfs, { "../outside.txt": strToU8("bad") })), /unexpected_archive_path/);
  const zip = Buffer.from(zipSync({ "metadata.json": strToU8("x") }, { level: 0 }));
  const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  zip.writeUInt32LE(80 * 1024 * 1024, central + 24);
  assert.throws(() => inspectBackup(zip), /archive_entry_size_limit/);
});

test("Duplicate ZIP names cannot shadow a checked entry", () => {
  const zip = Buffer.from(packBackup(metadata(), fixture.pdfs, { "metadatx.json": strToU8("{}") }));
  const source = Buffer.from("metadatx.json"), replacement = Buffer.from("metadata.json");
  let at = zip.indexOf(source);
  while (at !== -1) { replacement.copy(zip, at); at = zip.indexOf(source, at + source.length); }
  assert.throws(() => inspectBackup(zip), /duplicate_archive_path/);
});

test("Cross-project rows, broken source paths and tampered page hashes are refused", () => {
  const cross = metadata(); cross.findings[0].project_id = randomUUID();
  assert.throws(() => inspectBackup(packBackup(cross, fixture.pdfs)), /row_project_mismatch/);
  const path = metadata(); path.versions[0].file_path = "outside/file.pdf";
  assert.throws(() => inspectBackup(packBackup(path, fixture.pdfs)), /invalid_source_file_path/);
  const text = metadata(); text.documents[0].pages[0].text = "altered";
  assert.throws(() => inspectBackup(packBackup(text, fixture.pdfs)), /page_text_hash_mismatch/);
});

test("Incorrect proof hashes, unexported identity and cyclic replies are refused", () => {
  const proof = metadata(); proof.findings[0].revision_proof.file_hash = "a".repeat(64);
  assert.throws(() => planRestore(inspectBackup(packBackup(proof, fixture.pdfs))), /revision_proof_hash_mismatch/);
  const author = metadata(); author.comments[0].author_uid = randomUUID();
  assert.throws(() => planRestore(inspectBackup(packBackup(author, fixture.pdfs))), /unmapped_identity_or_entity/);
  const cycle = metadata(); cycle.comments[0].parent_id = cycle.comments[1].id; cycle.comments[1].parent_id = cycle.comments[0].id;
  assert.throws(() => planRestore(inspectBackup(packBackup(cycle, fixture.pdfs))), /comment_parent_cycle_or_missing/);
});

test("Private/global sections and unsupported AI history are never silently dropped", () => {
  const privateData = metadata(); privateData.private_notes = [{ body: "private" }];
  assert.throws(() => inspectBackup(packBackup(privateData, fixture.pdfs)), /unexpected_metadata_section/);
  const ai = metadata(); ai.ai_runs.push({ id: randomUUID(), project_id: ai.project.id });
  assert.throws(() => planRestore(inspectBackup(packBackup(ai, fixture.pdfs))), /ai_history_restore_not_supported/);
});

test("Nested locators must reference an exported version and an actual page", () => {
  const missing = metadata(); missing.traceability_rows[0].result_locator.version_id = missing.project.owner_uid;
  assert.throws(() => planRestore(inspectBackup(packBackup(missing, fixture.pdfs))), /locator_version_missing/);
  const page = metadata(); page.traceability_rows[0].result_locator.pdf_page = 99;
  assert.throws(() => planRestore(inspectBackup(packBackup(page, fixture.pdfs))), /locator_page_outside_version/);
});

test("Actor references cannot bind to a version UUID or give a student owner approval", () => {
  const actor = metadata(); actor.comments[0].author_uid = actor.versions[0].id;
  assert.throws(() => planRestore(inspectBackup(packBackup(actor, fixture.pdfs))), /unmapped_identity_or_entity/);
  const approval = metadata(); approval.findings[0].approved_by = approval.project.student_uid;
  assert.throws(() => planRestore(inspectBackup(packBackup(approval, fixture.pdfs))), /unmapped_identity_or_entity/);
});

test("Sequence gaps and incomplete uploads require explicit follow-up instead of renumbering", () => {
  const gaps = metadata(); gaps.versions.find((v) => v.sequence === 2).sequence = 4;
  assert.throws(() => planRestore(inspectBackup(packBackup(gaps, fixture.pdfs))), /version_sequence_gaps_not_supported/);
  const pending = metadata(); pending.versions[0].status = "uploading";
  assert.throws(() => inspectBackup(packBackup(pending, fixture.pdfs)), /unresolved_upload/);
});

test("A recomputed archive hash cannot hide a changed sealed extraction snapshot", async () => {
  const changed = metadata(); changed.versions[0].extraction_hash = digest("false snapshot");
  await assert.rejects(rehearseBackup(packBackup(changed, fixture.pdfs)), /sealed_snapshot_hash_mismatch/);
});

test("Failed upload entries remain failed and do not invent or restore a PDF", async () => {
  const m = metadata(), id = randomUUID();
  m.versions.push({ ...m.versions[0], id, sequence: 3, file_path: `${m.project.id}/${id}.pdf`,
    status: "upload_failed", file_hash: null, extraction_hash: null, page_count: null,
    confirmed_at: null, confirmed_by: null, extraction_method: null, error_message: "Synthetic failed upload" });
  m.documents.push({ version_id: id, pages: [], chapter_ranges: [] });
  const result = await rehearseBackup(packBackup(m, fixture.pdfs), { inspectRestored: async (db, plan) => {
    const row = (await db.query("select * from versions where id=$1", [plan.ids.get(id)])).rows[0];
    assert.equal(row.status, "upload_failed");
    assert.equal(row.file_hash, null);
    assert.equal(Number((await db.query("select count(*) n from storage.objects where name=$1", [row.file_path])).rows[0].n), 0);
  } });
  assert.equal(result.counts.versions, 3);
  assert.equal(result.pdf_files, 2);
});

test("A pending-student project without PDFs restores manual records without claiming a student identity", async () => {
  const m = metadata();
  m.project.student_uid = null;
  m.versions = []; m.documents = []; m.findings = []; m.comments = []; m.resources = [];
  for (const row of m.traceability_rows)
    for (const key of ["theory_locator", "method_locator", "result_locator", "conclusion_locator"]) row[key] = { note: "Catatan manual tanpa PDF" };
  const result = await rehearseBackup(packBackup(m, {}), { inspectRestored: async (db) => {
    assert.equal((await db.query("select student_uid from projects")).rows[0].student_uid, null);
    assert.equal(Number((await db.query("select count(*) n from auth.users")).rows[0].n), 1);
  } });
  assert.equal(result.pdf_files, 0);
  assert.equal(result.counts.traceability_rows, 1);
});

test("Checkpoint C ZIPs without optional traceability or AI arrays remain readable", () => {
  const m = metadata();
  for (const key of ["traceability_rows", "ai_runs", "ai_messages", "ai_rating_reviews"]) delete m[key];
  const plan = planRestore(inspectBackup(packBackup(m, fixture.pdfs)));
  assert.equal(plan.rows.versions.length, 2);
  assert.equal(plan.rows.traceability_rows.length, 0);
});

test("SQL constraints still reject invalid source values without leaking the failed row", async () => {
  const changed = metadata(); changed.resources[0].https_url = "javascript:private-content";
  await assert.rejects(rehearseBackup(packBackup(changed, fixture.pdfs)), (e) => {
    assert.equal(e.message, "local_sql_restore_validation_failed");
    assert.ok(!e.message.includes("private-content"));
    return true;
  });
});

test("CLI accepts a local ZIP, emits a safe report, refuses hosted/apply flags and never overwrites a report", async () => {
  const cli = fileURLToPath(new URL("../../scripts/restore-backup.mjs", import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), "bimbingta-restore-"));
  const zip = join(dir, "backup.zip"), report = join(dir, "report.json");
  try {
    await writeFile(zip, fixture.zip);
    const env = { ...process.env, SUPABASE_DB_URL: "postgres://unused:unused@example.invalid/unused", OPENAI_API_KEY: "unused-test-key" };
    const good = spawnSync(process.execPath, [cli, zip, `--report=${report}`], { encoding: "utf8", env });
    assert.equal(good.status, 0, good.stderr);
    const summary = JSON.parse(good.stdout);
    assert.equal(summary.rollback_verified, true);
    assert.equal(summary.hosted_tested, false);
    assert.ok(!good.stdout.includes("Catatan pembimbing"));
    assert.ok(!good.stdout.includes(fixture.metadata.project.owner_uid));
    assert.deepEqual(JSON.parse(await readFile(report, "utf8")), summary);
    const saved = await readFile(report);
    const repeat = spawnSync(process.execPath, [cli, zip, `--report=${report}`], { encoding: "utf8", env });
    assert.equal(repeat.status, 1);
    assert.deepEqual(await readFile(report), saved);
    const apply = spawnSync(process.execPath, [cli, zip, "--apply"], { encoding: "utf8", env });
    assert.equal(apply.status, 1);
    assert.match(apply.stderr, /usage_requires_zip_and_optional_report_only/);
    assert.deepEqual(await readFile(zip), Buffer.from(fixture.zip));
  } finally {
    await unlink(zip).catch(() => {});
    await unlink(report).catch(() => {});
    await rmdir(dir);
  }
});
