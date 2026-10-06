// Security & persistence acceptance tests for checkpoint B (S01, S03, S04, S05, S06, S07, storage subset of S02, P05 lock).
// Run: yarn test:security:local    (fresh local Supabase emulation each run)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rest, sql, asUser, persona, createAuthUser, pool } from './harness.mjs';

const owner = persona('dosen.uji@example.test', { userMeta: { full_name: 'Dosen Uji (sintetis)' } });
const A = persona('mhs.a@example.test', { userMeta: { full_name: 'Mahasiswa A (sintetis)' } });
const B = persona('mhs.b@example.test', { userMeta: { full_name: 'Mahasiswa B (sintetis)' } });
const outsider = persona('luar@example.test');
// invited email but NOT verified, and tries to self-assign owner through user_metadata/app_metadata
const spoofer = persona('mhs.c@example.test', { confirmed: false, userMeta: { role: 'owner' }, appMeta: { provider: 'google', providers: ['google'], role: 'owner' } });
// invited + verified but via email/password provider (production allows Google only)
const emailUser = persona('mhs.d@example.test', { provider: 'email' });

const ctx = {};
const denied = (r) => [401, 403].includes(r.status) || (r.status >= 400 && r.status < 500);

after(async () => { await pool.end(); });

test('setup: personas sign in, owner bootstrap, invitations, projects', async () => {
  for (const p of [owner, A, B, outsider, spoofer, emailUser]) await createAuthUser(p);
  // bootstrap is a one-time SQL-editor procedure, not reachable through the API
  const boot = await sql(`select public.bootstrap_owner($1) as r`, [owner.email]);
  assert.equal(boot.rows[0].r, 'owner_membership_created');
  const again = await sql(`select public.bootstrap_owner('x@example.test')`).catch((e) => e);
  assert.match(String(again.message), /owner_already_bootstrapped/);

  const c = await rest(owner.token, 'POST', '/rpc/claim_membership', {});
  assert.equal(c.status, 200); assert.equal(c.json.role, 'owner');

  const inv = await rest(owner.token, 'POST', '/invitations', [
    { normalized_email: '  MHS.A@example.test ' }, { normalized_email: 'mhs.b@example.test' },
    { normalized_email: 'mhs.c@example.test' }, { normalized_email: 'mhs.d@example.test' },
  ]);
  assert.equal(inv.status, 201, JSON.stringify(inv.json));
  const byEmail = Object.fromEntries(inv.json.map((i) => [i.normalized_email, i]));
  assert.ok(byEmail['mhs.a@example.test'], 'email normalized');
  assert.ok(inv.json.every((i) => i.role === 'student'));

  const pA = await rest(owner.token, 'POST', '/projects', { title: 'Klasifikasi Teks Sintetis A', research_profile: 'ml', invitation_id: byEmail['mhs.a@example.test'].id });
  const pB = await rest(owner.token, 'POST', '/projects', { title: 'Sistem Informasi Sintetis B', invitation_id: byEmail['mhs.b@example.test'].id });
  assert.equal(pA.status, 201, JSON.stringify(pA.json)); assert.equal(pB.status, 201);
  ctx.pA = pA.json[0]; ctx.pB = pB.json[0];
  assert.equal(ctx.pA.owner_uid, owner.id); assert.equal(ctx.pA.student_uid, null);

  const ca = await rest(A.token, 'POST', '/rpc/claim_membership', {});
  const cb = await rest(B.token, 'POST', '/rpc/claim_membership', {});
  assert.equal(ca.json.status, 'active'); assert.equal(ca.json.role, 'student'); assert.equal(cb.json.role, 'student');
  const pa = await rest(owner.token, 'GET', `/projects?id=eq.${ctx.pA.id}`);
  assert.equal(pa.json[0].student_uid, A.id, 'claim binds project to verified UID');

  await rest(owner.token, 'POST', '/private_notes', [{ project_id: ctx.pA.id, body: 'Catatan privat dosen A' }, { project_id: ctx.pB.id, body: 'Catatan privat dosen B' }]);
  const ms = await rest(owner.token, 'POST', '/milestones', [
    { project_id: ctx.pA.id, name: 'Proposal', due_at: new Date(Date.now() + 3 * 864e5).toISOString() },
    { project_id: ctx.pB.id, name: 'Proposal B', due_at: null }]);
  assert.equal(ms.status, 201); ctx.msA = ms.json[0]; ctx.msB = ms.json[1];
  const f = await rest(owner.token, 'POST', '/findings', { project_id: ctx.pA.id, title: 'Rumusan masalah belum terukur', severity: 'Major', chapter: 'B1', rule_id: 'B1-R01' });
  assert.equal(f.status, 201, JSON.stringify(f.json)); ctx.fA = f.json[0];
  assert.equal(ctx.fA.workflow_status, 'open'); assert.equal(ctx.fA.approval_state, 'accepted');
  await rest(owner.token, 'POST', '/meetings', { project_id: ctx.pA.id, meeting_at: new Date().toISOString(), decisions: 'Keputusan dosen', meeting_url: 'https://meet.example.test/abc' });
});

