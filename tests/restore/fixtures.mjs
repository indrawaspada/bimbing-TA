import { randomUUID } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { createRehearsalDb, extractionDigest, digest } from "../../scripts/lib/backup-restore.mjs";

export function packBackup(metadata, pdfs, extra = {}) {
  const json = JSON.stringify(metadata, null, 2);
  const entries = metadata.versions.filter((v) => v.status !== "upload_failed").map((v) => ({
    path: `files/${v.id}.pdf`, version_id: v.id, original_name: v.file_name,
    size: pdfs[v.id].length, sha256: digest(pdfs[v.id]),
  }));
  const manifest = {
    format: "bimbingta-backup", schema_version: 1, project_id: metadata.project.id,
    created_at: metadata.exported_at, metadata_sha256: digest(Buffer.from(json)), files: entries,
    excluded: ["private_notes", "workspace_drafts", "auth", "credentials"],
    not_included: metadata.versions.filter((v) => v.status === "upload_failed").map((v) => ({ id: v.id, status: v.status })),
  };
  return zipSync({
    "metadata.json": strToU8(json), "manifest.json": strToU8(JSON.stringify(manifest)),
    "revisi.csv": strToU8("synthetic CSV"), "laporan.html": strToU8("synthetic report"),
    ...Object.fromEntries(entries.map((e) => [e.path, pdfs[e.version_id]])), ...extra,
  }, { level: 0 });
}

// Source rows come from the real schema/guards, not an invented restore-only schema.
export async function makeBackupFixture() {
  const db = await createRehearsalDb();
  const q = (sql, params) => db.query(sql, params);
  try {
    const owner = randomUUID(), student = randomUUID(), invitation = randomUUID(), project = randomUUID();
    for (const [uid, email] of [[owner, "source-owner@example.test"], [student, "source-student@example.test"]])
      await q("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [uid, email]);
    await q("insert into invitations(id,normalized_email,claimed_uid,created_by) values($1,'source-student@example.test',$2,$3)", [invitation, student, owner]);
    await q("insert into projects(id,owner_uid,invitation_id,title) values($1,$2,$3,'Proyek restore sintetis')", [project, owner, invitation]);
    const pdfs = {}, versionIds = [];
    for (let sequence = 1; sequence <= 2; sequence++) {
      const id = randomUUID(), bytes = Buffer.from(`%PDF-1.4\n% opaque synthetic PDF bytes v${sequence}\n%%EOF\n`);
      versionIds.push(id); pdfs[id] = bytes;
      const version = (await q("insert into versions(id,project_id,file_name,file_size,submitted_by,page_count) values($1,$2,$3,$4,$5,1) returning *", [id, project, `v${sequence}.pdf`, bytes.length, student])).rows[0];
      await q("insert into storage.objects(bucket_id,name,metadata) values('thesis-files',$1,$2)", [version.file_path, { size: bytes.length, mimetype: "application/pdf" }]);
      await q("update versions set status='extracted',file_hash=$2 where id=$1", [id, digest(bytes)]);
      await q("insert into pages(version_id,pdf_page,printed_label,text,source,text_hash) values($1,1,'iv',$2,'pasted','computed-by-trigger')", [id, `Naskah versi ${sequence}: bukti terukur, karakter é dan 😀.`]);
      await q("insert into chapter_ranges(version_id,chapter,start_page,end_page,confirmed) values($1,'B1',1,1,true)", [id]);
      const hash = await extractionDigest(db, id);
      await q("update versions set status='confirmed',extraction_hash=$2,confirmed_by=$3,confirmed_at=$4 where id=$1", [id, hash, student, `2026-10-08T0${sequence}:00:00Z`]);
    }
    const versions = (await q("select * from versions where project_id=$1 order by sequence", [project])).rows;
    const finding = randomUUID(), parent = randomUUID(), reply = randomUUID();
    const proof = { version_id: versionIds[1], start_page: 1, end_page: 1, description: "Bukti versi baru", file_hash: versions[1].file_hash, extraction_hash: versions[1].extraction_hash, submitted_by: student, submitted_at: "2026-10-08T04:00:00Z" };
    await q("insert into findings(id,project_id,version_id,title,locator,source,approval_state,workflow_status,revision_proof,created_by,approved_by,approved_at,closed_by,closed_at,created_at) values($1,$2,$3,'Lengkapi bukti',$4,'manual','accepted','verified_closed',$5,$6,$6,'2026-10-08T01:30:00Z',$6,'2026-10-08T05:00:00Z','2026-10-08T01:30:00Z')", [finding, project, versionIds[0], { version_id: versionIds[0], pdf_page: 1 }, proof, owner]);
    for (const [id, ancestor, author, body] of [[parent, null, owner, `Teks bebas menyebut ${versionIds[0]} tanpa mengganti isinya`], [reply, parent, student, "Sudah diperbaiki"]])
      await q("insert into comments(id,project_id,version_id,pdf_page,chapter,finding_id,parent_id,author_uid,body) values($1,$2,$3,1,'B1',$4,$5,$6,$7)", [id, project, versionIds[0], finding, ancestor, author, body]);
    await q("insert into traceability_rows(project_id,objective,problem,theory_locator,result_locator,status,owner_note,created_by) values($1,'Tujuan terukur','Masalah nyata',$2,$3,'verified','Catatan pembimbing untuk restore',$4)", [project, { version_id: versionIds[0], pdf_page: 1, note: "Teori" }, { version_id: versionIds[1], pdf_page: 1, note: "Hasil" }, owner]);
    await q("insert into meetings(project_id,meeting_at,title,decisions,created_by) values($1,'2026-10-10T02:00:00Z','Bimbingan restore','Bukti diterima',$2)", [project, owner]);
    await q("insert into resources(project_id,kind,title,https_url,created_by) values($1,'demo','Demo restore','https://example.test/demo',$2)", [project, student]);
    await q("insert into milestones(project_id,name,status,created_by) values($1,'Proposal selesai','selesai',$2)", [project, owner]);
    await q("insert into private_notes(project_id,owner_uid,body) values($1,$2,'Tidak boleh masuk backup')", [project, owner]);
    const metadata = {
      format: "bimbingta-project", schema_version: 1, exported_at: "2026-10-09T00:00:00Z",
      scope: "authorized_project_without_private_notes", project: (await q("select * from projects where id=$1", [project])).rows[0],
      documents: [], ai_runs: [], ai_messages: [], ai_rating_reviews: [],
    };
    for (const table of ["versions", "findings", "comments", "meetings", "resources", "milestones", "traceability_rows"])
      metadata[table] = (await q(`select * from ${table} where project_id=$1`, [project])).rows;
    for (const id of versionIds)
      metadata.documents.push({ version_id: id, pages: (await q("select * from pages where version_id=$1", [id])).rows, chapter_ranges: (await q("select * from chapter_ranges where version_id=$1", [id])).rows });
    return { metadata, pdfs, zip: packBackup(metadata, pdfs) };
  } finally { await db.close(); }
}
