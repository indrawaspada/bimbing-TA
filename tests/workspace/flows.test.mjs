import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rest, sql, asUser, pool, signJwt } from "../security/harness.mjs";
if (process.env.TEST_SQL_WASM === "1") await import("../security/rls.test.mjs");
const ctx = {};
let owner, A, B, v, f;
const ok = (r) => {
  assert.ok([200, 201, 204].includes(r.status), JSON.stringify(r));
  return Array.isArray(r.json) ? r.json[0] : r.json;
};
const denied = (r, code) => {
  assert.ok(r.status >= 400, JSON.stringify(r));
  if (code) assert.match(r.json.message, new RegExp(code));
};
const rpc = (who, name, args) => rest(who.token, "POST", `/rpc/${name}`, args);
async function version(
  who,
  project,
  name = "chapter.pdf",
  content = "Teks bab pertama",
  range = true,
) {
  let row = ok(
    await rest(who.token, "POST", "/versions", {
      project_id: project,
      file_name: name,
      file_size: 1000,
    }),
  );
  assert.equal(
    (
      await asUser(who, (c) =>
        c.query(
          "insert into storage.objects(bucket_id,name,metadata) values('thesis-files',$1,$2)",
          [row.file_path, { size: 1000, mimetype: "application/pdf" }],
        ),
      )
    ).ok,
    true,
  );
  row = ok(
    await rpc(who, "version_upload_result", {
      p_version: row.id,
      p_expected: row.row_version,
      p_hash: "a".repeat(64),
    }),
  );
  row = ok(
    await rpc(who, "version_save_pages", {
      p_version: row.id,
      p_expected: row.row_version,
      p_page_count: 2,
      p_pages: [
        { pdf_page: 1, text: content, source: "pdfjs", printed_label: "iv" },
        { pdf_page: 2, text: "Metode", source: "pdfjs", printed_label: "1" },
      ],
    }),
  );
  if (range)
    row = ok(
      await rpc(who, "version_save_ranges", {
        p_version: row.id,
        p_expected: row.row_version,
        p_ranges: [
          { chapter: "B1", start_page: 1, end_page: 1 },
          { chapter: "B3", start_page: 2, end_page: 2 },
        ],
      }),
    );
  return row;
}
after(() => pool.end());
test("C setup uses verified personas from B regression; create source PDF and seal", async () => {
  const m = (await sql("select * from memberships order by role")).rows;
  const who = (email) => {
    const row = m.find((r) => r.verified_email === email);
    return {
      id: row.auth_user_id,
      token: signJwt({ sub: row.auth_user_id, email }),
    };
  };
  owner = who("dosen.uji@example.test");
  A = who("mhs.a@example.test");
  B = who("mhs.b@example.test");
  ctx.project = (
    await sql("select * from projects where student_uid=$1", [A.id])
  ).rows[0];
  // Old B test reservations count toward the same quota; discard only its synthetic fixture
  // after those assertions finished (no production code ever performs this cleanup).
  await sql("delete from storage.objects");
  await sql("delete from versions");
  v = await version(A, ctx.project.id);
  v = ok(
    await rpc(A, "version_confirm", {
      p_version: v.id,
      p_expected: v.row_version,
    }),
  );
  assert.equal(v.status, "confirmed");
  assert.match(v.extraction_hash, /^[a-f0-9]{64}$/);
  const pages = ok(
    await rest(A.token, "GET", `/pages?version_id=eq.${v.id}&pdf_page=eq.1`),
  );
  assert.equal(pages.printed_label, "iv");
  assert.equal(pages.pdf_page, 1);
  assert.equal(pages.char_count, 16);
});
test("C immutable pages/ranges and cross-project RPC isolation, anonymous denied", async () => {
  denied(
    await rpc(A, "version_save_pages", {
      p_version: v.id,
      p_expected: v.row_version,
      p_page_count: 2,
      p_pages: [{ pdf_page: 1, text: "tampered" }],
    }),
    "version_sealed",
  );
  denied(
    await rpc(B, "version_confirm", {
      p_version: v.id,
      p_expected: v.row_version,
    }),
    "not_found",
  );
  denied(
    await rpc({ token: null }, "version_confirm", {
      p_version: v.id,
      p_expected: v.row_version,
    }),
  );
  assert.deepEqual(
    (await rest(B.token, "GET", `/pages?version_id=eq.${v.id}`)).json,
    [],
  );
  assert.equal(
    (
      await asUser(B, (c) =>
        c.query("select * from storage.objects where name=$1", [v.file_path]),
      )
    ).out.rowCount,
    0,
  );
});
test("C scan fallback, empty chapter rejection, overlap and optimistic conflict", async () => {
  let scan = await version(A, ctx.project.id, "scan.pdf", "", false);
  denied(
    await rpc(A, "version_save_ranges", {
      p_version: scan.id,
      p_expected: scan.row_version,
      p_ranges: [
        { chapter: "B1", start_page: 1, end_page: 2 },
        { chapter: "B2", start_page: 2, end_page: 2 },
      ],
    }),
    "chapter_ranges_overlap",
  );
  scan = ok(
    await rpc(A, "version_save_ranges", {
      p_version: scan.id,
      p_expected: scan.row_version,
      p_ranges: [{ chapter: "B1", start_page: 1, end_page: 1 }],
    }),
  );
  denied(
    await rpc(A, "version_confirm", {
      p_version: scan.id,
      p_expected: scan.row_version,
    }),
    "text_confirmation_required",
  );
  const previous = scan.row_version;
  scan = ok(
    await rpc(A, "version_save_pages", {
      p_version: scan.id,
      p_expected: previous,
      p_page_count: 2,
      p_pages: [{ pdf_page: 1, text: "Teks manual", source: "pasted" }],
    }),
  );
  assert.equal(scan.extraction_method, "mixed");
  denied(
    await rpc(A, "version_save_pages", {
      p_version: scan.id,
      p_expected: previous,
      p_page_count: 2,
      p_pages: [{ pdf_page: 1, text: "stale" }],
    }),
    "edit_conflict",
  );
  scan = ok(
    await rpc(A, "version_confirm", {
      p_version: scan.id,
      p_expected: scan.row_version,
    }),
  );
  ctx.scan = scan;
});
test("C quota allocation does not expire; actual uploaded size cannot exceed reservation", async () => {
  let row = ok(
    await rest(A.token, "POST", "/versions", {
      project_id: ctx.project.id,
      file_name: "failed.pdf",
      file_size: 1000,
    }),
  );
  let result = await asUser(A, (c) =>
    c.query(
      "insert into storage.objects(bucket_id,name,metadata) values('thesis-files',$1,$2)",
      [row.file_path, { size: 2000 }],
    ),
  );
  assert.equal(result.ok, false);
  assert.match(
    result.error.message,
    /uploaded_size_mismatch|row-level security/,
  );
  // Storage's preflight metadata differs from the finalized metadata, as in Supabase's source.
  result = await asUser(A, async (c) => {
    await c.query("savepoint preflight");
    await c.query(
      "insert into storage.objects(bucket_id,name,metadata) values('thesis-files',$1,$2)",
      [row.file_path, { contentLength: 1000, mimetype: "application/pdf" }],
    );
    await c.query("rollback to preflight");
  });
  assert.equal(result.ok, true);
  row = ok(
    await rpc(A, "version_upload_result", {
      p_version: row.id,
      p_expected: row.row_version,
      p_error: "Network failure",
    }),
  );
  assert.equal(row.status, "upload_failed");
  row = ok(
    await rpc(A, "version_retry_upload", {
      p_version: row.id,
      p_expected: row.row_version,
    }),
  );
  assert.equal(row.status, "uploading");
  await sql(
    "update versions set created_at=now()-interval '3 hours' where id=$1",
    [row.id],
  );
  const total = (
    await sql("select app.project_storage_bytes($1) n", [ctx.project.id])
  ).rows[0].n;
  assert.equal(Number(total), 3000);
  denied(
    await rest(A.token, "POST", "/resources", {
      project_id: ctx.project.id,
      title: "bypass",
      kind: "paper",
      optional_file_path: "bad.pdf",
      file_size: 1,
    }),
  );
  row = ok(await rest(A.token, "GET", `/versions?id=eq.${row.id}`));
  row = ok(
    await rpc(A, "version_upload_result", {
      p_version: row.id,
      p_expected: row.row_version,
      p_error: "still failed",
    }),
  );
});
test("C revision lifecycle: new sealed proof only, student cannot close/reopen, audit retained", async () => {
  f = ok(
    await rest(owner.token, "POST", "/findings", {
      project_id: ctx.project.id,
      version_id: v.id,
      title: "Perjelas metode",
      acceptance_criterion: "Sebutkan validasi",
    }),
  );
  f = ok(
    await rpc(A, "finding_transition", {
      p_finding: f.id,
      p_expected: f.row_version,
      p_status: "in_progress",
    }),
  );
  const proof = {
    version_id: v.id,
    start_page: 1,
    end_page: 1,
    description: "diperbaiki",
  };
  denied(
    await rpc(A, "finding_transition", {
      p_finding: f.id,
      p_expected: f.row_version,
      p_status: "submitted",
      p_proof: proof,
    }),
    "proof_version_invalid",
  );
  // The newer scan version is sealed and in the same project.
  f = ok(
    await rpc(A, "finding_transition", {
      p_finding: f.id,
      p_expected: f.row_version,
      p_status: "submitted",
      p_proof: { ...proof, version_id: ctx.scan.id },
    }),
  );
  assert.equal(f.revision_proof.file_hash, "a".repeat(64));
  denied(
    await rpc(A, "finding_transition", {
      p_finding: f.id,
      p_expected: f.row_version,
      p_status: "verified_closed",
    }),
    "owner_only",
  );
  denied(
    await rpc(B, "finding_transition", {
      p_finding: f.id,
      p_expected: f.row_version,
      p_status: "verified_closed",
    }),
    "not_found",
  );
  f = ok(
    await rpc(owner, "finding_transition", {
      p_finding: f.id,
      p_expected: f.row_version,
      p_status: "verified_closed",
    }),
  );
  assert.equal(f.closed_by, owner.id);
  denied(
    await rpc(A, "finding_transition", {
      p_finding: f.id,
      p_expected: f.row_version,
      p_status: "reopened",
      p_reason: "hijack",
    }),
    "owner_only",
  );
  denied(
    await rpc(owner, "finding_transition", {
      p_finding: f.id,
      p_expected: f.row_version,
      p_status: "reopened",
      p_reason: "",
    }),
    "reopen_reason_required",
  );
  f = ok(
    await rpc(owner, "finding_transition", {
      p_finding: f.id,
      p_expected: f.row_version,
      p_status: "reopened",
      p_reason: "Validasi belum jelas",
    }),
  );
  assert.equal(f.closed_at, null);
  const events = (
    await sql(
      "select * from audit_events where entity_id=$1 and action='revision_transition'",
      [f.id],
    )
  ).rows;
  assert.equal(events.length, 4);
  assert.equal(events.at(-1).detail.reason, "Validasi belum jelas");
});
test("C comments/replies scope, meetings and notifications persist; student decisions denied", async () => {
  const comment = ok(
    await rest(A.token, "POST", "/comments", {
      project_id: ctx.project.id,
      version_id: v.id,
      pdf_page: 1,
      body: "Perlu penjelasan",
    }),
  );
  ok(
    await rest(owner.token, "POST", "/comments", {
      project_id: ctx.project.id,
      version_id: v.id,
      pdf_page: 1,
      parent_id: comment.id,
      body: "Tambahkan rujukan",
    }),
  );
  denied(
    await rest(A.token, "POST", "/comments", {
      project_id: ctx.project.id,
      version_id: v.id,
      pdf_page: 2,
      parent_id: comment.id,
      body: "wrong scope",
    }),
    "parent_scope_mismatch",
  );
  denied(
    await rest(A.token, "POST", "/comments", {
      project_id: ctx.project.id,
      version_id: v.id,
      pdf_page: 99,
      body: "wrong page",
    }),
    "page_outside_pdf",
  );
  const meeting = ok(
    await rest(owner.token, "POST", "/meetings", {
      project_id: ctx.project.id,
      meeting_at: "2026-10-20T03:00:00Z",
      decisions: "Validasi 5-fold",
      next_targets: "Perbaiki Bab III",
      meeting_url: "https://meet.example.test/a",
    }),
  );
  assert.deepEqual(
    (
      await rest(A.token, "PATCH", `/meetings?id=eq.${meeting.id}`, {
        decisions: "overwrite",
      })
    ).json,
    [],
  );
  assert.equal(
    ok(await rest(A.token, "GET", `/meetings?id=eq.${meeting.id}`)).decisions,
    "Validasi 5-fold",
  );
  const notes = (
    await rest(A.token, "GET", `/notifications?project_id=eq.${ctx.project.id}`)
  ).json;
  assert.ok(notes.some((n) => n.entity_id === meeting.id && !n.read_at));
  assert.ok(
    (
      await rest(
        owner.token,
        "GET",
        `/notifications?entity_id=eq.${comment.id}`,
      )
    ).json.length,
  );
});
test("C drafts are private and compare-and-swap detects a second session", async () => {
  const draft = ok(
    await rest(A.token, "POST", "/workspace_drafts", {
      project_id: ctx.project.id,
      scope: "proof:test",
      payload: { text: "draft" },
    }),
  );
  assert.deepEqual(
    (await rest(owner.token, "GET", `/workspace_drafts?id=eq.${draft.id}`))
      .json,
    [],
  );
  const updated = ok(
    await rest(
      A.token,
      "PATCH",
      `/workspace_drafts?id=eq.${draft.id}&row_version=eq.1`,
      { payload: { text: "saved" } },
    ),
  );
  assert.equal(updated.row_version, 2);
  assert.deepEqual(
    (
      await rest(
        A.token,
        "PATCH",
        `/workspace_drafts?id=eq.${draft.id}&row_version=eq.1`,
        { payload: { text: "stale" } },
      )
    ).json,
    [],
  );
  assert.equal(
    ok(await rest(A.token, "GET", `/workspace_drafts?id=eq.${draft.id}`))
      .payload.text,
    "saved",
  );
  denied(
    await rest(B.token, "POST", "/workspace_drafts", {
      project_id: ctx.project.id,
      scope: "foreign",
      payload: {},
    }),
  );
});
test("C export gate: owner only, complete hashes required, evidence never deleted", async () => {
  denied(
    await rpc(A, "record_file_export", {
      p_project: ctx.project.id,
      p_hashes: { [v.id]: v.file_hash, [ctx.scan.id]: ctx.scan.file_hash },
    }),
    "owner_only",
  );
  denied(
    await rpc(owner, "record_file_export", {
      p_project: ctx.project.id,
      p_hashes: {},
    }),
    "export_missing_file",
  );
  ok(
    await rpc(owner, "record_file_export", {
      p_project: ctx.project.id,
      p_hashes: { [v.id]: v.file_hash, [ctx.scan.id]: ctx.scan.file_hash },
    }),
  );
  denied(
    await rpc(owner, "delete_exported_version", { p_version: v.id }),
    "version_delete_blocked",
  );
  const result = await asUser(owner, (c) =>
    c.query("delete from storage.objects where name=$1", [v.file_path]),
  );
  assert.equal(result.out.rowCount, 0);
  denied(await rest(owner.token, "DELETE", `/versions?id=eq.${v.id}`));
});