test('S01 student A cannot see project B via direct REST (no metadata leak)', async () => {
  const own = await rest(A.token, 'GET', '/projects');
  assert.deepEqual(own.json.map((p) => p.id), [ctx.pA.id]);
  for (const path of [`/projects?id=eq.${ctx.pB.id}`, `/milestones?project_id=eq.${ctx.pB.id}`, `/findings?project_id=eq.${ctx.pB.id}`,
    `/meetings?project_id=eq.${ctx.pB.id}`, `/comments?project_id=eq.${ctx.pB.id}`, `/versions?project_id=eq.${ctx.pB.id}`]) {
    const r = await rest(A.token, 'GET', path);
    assert.equal(r.status, 200); assert.deepEqual(r.json, [], path);
  }
  const mem = await rest(A.token, 'GET', '/memberships');
  assert.deepEqual(mem.json.map((m) => m.auth_user_id), [A.id], 'student sees only own membership');
  const inv = await rest(A.token, 'GET', '/invitations');
  assert.deepEqual(inv.json, [], 'student cannot list allowlist');
  const audit = await rest(A.token, 'GET', '/audit_events');
  assert.deepEqual(audit.json, []);
  const ownerAll = await rest(owner.token, 'GET', '/projects');
  assert.equal(ownerAll.json.length, 2, 'owner sees all assigned projects');
});

test('S03 student cannot change role/owner/student assignment via REST', async () => {
  const attempts = [
    ['PATCH', `/projects?id=eq.${ctx.pA.id}`, { student_uid: B.id }],
    ['PATCH', `/projects?id=eq.${ctx.pA.id}`, { owner_uid: A.id }],
    ['PATCH', `/projects?id=eq.${ctx.pA.id}`, { stage: 'final' }],
    ['PATCH', `/projects?id=eq.${ctx.pA.id}`, { storage_limit_bytes: 262144000 }],
    ['PATCH', `/projects?id=eq.${ctx.pA.id}`, { invitation_id: null }],
    ['PATCH', `/memberships?auth_user_id=eq.${A.id}`, { role: 'owner' }],
    ['POST', '/memberships', { auth_user_id: A.id, verified_email: A.email, role: 'owner' }],
    ['POST', '/invitations', { normalized_email: 'teman@example.test' }],
    ['POST', '/projects', { title: 'Proyek liar mahasiswa' }],
    ['POST', '/rpc/bootstrap_owner', { p_email: A.email }],
    ['POST', '/rpc/owner_set_member_active', { p_member: '00000000-0000-0000-0000-000000000000', p_active: false }],
  ];
  for (const [m, p, b] of attempts) {
    const r = await rest(A.token, m, p, b);
    assert.ok(denied(r), `${m} ${p} ${JSON.stringify(b)} -> ${r.status} ${JSON.stringify(r.json)}`);
  }
  // owner unchanged
  const pa = (await rest(owner.token, 'GET', `/projects?id=eq.${ctx.pA.id}`)).json[0];
  assert.equal(pa.owner_uid, owner.id); assert.equal(pa.student_uid, A.id); assert.equal(pa.stage, 'proposal');
  const roles = await sql(`select role, count(*)::int n from memberships group by role order by role`);
  assert.deepEqual(roles.rows, [{ role: 'owner', n: 1 }, { role: 'student', n: 2 }]);
  // student may edit own manuscript fields
  const ok = await rest(A.token, 'PATCH', `/projects?id=eq.${ctx.pA.id}`, { title: 'Judul diperbarui mahasiswa A', summary: 'Ringkasan' });
  assert.equal(ok.status, 200); assert.equal(ok.json[0].title, 'Judul diperbarui mahasiswa A');
  // ...but not B's project (RLS: zero rows)
  const other = await rest(A.token, 'PATCH', `/projects?id=eq.${ctx.pB.id}`, { title: 'Dibajak oleh A' });
  assert.deepEqual(other.json, []);
  const pb = (await rest(owner.token, 'GET', `/projects?id=eq.${ctx.pB.id}`)).json[0];
  assert.equal(pb.title, 'Sistem Informasi Sintetis B');
});

