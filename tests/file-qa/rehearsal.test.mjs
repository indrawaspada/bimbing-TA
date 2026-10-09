// Disposable real SQL/RLS plus transport simulation. Only Actions execution proves service APIs.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRehearsalDb, captureRehearsalState, digest, inspectBackup, planRestore } from '../../scripts/lib/backup-restore.mjs';
import { makeBackupFixture } from '../restore/fixtures.mjs';
import { newFileQaState, validateFileQaState, signedFixtureUrl, exerciseFileServices, cleanupFileServices } from '../../scripts/lib/hosted-file-qa.mjs';
let source;
before(async () => { source = await makeBackupFixture(); });

async function target() {
  const db = await createRehearsalDb(), owner = randomUUID();
  await db.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,'existing-file-owner@example.test',now(),'{\"provider\":\"google\"}')", [owner]);
  await db.query("select bootstrap_owner('existing-file-owner@example.test')");
  const project = (await db.query("insert into projects(owner_uid,title) values($1,'Original project protected') returning id", [owner])).rows[0].id;
  await db.query("insert into private_notes(project_id,owner_uid,body) values($1,$2,'Original private note protected')", [project, owner]);
  const state = newFileQaState(await captureRehearsalState(db), null, digest(source.zip));
  const passwords = new Map(), tokens = new Map(), files = new Map();
  let injectDownloadFailure = false, injectStorageCleanupFailure = false;
  const requests = [];
  const admin = async (method, path, body) => {
    requests.push({ kind: 'admin', method, path });
    if (method === 'POST' && path === '/auth/v1/admin/users') {
      const id = randomUUID();
      await db.query('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values($1,$2,now(),$3,$4)', [id, body.email, { provider: 'email', providers: ['email'] }, body.user_metadata]);
      passwords.set(body.email, { id, password: body.password });
      return { status: 200, json: { id } };
    }
    if (method === 'DELETE' && path.startsWith('/auth/v1/admin/users/')) {
      await db.query('delete from auth.users where id=$1', [path.split('/').at(-1)]);
      return { status: 200, json: {} };
    }
    if (method === 'DELETE' && path === '/storage/v1/object/thesis-files') {
      if (injectStorageCleanupFailure) return { status: 503, json: {} };
      for (const name of body.prefixes) {
        await db.query("delete from storage.objects where bucket_id='thesis-files' and name=$1", [name]);
        files.delete(name);
      }
      return { status: 200, json: {} };
    }
    throw new Error('Unexpected admin method in fixture');
  };
  const client = async (token, fn) => {
    const uid = tokens.get(token) || null;
    await db.query('begin');
    try {
      await db.query(`set local role ${uid ? 'authenticated' : 'anon'}`);
      await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [uid || '', JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : {})]);
      return await fn();
    } catch (e) { return { status: uid ? 403 : 401, json: { code: e.code } }; }
    finally { await db.query('rollback'); }
  };
  const http = async (token, method, path, options = {}) => {
    requests.push({ kind: 'student', method, path });
    if (path === '/auth/v1/token?grant_type=password') {
      const user = passwords.get(options.body.email);
      if (!user || user.password !== options.body.password) return { status: 400, json: {} };
      const jwt = `synthetic.${user.id}.issued`;
      tokens.set(jwt, user.id);
      return { status: 200, json: { access_token: jwt, user: { id: user.id } } };
    }
    if (path === '/functions/v1/ai') {
      assert.deepEqual(options.body, { action: 'status' });
      return { status: 200, json: { providers: {} } };
    }
    if (path.startsWith('/storage/')) {
      const prefix = '/storage/v1/object/';
      if (method === 'POST' && path.startsWith(prefix + 'thesis-files/')) {
        const name = path.slice((prefix + 'thesis-files/').length);
        const result = await client(token, async () => {
          // Check actual SQL/RLS in a rolled-back transaction; persist only an authorized simulated upload.
          await db.query("insert into storage.objects(bucket_id,name,metadata) values('thesis-files',$1,$2)", [name, { size: options.body.length, mimetype: 'application/pdf' }]);
          return { status: 200 };
        });
        if (result.status === 200) {
          await db.query("insert into storage.objects(bucket_id,name,metadata) values('thesis-files',$1,$2)", [name, { size: options.body.length, mimetype: 'application/pdf' }]);
          files.set(name, new Uint8Array(options.body));
        }
        return result;
      }
      const signing = method === 'POST' && path.startsWith(prefix + 'sign/thesis-files/');
      const name = path.slice((prefix + (signing ? 'sign/' : 'authenticated/') + 'thesis-files/').length);
      const visible = await client(token, async () => ({ status: 200, rows: (await db.query("select name from storage.objects where bucket_id='thesis-files' and name=$1", [name])).rows }));
      if (visible.status !== 200 || visible.rows.length === 0) return { status: 404, json: {}, bytes: new Uint8Array() };
      if (signing) return { status: 200, json: { signedURL: `/object/sign/thesis-files/${name}?token=synthetic` } };
      if (injectDownloadFailure) return { status: 503, bytes: new Uint8Array() };
      return { status: 200, bytes: files.get(name) };
    }
    return client(token, async () => {
      if (path === '/rest/v1/rpc/claim_membership') return { status: 200, json: (await db.query('select claim_membership() result')).rows[0].result };
      const url = new URL('https://fixture.test' + path), table = url.pathname.split('/').at(-1);
      assert.ok(['projects','private_notes','memberships','findings','comments','pages'].includes(table));
      const column = ['id','project_id','auth_user_id','version_id'].find((k) => url.searchParams.has(k));
      const params = column ? [url.searchParams.get(column).slice(3)] : [];
      const where = column ? ` where ${column}=$1` : '';
      if (method === 'PATCH') {
        const field = Object.keys(options.body)[0];
        assert.ok(['role','owner_uid'].includes(field));
        await db.query(`update ${table} set ${field}=$2${where}`, [...params, options.body[field]]);
        return { status: 200, json: [] };
      }
      return { status: 200, json: (await db.query(`select ${url.searchParams.get('select') === 'id' ? 'id' : '*'} from ${table}${where}`, params)).rows };
    });
  };
  return { db, owner, project, state, requests, files,
    transport: { url: 'https://tghcovjdsxirhpexpqor.supabase.co', admin, http,
      signedDownload: async (url) => {
        const name = new URL(url).pathname.slice('/storage/v1/object/sign/thesis-files/'.length);
        return { status: 200, bytes: files.get(name) };
      } },
    failDownload: () => { injectDownloadFailure = true; },
    failCleanup: (on) => { injectStorageCleanupFailure = on; } };
}

