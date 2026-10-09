// Temporary current-data DEV fixtures. Admin setup/cleanup; asserted HTTP uses synthetic students' issued JWTs.
import { randomUUID, randomBytes } from 'node:crypto';
import { inspectBackup, planRestore, extractionDigest, digest, captureRehearsalState } from './backup-restore.mjs';
export const FILE_QA_REF = 'tghcovjdsxirhpexpqor';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TABLES = ['versions', 'findings', 'comments', 'meetings', 'resources', 'milestones', 'traceability_rows'];
export class FileQaError extends Error { constructor(code) { super(code); this.code = code; } }
const check = (ok, code) => { if (!ok) throw new FileQaError(code); };
const same = (a, b, code) => check(JSON.stringify(a) === JSON.stringify(b), code);

export function newFileQaState(baseline, sourceSha = null, fixtureSha256) {
  const run = randomBytes(10).toString('hex');
  return { format: 'bimbingta-file-qa-recovery', version: 1, dev_ref: FILE_QA_REF, run,
    project_ids: [randomUUID(), randomUUID()],
    emails: Object.fromEntries(['a', 'b', 'outsider'].map((role) => [role, `bt-file-${role}-${run}@example.test`])),
    baseline, fixture_sha256: fixtureSha256, source_sha: sourceSha, prepared_at: new Date().toISOString() };
}

export function validateFileQaState(state) {
  check(state && state.format === 'bimbingta-file-qa-recovery' && state.version === 1 && state.dev_ref === FILE_QA_REF, 'invalid_file_qa_journal');
  check(Object.keys(state).every((k) => ['format','version','dev_ref','run','project_ids','emails','baseline','fixture_sha256','source_sha','prepared_at'].includes(k)), 'unexpected_file_qa_journal_field');
  check(/^[a-f0-9]{20}$/.test(state.run) && state.project_ids?.length === 2 && state.project_ids.every((id) => UUID.test(id))
    && new Set(state.project_ids).size === 2, 'invalid_file_qa_scope');
  check(state.emails && Object.keys(state.emails).length === 3 && ['a','b','outsider'].every((r) => state.emails[r] === `bt-file-${r}-${state.run}@example.test`), 'invalid_file_qa_emails');
  check(Array.isArray(state.baseline) && state.baseline.length === 31 && state.baseline.every((r) =>
    /^(public\.[a-z_]+|auth\.users|storage\.(objects|buckets))$/.test(r.table_name) && Number.isSafeInteger(r.rows) && r.rows >= 0 && /^[a-f0-9]{64}$/.test(r.content_hash)), 'invalid_file_qa_baseline');
  check(state.source_sha === null || /^[a-f0-9]{40}$/.test(state.source_sha), 'invalid_file_qa_source');
  check(/^[a-f0-9]{64}$/.test(state.fixture_sha256), 'invalid_file_qa_fixture_hash');
}

export function signedFixtureUrl(baseUrl, signedPath, filePath) {
  check(typeof signedPath === 'string', 'missing_signed_fixture_url');
  const base = new URL(baseUrl);
  const url = new URL(signedPath.startsWith('/object/') ? `/storage/v1${signedPath}` : signedPath, base);
  check(url.origin === base.origin && url.pathname === `/storage/v1/object/sign/thesis-files/${filePath}` && !!url.searchParams.get('token'), 'unexpected_signed_fixture_url');
  return url.href;
}