test('S04 owner private notes are invisible and unwritable for students', async () => {
  const r = await rest(A.token, 'GET', '/private_notes');
  assert.deepEqual(r.json, []);
  const w = await rest(A.token, 'POST', '/private_notes', { project_id: ctx.pA.id, body: 'x' });
  assert.ok(denied(w));
  const own = await rest(owner.token, 'GET', `/private_notes?project_id=eq.${ctx.pA.id}`);
  assert.equal(own.json.length, 1);
});

test('S05 outsider, unverified spoofer and non-Google provider get no data', async () => {
  const o = await rest(outsider.token, 'POST', '/rpc/claim_membership', {});
  assert.equal(o.json.status, 'pending'); assert.equal(o.json.reason, 'not_invited');
  const s = await rest(spoofer.token, 'POST', '/rpc/claim_membership', {});
  assert.equal(s.json.status, 'pending'); assert.equal(s.json.reason, 'email_unverified');
  const e = await rest(emailUser.token, 'POST', '/rpc/claim_membership', {});
  assert.equal(e.json.status, 'pending'); assert.equal(e.json.reason, 'provider_not_allowed');
  for (const p of [outsider, spoofer, emailUser]) {
    for (const path of ['/projects', '/milestones', '/findings', '/memberships', '/invitations', '/app_config', '/rubric_versions', '/model_settings']) {
      const r = await rest(p.token, 'GET', path);
      assert.deepEqual(r.json, [], `${p.email} ${path}`);
    }
  }
  const cnt = await sql(`select count(*)::int n from memberships where auth_user_id = any($1)`, [[outsider.id, spoofer.id, emailUser.id]]);
  assert.equal(cnt.rows[0].n, 0, 'user_metadata role is ignored');
});

test('S06 anonymous CRUD and RPC are unauthorized', async () => {
  for (const [m, p, b] of [['GET', '/projects'], ['GET', '/memberships'], ['POST', '/projects', { title: 'anon' }],
    ['POST', '/rpc/claim_membership', {}], ['GET', '/private_notes'], ['GET', '/rubric_versions']]) {
    const r = await rest(null, m, p, b);
    assert.ok(r.status === 401 || r.status === 403, `${m} ${p} -> ${r.status}`);
  }
});

test('S07 student cannot close finding or edit owner approval/decisions', async () => {
  for (const body of [{ workflow_status: 'verified_closed' }, { approval_state: 'rejected' }, { title: 'diubah mahasiswa' }, { severity: 'Minor' }]) {
    const r = await rest(A.token, 'PATCH', `/findings?id=eq.${ctx.fA.id}`, body);
    assert.ok(denied(r) || (Array.isArray(r.json) && r.json.length === 0), JSON.stringify(body) + ' ' + r.status);
  }
  const owr = await rest(owner.token, 'PATCH', `/findings?id=eq.${ctx.fA.id}`, { workflow_status: 'verified_closed' });
  assert.ok(denied(owr), 'even owner must use the transition RPC');
  const f = (await rest(owner.token, 'GET', `/findings?id=eq.${ctx.fA.id}`)).json[0];
  assert.equal(f.workflow_status, 'open'); assert.equal(f.title, 'Rumusan masalah belum terukur');
  const mt = await rest(A.token, 'PATCH', `/meetings?project_id=eq.${ctx.pA.id}`, { decisions: 'diubah mahasiswa' });
  assert.ok(denied(mt) || mt.json.length === 0);
  const m = (await rest(owner.token, 'GET', `/meetings?project_id=eq.${ctx.pA.id}`)).json[0];
  assert.equal(m.decisions, 'Keputusan dosen');
});