test('file rehearsal transfers verified bytes, relinks records with actual actor mapping, and cleanup preserves nonempty original data', async () => {
  const t = await target();
  try {
    const result = await exerciseFileServices(t.db, t.state, source.zip, t.transport);
    assert.equal(result.storage_files_transferred, 2);
    assert.equal(result.cases_passed, 26);
    assert.equal(result.google_oauth_tested, false);
    assert.equal(result.provider_called, false);
    assert.equal(t.files.size, 2);
    const cleaned = await cleanupFileServices(t.db, t.state, t.transport.admin);
    assert.equal(cleaned.original_data_unchanged, true);
    assert.equal(t.files.size, 0);
    assert.deepEqual(await captureRehearsalState(t.db), t.state.baseline);
  } finally { await t.db.close(); }
});

test('partial upload/download failure can be recovered exactly without losing original projects or private notes', async () => {
  const t = await target();
  try {
    t.failDownload();
    await assert.rejects(exerciseFileServices(t.db, t.state, source.zip, t.transport), { code: 'storage_download_hash_v1' });
    assert.equal(t.files.size, 1);
    await cleanupFileServices(t.db, t.state, t.transport.admin);
    assert.deepEqual(await captureRehearsalState(t.db), t.state.baseline);
  } finally { await t.db.close(); }
});