async function inserter(db) {
  const columns = new Map();
  for (const table of ['projects', ...TABLES, 'pages', 'chapter_ranges'])
    columns.set(table, new Set((await db.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1", [table])).rows.map((r) => r.column_name)));
  return async (table, row) => {
    check(columns.has(table) && Object.keys(row).every((k) => columns.get(table).has(k)), 'unsupported_file_restore_field');
    const values = { ...row, row_version: 1 }, names = Object.keys(values);
    return (await db.query(`insert into public.${table} (${names.map((n) => `"${n}"`).join(',')}) values (${names.map((_, i) => `$${i+1}`).join(',')}) returning *`, Object.values(values))).rows[0];
  };
}

// Only fixed synthetic ZIP from the caller; no operator ZIP/apply or production mode.
export async function exerciseFileServices(db, state, sourceZip, transport) {
  validateFileQaState(state);
  check(digest(sourceZip) === state.fixture_sha256, 'file_qa_fixture_changed');
  const archive = inspectBackup(sourceZip);
  planRestore(archive); // Refuse unsupported/corrupt metadata before creating Auth fixtures.
  same(await captureRehearsalState(db), state.baseline, 'file_qa_baseline_changed');
  const existing = (await db.query("select auth_user_id from memberships where role='owner' and active")).rows;
  check(existing.length === 1, 'file_qa_requires_existing_owner');
  const owner = existing[0].auth_user_id, users = {};
  for (const role of ['a','b','outsider']) {
    const password = randomBytes(24).toString('base64url');
    const created = await transport.admin('POST', '/auth/v1/admin/users', { email: state.emails[role], password, email_confirm: true,
      user_metadata: { full_name: `Synthetic file QA ${role}`, bimbingta_file_qa_run: state.run, role: role === 'outsider' ? 'owner' : 'student' } });
    check(created.status === 200 || created.status === 201, 'file_qa_create_user_failed');
    check(UUID.test(created.json?.id), 'file_qa_invalid_auth_user');
    const signed = await transport.http(null, 'POST', '/auth/v1/token?grant_type=password', { body: { email: state.emails[role], password } });
    check(signed.status === 200 && typeof signed.json?.access_token === 'string' && signed.json?.user?.id === created.json.id, 'file_qa_signin_failed');
    users[role] = { id: created.json.id, token: signed.json.access_token };
  }
  // Privileged fixture enrollment, not Google OAuth or invitation claim evidence.
  for (const role of ['a','b'])
    await db.query("insert into memberships(auth_user_id,verified_email,role) values($1,$2,'student')", [users[role].id, state.emails[role]]);
  const plan = planRestore(archive, { existingOwnerUid: owner, existingStudentUid: users.a.id, targetProjectUid: state.project_ids[0] });
  const insert = await inserter(db), marker = `[BT-file-${state.run}]`;
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, role: 'authenticated' })]);
  await db.query('insert into invitations(id,normalized_email,claimed_uid,created_by) values($1,$2,$3,$4)', [plan.project.invitation_id, state.emails.a, users.a.id, owner]);
  await insert('projects', { ...plan.project, title: `${marker} Restored synthetic project` });
  const foreignInvite = randomUUID();
  await db.query('insert into invitations(id,normalized_email,claimed_uid,created_by) values($1,$2,$3,$4)', [foreignInvite, state.emails.b, users.b.id, owner]);
  await insert('projects', { id: state.project_ids[1], owner_uid: owner, invitation_id: foreignInvite, title: `${marker} Foreign synthetic project` });
  await db.query('insert into invitations(normalized_email,created_by) values($1,$2)', [state.emails.outsider, owner]);
  await db.query("insert into private_notes(project_id,owner_uid,body) values($1,$2,'Synthetic private QA note')", [plan.project.id, owner]);

  const cases = [];
  const record = (name, condition) => { check(condition, name); cases.push(name); };
  const a = users.a.token, b = users.b.token, outsider = users.outsider.token;
  record('auth_issued_password_jwts', [a,b,outsider].every((t) => t.split('.').length === 3));
  const outsiderClaim = await transport.http(outsider, 'POST', '/rest/v1/rpc/claim_membership', { body: {} });
  record('google_only_claim_still_denies_invited_email_spoofer', outsiderClaim.status === 200 && outsiderClaim.json?.reason === 'provider_not_allowed');
  const outsiderProjects = await transport.http(outsider, 'GET', '/rest/v1/projects?select=id');
  record('outsider_reads_no_projects', outsiderProjects.status === 200 && outsiderProjects.json?.length === 0);
  const projectRows = await transport.http(a, 'GET', '/rest/v1/projects?select=id');
  record('student_reads_only_own_temporary_project', projectRows.status === 200 && projectRows.json?.length === 1 && projectRows.json[0].id === plan.project.id);
  const privateRows = await transport.http(a, 'GET', `/rest/v1/private_notes?project_id=eq.${plan.project.id}`);
  record('student_cannot_read_owner_private_notes', privateRows.status === 200 && privateRows.json?.length === 0);
  const roleChange = await transport.http(a, 'PATCH', `/rest/v1/memberships?auth_user_id=eq.${users.a.id}`, { body: { role: 'owner' } });
  record('student_cannot_promote_own_membership', roleChange.status >= 400 && roleChange.status < 500);
  const ownerChange = await transport.http(a, 'PATCH', `/rest/v1/projects?id=eq.${plan.project.id}`, { body: { owner_uid: users.a.id } });
  record('student_cannot_change_project_owner', ownerChange.status >= 400 && ownerChange.status < 500);
  const status = await transport.http(a, 'POST', '/functions/v1/ai', { body: { action: 'status' }, headers: { Origin: 'https://codex-checkpoint-d.bimbing-ta.pages.dev' } });
  record('edge_accepts_issued_student_jwt_status_without_provider_access', status.status === 200 && JSON.stringify(status.json?.providers) === '{}');

  const documents = new Map(plan.documents.map((d) => [d.version_id, d]));
  const targetToSource = new Map([...plan.ids].map(([source,target]) => [target,source]));
  let fileBytes = 0;
  for (const version of plan.rows.versions) {
    check(version.status === 'confirmed', 'file_qa_requires_sealed_synthetic_versions');
    const bytes = archive.files[`files/${targetToSource.get(version.id)}.pdf`];
    const created = await insert('versions', { ...version, status: 'uploading', file_hash: null, extraction_hash: null, confirmed_at: null, confirmed_by: null });
    check(created.sequence === version.sequence && created.file_path === version.file_path, 'file_qa_version_binding_failed');
    const upload = await transport.http(a, 'POST', `/storage/v1/object/thesis-files/${version.file_path}`, { body: bytes, raw: true, headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' } });
    record(`storage_upload_v${version.sequence}`, upload.status >= 200 && upload.status < 300);
    await db.query("update versions set status='extracted',file_hash=$2 where id=$1", [version.id, version.file_hash]);
    for (const page of documents.get(version.id).pages) await insert('pages', page);
    for (const range of documents.get(version.id).chapter_ranges) await insert('chapter_ranges', range);
    check(await extractionDigest(db, version.id) === version.extraction_hash, 'file_qa_sealed_snapshot_mismatch');
    await db.query("update versions set status='confirmed',extraction_hash=$2,confirmed_at=$3,confirmed_by=$4 where id=$1", [version.id, version.extraction_hash, version.confirmed_at, version.confirmed_by]);
    const downloaded = await transport.http(a, 'GET', `/storage/v1/object/authenticated/thesis-files/${version.file_path}`, { binary: true });
    record(`storage_download_hash_v${version.sequence}`, downloaded.status === 200 && digest(downloaded.bytes) === version.file_hash && downloaded.bytes.length === bytes.length);
    fileBytes += bytes.length;
    const signed = await transport.http(a, 'POST', `/storage/v1/object/sign/thesis-files/${version.file_path}`, { body: { expiresIn: 30 } });
    check(signed.status === 200, 'file_qa_signed_url_failed');
    const signedUrl = signedFixtureUrl(transport.url, signed.json?.signedURL, version.file_path);
    const signedDownload = await transport.signedDownload(signedUrl);
    record(`storage_signed_download_hash_v${version.sequence}`, signedDownload.status === 200 && digest(signedDownload.bytes) === version.file_hash);
    const crossDownload = await transport.http(b, 'GET', `/storage/v1/object/authenticated/thesis-files/${version.file_path}`, { binary: true });
    record(`cross_student_download_denied_v${version.sequence}`, crossDownload.status >= 400 && crossDownload.status < 500);
    const crossSign = await transport.http(b, 'POST', `/storage/v1/object/sign/thesis-files/${version.file_path}`, { body: { expiresIn: 30 } });
    record(`cross_student_signed_url_denied_v${version.sequence}`, crossSign.status >= 400 && crossSign.status < 500);
    const overwrite = await transport.http(a, 'POST', `/storage/v1/object/thesis-files/${version.file_path}`, { body: bytes, raw: true, headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true' } });
    record(`sealed_file_overwrite_denied_v${version.sequence}`, overwrite.status >= 400 && overwrite.status < 500);
  }
  for (const table of ['findings','comments','meetings','resources','milestones','traceability_rows'])
    for (const row of plan.rows[table]) await insert(table, row);
  const findings = await transport.http(a, 'GET', `/rest/v1/findings?project_id=eq.${plan.project.id}`);
  const proof = findings.json?.[0]?.revision_proof;
  record('restored_revision_proof_relinks_new_version_and_actor', findings.status === 200 && findings.json.length === 1 && proof?.version_id === plan.rows.versions[1].id && proof?.submitted_by === users.a.id);
  const comments = await transport.http(a, 'GET', `/rest/v1/comments?project_id=eq.${plan.project.id}`);
  record('restored_comment_reply_relinks_new_parent', comments.status === 200 && comments.json?.length === 2 && comments.json.some((r) => r.parent_id && comments.json.some((p) => p.id === r.parent_id)));
  const foreign = await transport.http(b, 'GET', `/rest/v1/findings?project_id=eq.${plan.project.id}`);
  record('cross_student_restored_finding_denied', foreign.status === 200 && foreign.json?.length === 0);
  const pages = await transport.http(a, 'GET', `/rest/v1/pages?version_id=eq.${plan.rows.versions[0].id}`);
  record('restored_pages_visible_only_to_own_student', pages.status === 200 && pages.json?.length === 1 && pages.json[0].text_hash === plan.documents[0].pages[0].text_hash);
  const foreignPages = await transport.http(b, 'GET', `/rest/v1/pages?version_id=eq.${plan.rows.versions[0].id}`);
  record('cross_student_restored_pages_denied', foreignPages.status === 200 && foreignPages.json?.length === 0);
  const anonymous = await transport.http(null, 'GET', `/rest/v1/projects?id=eq.${plan.project.id}`);
  record('anonymous_project_request_denied', anonymous.status === 401);
  return { cases_passed: cases.length, checks: cases, restored_versions: plan.rows.versions.length, storage_files_transferred: plan.rows.versions.length,
    storage_bytes_verified: fileBytes, synthetic_fixture: true, auth_issued_jwts: true,
    fixture_memberships_enrolled_by_sql: true, google_oauth_tested: false, browser_extraction_tested: false,
    file_service_tested: true, provider_called: false, ai_enabled: false, production_restore_tested: false };
}

export async function cleanupFileServices(db, state, adminRequest) {
  validateFileQaState(state);
  const users = (await db.query('select id,email,raw_user_meta_data from auth.users where lower(email)=any($1::text[])', [Object.values(state.emails)])).rows;
  check(users.every((u) => u.raw_user_meta_data?.bimbingta_file_qa_run === state.run), 'file_qa_cleanup_auth_scope_mismatch');
  const userIds = users.map((u) => u.id);
  const owner = (await db.query("select auth_user_id from memberships where role='owner' and active")).rows;
  check(owner.length === 1 && !userIds.includes(owner[0].auth_user_id), 'file_qa_cleanup_owner_protected');
  const projects = (await db.query('select id,title,owner_uid,student_uid from projects where id=any($1::uuid[])', [state.project_ids])).rows;
  check(projects.every((p) => p.title.startsWith(`[BT-file-${state.run}]`) && p.owner_uid === owner[0].auth_user_id && userIds.includes(p.student_uid)), 'file_qa_cleanup_project_scope_mismatch');
  for (const project of projects) {
    const paths = (await db.query("select name from storage.objects where bucket_id='thesis-files' and name like $1", [`${project.id}/%`])).rows.map((r) => r.name);
    check(paths.every((name) => new RegExp(`^${project.id}/[0-9a-f-]{36}\\.pdf$`).test(name)), 'file_qa_cleanup_unknown_storage_path');
    if (paths.length) {
      const deleted = await adminRequest('DELETE', '/storage/v1/object/thesis-files', { prefixes: paths });
      check(deleted.status >= 200 && deleted.status < 300, 'file_qa_storage_cleanup_failed');
    }
    check((await db.query("select count(*)::int n from storage.objects where bucket_id='thesis-files' and name like $1", [`${project.id}/%`])).rows[0].n === 0, 'file_qa_storage_rows_remain');
  }
  await db.query('begin');
  try {
    for (const table of ['comments','findings']) await db.query(`delete from public.${table} where project_id=any($1::uuid[])`, [state.project_ids]);
    await db.query('delete from public.audit_events where project_id=any($1::uuid[]) or actor_uid=any($2::uuid[])', [state.project_ids, userIds]);
    await db.query('delete from projects where id=any($1::uuid[])', [state.project_ids]);
    await db.query('delete from invitations where normalized_email=any($1::text[])', [Object.values(state.emails)]);
    await db.query('delete from memberships where auth_user_id=any($1::uuid[])', [userIds]);
    await db.query('commit');
  } catch (e) { await db.query('rollback'); throw new FileQaError('file_qa_database_cleanup_failed'); }
  for (const user of users) {
    const deleted = await adminRequest('DELETE', `/auth/v1/admin/users/${user.id}`);
    check(deleted.status >= 200 && deleted.status < 300, 'file_qa_auth_cleanup_failed');
  }
  const after = await captureRehearsalState(db);
  same(after, state.baseline, 'file_qa_original_data_changed');
  return { cleanup_verified: true, original_tables_verified: 31, original_data_unchanged: true };
}