test("C exported unreferenced legacy deletion succeeds; pending deletion rejects new evidence", async () => {
  let old = await version(A, ctx.project.id, "legacy.pdf");
  old = ok(
    await rpc(A, "version_confirm", {
      p_version: old.id,
      p_expected: old.row_version,
    }),
  );
  let next = await version(A, ctx.project.id, "latest.pdf");
  next = ok(
    await rpc(A, "version_confirm", {
      p_version: next.id,
      p_expected: next.row_version,
    }),
  );
  const sealed = (
    await rest(
      owner.token,
      "GET",
      `/versions?project_id=eq.${ctx.project.id}&status=eq.confirmed`,
    )
  ).json;
  ok(
    await rpc(owner, "record_file_export", {
      p_project: ctx.project.id,
      p_hashes: Object.fromEntries(sealed.map((v) => [v.id, v.file_hash])),
    }),
  );
  ok(await rpc(owner, "begin_version_deletion", { p_version: old.id }));
  denied(
    await rest(A.token, "POST", "/comments", {
      project_id: ctx.project.id,
      version_id: old.id,
      pdf_page: 1,
      body: "Too late",
    }),
    "version_deletion_pending",
  );
  const removed = await asUser(owner, (c) =>
    c.query("delete from storage.objects where name=$1", [old.file_path]),
  );
  assert.equal(removed.out.rowCount, 1);
  ok(await rpc(owner, "delete_exported_version", { p_version: old.id }));
  assert.deepEqual(
    (await rest(owner.token, "GET", `/versions?id=eq.${old.id}`)).json,
    [],
  );
  assert.ok(
    (
      await sql(
        "select * from audit_events where entity_id=$1 and action='delete_after_export'",
        [old.id],
      )
    ).rows.length,
  );
});