test('failed Storage cleanup retains fixture SQL registry for retry; subsequent recovery and repeated cleanup are safe', async () => {
  const t = await target();
  try {
    await exerciseFileServices(t.db, t.state, source.zip, t.transport);
    t.failCleanup(true);
    await assert.rejects(cleanupFileServices(t.db, t.state, t.transport.admin), { code: 'file_qa_storage_cleanup_failed' });
    assert.equal((await t.db.query('select count(*)::int n from projects')).rows[0].n, 3);
    t.failCleanup(false);
    await cleanupFileServices(t.db, t.state, t.transport.admin);
    await cleanupFileServices(t.db, t.state, t.transport.admin);
    assert.deepEqual(await captureRehearsalState(t.db), t.state.baseline);
  } finally { await t.db.close(); }
});

test('cleanup rejects an original project substituted into the journal before any delete/API operation', async () => {
  const t = await target();
  try {
    const bad = structuredClone(t.state); bad.project_ids[0] = t.project;
    await assert.rejects(cleanupFileServices(t.db, bad, t.transport.admin), { code: 'file_qa_cleanup_project_scope_mismatch' });
    assert.equal(t.requests.length, 0);
    assert.deepEqual(await captureRehearsalState(t.db), t.state.baseline);
  } finally { await t.db.close(); }
});

test('fixture replacement and invalid journal fields are rejected before any Auth mutation', async () => {
  const t = await target();
  try {
    await assert.rejects(exerciseFileServices(t.db, t.state, new Uint8Array([1]), t.transport), { code: 'file_qa_fixture_changed' });
    const secret = { ...t.state, password: 'must-not-be-persisted' };
    assert.throws(() => validateFileQaState(secret), { code: 'unexpected_file_qa_journal_field' });
    assert.equal(t.requests.length, 0);
  } finally { await t.db.close(); }
});

test('cleanup rejects a preexisting Auth identity with matching email but without this run marker', async () => {
  const t = await target();
  try {
    await t.db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [randomUUID(), t.state.emails.a]);
    const before = await captureRehearsalState(t.db);
    await assert.rejects(cleanupFileServices(t.db, t.state, t.transport.admin), { code: 'file_qa_cleanup_auth_scope_mismatch' });
    assert.equal(t.requests.length, 0);
    assert.deepEqual(await captureRehearsalState(t.db), before);
  } finally { await t.db.close(); }
});

test('signed URL cannot redirect fixture download to another host, bucket or path', () => {
  const base = 'https://tghcovjdsxirhpexpqor.supabase.co', path = `${randomUUID()}/${randomUUID()}.pdf`;
  assert.equal(new URL(signedFixtureUrl(base, `/object/sign/thesis-files/${path}?token=synthetic`, path)).origin, base);
  for (const signed of [`https://foreign.test/storage/v1/object/sign/thesis-files/${path}?token=x`,
    `/object/sign/other/${path}?token=x`, `/object/sign/thesis-files/${randomUUID()}/${randomUUID()}.pdf?token=x`])
    assert.throws(() => signedFixtureUrl(base, signed, path), { code: 'unexpected_signed_fixture_url' });
});

test('planner binds only explicit existing student and new target project, rejecting identity/entity collisions', () => {
  const archive = inspectBackup(source.zip), student = randomUUID(), project = randomUUID();
  const plan = planRestore(archive, { existingStudentUid: student, targetProjectUid: project });
  assert.equal(plan.project.student_uid, student);
  assert.equal(plan.project.id, project);
  assert.equal(plan.rows.findings[0].revision_proof.submitted_by, student);
  for (const existingStudentUid of [source.metadata.project.owner_uid, source.metadata.versions[0].id])
    assert.throws(() => planRestore(archive, { existingStudentUid }), { code: 'invalid_existing_student_mapping' });
  assert.throws(() => planRestore(archive, { existingStudentUid: student, targetProjectUid: student }), { code: 'invalid_target_project_mapping' });
});

test('file QA CLI refuses missing/wrong target, apply, or arbitrary ZIP before reading credentials', () => {
  const script = fileURLToPath(new URL('../../scripts/hosted-file-rehearsal.mjs', import.meta.url));
  for (const args of [[], ['--apply'], ['run','--confirm-ref=wrong','--use-existing-owner'],
    ['run','--confirm-ref=tghcovjdsxirhpexpqor','--use-existing-owner','backup.zip']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /file_qa_requires_mode_dev_and_existing_owner_confirmation/);
    assert.equal(result.stdout, '');
  }
});