test('Milestones: student reports progress, only owner completes; persistence after re-read', async () => {
  const prog = await rest(A.token, 'PATCH', `/milestones?id=eq.${ctx.msA.id}`, { status: 'diajukan', progress_note: 'Draft proposal sudah diunggah' });
  assert.equal(prog.status, 200, JSON.stringify(prog.json)); assert.equal(prog.json[0].status, 'diajukan');
  for (const body of [{ status: 'selesai' }, { due_at: new Date().toISOString() }, { name: 'ganti' }]) {
    const r = await rest(A.token, 'PATCH', `/milestones?id=eq.${ctx.msA.id}`, body);
    assert.ok(denied(r), JSON.stringify(body));
  }
  assert.ok(denied(await rest(A.token, 'POST', '/milestones', { project_id: ctx.pA.id, name: 'liar' })));
  const del = await rest(A.token, 'DELETE', `/milestones?id=eq.${ctx.msA.id}`);
  assert.ok(denied(del) || del.json.length === 0);
  const xb = await rest(A.token, 'PATCH', `/milestones?id=eq.${ctx.msB.id}`, { progress_note: 'x' });
  assert.deepEqual(xb.json, []);
  const done = await rest(owner.token, 'PATCH', `/milestones?id=eq.${ctx.msA.id}`, { status: 'selesai' });
  assert.equal(done.json[0].status, 'selesai'); assert.ok(done.json[0].completed_at);
  const again = (await rest(A.token, 'GET', `/milestones?id=eq.${ctx.msA.id}`)).json[0];
  assert.equal(again.progress_note, 'Draft proposal sudah diunggah');
});

test('P05 optimistic lock: stale row_version update affects zero rows', async () => {
  const cur = (await rest(owner.token, 'GET', `/projects?id=eq.${ctx.pA.id}`)).json[0];
  const s1 = await rest(owner.token, 'PATCH', `/projects?id=eq.${ctx.pA.id}&row_version=eq.${cur.row_version}`, { summary: 'sesi 1' });
  assert.equal(s1.json.length, 1); assert.equal(s1.json[0].row_version, cur.row_version + 1);
  const s2 = await rest(A.token, 'PATCH', `/projects?id=eq.${ctx.pA.id}&row_version=eq.${cur.row_version}`, { summary: 'sesi 2 (basi)' });
  assert.deepEqual(s2.json, [], 'conflict detected, no silent overwrite');
});