test("C global allocation guard and inactive recipient notification isolation", async () => {
  const limit = (await sql("select global_storage_limit_bytes from app_config"))
    .rows[0].global_storage_limit_bytes;
  const allocated = Number(
    (await sql("select app.global_storage_bytes() n")).rows[0].n,
  );
  await sql("update app_config set global_storage_limit_bytes=$1", [
    allocated + 500,
  ]);
  denied(
    await rest(A.token, "POST", "/versions", {
      project_id: ctx.project.id,
      file_name: "global.pdf",
      file_size: 1000,
    }),
    "global_storage_guard",
  );
  await sql("update app_config set global_storage_limit_bytes=$1", [limit]);
  assert.ok((await rest(A.token, "GET", "/notifications")).json.length);
  const m = (
    await sql("select id from memberships where auth_user_id=$1", [A.id])
  ).rows[0];
  ok(
    await rpc(owner, "owner_set_member_active", {
      p_member: m.id,
      p_active: false,
    }),
  );
  assert.deepEqual((await rest(A.token, "GET", "/notifications")).json, []);
  ok(
    await rpc(owner, "owner_set_member_active", {
      p_member: m.id,
      p_active: true,
    }),
  );
});

test("C seal rejects unapplied private text and range drafts", async () => {
  let doc = await version(A, ctx.project.id, "draft-check.pdf");
  const page = (
    await rest(A.token, "GET", `/pages?version_id=eq.${doc.id}&pdf_page=eq.1`)
  ).json[0];
  const draft = ok(
    await rest(A.token, "POST", "/workspace_drafts", {
      project_id: ctx.project.id,
      scope: `page:${page.id}`,
      payload: {
        text: "Perbaikan privat belum diterapkan",
        printed_label: "iv",
      },
    }),
  );
  denied(
    await rpc(A, "version_confirm", {
      p_version: doc.id,
      p_expected: doc.row_version,
    }),
    "unapplied_drafts",
  );
  doc = ok(
    await rpc(A, "version_save_pages", {
      p_version: doc.id,
      p_expected: doc.row_version,
      p_page_count: 2,
      p_pages: [
        {
          pdf_page: 1,
          text: draft.payload.text,
          printed_label: "iv",
          source: "pasted",
        },
      ],
    }),
  );
  const rd = ok(
    await rest(A.token, "POST", "/workspace_drafts", {
      project_id: ctx.project.id,
      scope: `ranges:${doc.id}`,
      payload: { B1: { start: "1", end: "2" } },
    }),
  );
  denied(
    await rpc(A, "version_confirm", {
      p_version: doc.id,
      p_expected: doc.row_version,
    }),
    "unapplied_drafts",
  );
  doc = ok(
    await rpc(A, "version_save_ranges", {
      p_version: doc.id,
      p_expected: doc.row_version,
      p_ranges: [{ chapter: "B1", start_page: 1, end_page: 2 }],
    }),
  );
  doc = ok(
    await rpc(A, "version_confirm", {
      p_version: doc.id,
      p_expected: doc.row_version,
    }),
  );
  assert.equal(doc.status, "confirmed");
});