test('S02/P03 storage + versions: path binding, quota, no cross-student upload/read/overwrite', async () => {
  // A registers a draft version on own project -> server binds path project/version
  const v = await rest(A.token, 'POST', '/versions', { project_id: ctx.pA.id, file_name: 'bab1.pdf', file_size: 1_000_000, change_summary: 'Versi awal' });
  assert.equal(v.status, 201, JSON.stringify(v.json));
  const ver = v.json[0];
  assert.equal(ver.file_path, `${ctx.pA.id}/${ver.id}.pdf`); assert.equal(ver.status, 'uploading'); assert.equal(ver.sequence, 1);
  assert.ok(denied(await rest(A.token, 'POST', '/versions', { project_id: ctx.pB.id, file_name: 'x.pdf', file_size: 10 })), 'no version on B project');
  assert.ok(denied(await rest(A.token, 'POST', '/versions', { project_id: ctx.pA.id, file_name: 'big.pdf', file_size: 26_214_401 })), '25 MB limit');
  const q1 = await rest(A.token, 'POST', '/versions', { project_id: ctx.pA.id, file_name: 'q.pdf', file_size: 25_000_000 });
  assert.equal(q1.status, 201, 'within quota (1 MB + 25 MB <= 35 MB)'); assert.equal(q1.json[0].sequence, 2);
  const q2 = await rest(A.token, 'POST', '/versions', { project_id: ctx.pA.id, file_name: 'q2.pdf', file_size: 20_000_000 });
  assert.ok(denied(q2) && /project_quota_exceeded/.test(JSON.stringify(q2.json)), '35 MB project quota: ' + JSON.stringify(q2.json));
  assert.ok(denied(await rest(A.token, 'PATCH', `/versions?id=eq.${ver.id}`, { status: 'confirmed' })), 'client cannot seal/confirm directly');

  // storage.objects under caller RLS (Storage API semantics)
  const up = await asUser(A, (c) => c.query(`insert into storage.objects (bucket_id, name, metadata) values ('thesis-files', $1, '{"size":1000000}')`, [ver.file_path]));
  assert.ok(up.ok, 'A uploads to bound path: ' + up.error?.message);
  const bv = await rest(B.token, 'POST', '/versions', { project_id: ctx.pB.id, file_name: 'b.pdf', file_size: 1000 });
  const bPath = bv.json[0].file_path;
  const upB = await asUser(B, (c) => c.query(`insert into storage.objects (bucket_id, name) values ('thesis-files', $1)`, [bPath]));
  assert.ok(upB.ok);
  const crossUp = await asUser(A, (c) => c.query(`insert into storage.objects (bucket_id, name) values ('thesis-files', $1)`, [`${ctx.pB.id}/${bv.json[0].id}.pdf`]));
  assert.equal(crossUp.ok, false, 'A cannot upload into B path');
  const randomPath = await asUser(A, (c) => c.query(`insert into storage.objects (bucket_id, name) values ('thesis-files', $1)`, [`${ctx.pA.id}/free-name.pdf`]));
  assert.equal(randomPath.ok, false, 'A cannot upload to unbound path');
  const readB = await asUser(A, (c) => c.query(`select name from storage.objects where name = $1`, [bPath]));
  assert.equal(readB.out.rowCount, 0, 'knowing B object path is insufficient (signed URL creation needs SELECT)');
  const overwrite = await asUser(A, (c) => c.query(`update storage.objects set metadata = '{"x":1}' where name = $1`, [ver.file_path]));
  assert.equal(overwrite.ok && overwrite.out.rowCount > 0, false, 'no overwrite of existing object');
  const reup = await asUser(A, (c) => c.query(`insert into storage.objects (bucket_id, name) values ('thesis-files', $1)`, [ver.file_path]));
  assert.equal(reup.ok, false, 'no duplicate upload / upsert');
  const delA = await asUser(A, (c) => c.query(`delete from storage.objects where name = $1`, [ver.file_path]));
  assert.equal(delA.out?.rowCount ?? 0, 0, 'student cannot delete objects');
  const ownerRead = await asUser(owner, (c) => c.query(`select name from storage.objects where bucket_id = 'thesis-files' order by name`));
  assert.equal(ownerRead.out.rowCount, 2, 'owner reads both projects');
  const bucket = await sql(`select public, file_size_limit from storage.buckets where id = 'thesis-files'`);
  assert.deepEqual(bucket.rows[0], { public: false, file_size_limit: '26214400' });
});

test('Rubric data stored verbatim (92 rules) with hash; snapshot immutable', async () => {
  const r = await rest(A.token, 'GET', '/rubric_versions?select=version,rule_count,source_sha256,is_active,dimension_weights,weights_provisional');
  assert.equal(r.json[0].dimension_weights.label, 'Bobot awal toolkit v1.0'); assert.equal(r.json[0].weights_provisional, false);
  assert.equal(r.json[0].dimension_weights.stage_chapter_weights.final.B3, 25);
  assert.equal(r.json[0].rule_count, 92);
  assert.equal(r.json[0].source_sha256, '756c63c4f0c4de476a37aa20d8f83386a39f09ce7c1e44359e94491e64b45569');
  const mod = await rest(owner.token, 'PATCH', '/rubric_versions?is_active=is.true', { content_json: {} });
  assert.ok(denied(mod));
  const p = await rest(A.token, 'GET', '/prompt_versions');
  assert.deepEqual(p.json, [], 'master prompt not exposed to students');
});

test('Deactivated student loses all access immediately', async () => {
  const mem = (await rest(owner.token, 'GET', `/memberships?auth_user_id=eq.${B.id}`)).json[0];
  const off = await rest(owner.token, 'POST', '/rpc/owner_set_member_active', { p_member: mem.id, p_active: false });
  assert.equal(off.status, 204, JSON.stringify(off.json));
  assert.deepEqual((await rest(B.token, 'GET', '/projects')).json, []);
  const on = await rest(owner.token, 'POST', '/rpc/owner_set_member_active', { p_member: mem.id, p_active: true });
  assert.equal(on.status, 204);
  assert.equal((await rest(B.token, 'GET', '/projects')).json.length, 1);
});
