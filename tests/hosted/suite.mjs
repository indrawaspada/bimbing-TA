// HOSTED security suite: runs against a real Supabase DEV project.
//   yarn test:hosted
// Requests UNDER TEST always use persona JWTs obtained from Supabase Auth (password grant for synthetic
// personas). The service-role key and DB URL are used ONLY for setup/teardown (create/delete synthetic users,
// one-time owner bootstrap per README, temporary provider allowance) — never for the asserted requests.
// Safety: explicit fixed DEV confirmation + empty-project preflight; cleans ONLY this run's personas.
// On failure teardown fails the suite; CI has a separate always-run recovery step.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { DEV_REF, createPool, adminRequest, preflight, saveJournal, cleanupRun, isJwt } from '../../scripts/hosted-ci.mjs';
import { loadConfig, describe as describeCfg, redact } from '../../scripts/lib/env.mjs';

const cfg = loadConfig({ needAdmin: true });
const RUN = Date.now().toString(36) + '-' + randomBytes(6).toString('hex');
const DOMAIN = 'example.test';
const em = (n) => `bt-test-${n}-${RUN}@${DOMAIN}`;
const pw = () => randomBytes(18).toString('base64url');
const db = createPool(cfg);
const denied = (r) => r.status >= 400 && r.status < 500;
const state = { users: {}, origProviders: null, projectIds: [], objectPaths: [] };
console.log(`# hosted target ${describeCfg(cfg)} run=${RUN}`);

async function http(method, path, { token, body, headers = {}, raw } = {}) {
  const h = { apikey: cfg.anonKey, ...headers };
  if (token) h.Authorization = `Bearer ${token}`; else if (isJwt(cfg.anonKey)) h.Authorization = `Bearer ${cfg.anonKey}`;
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  if (!h.Prefer && path.startsWith('/rest/')) h.Prefer = 'return=representation';
  const res = await fetch(cfg.url + path, { method, headers: h, signal: AbortSignal.timeout(20000), body: raw ? body : body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
const admin = (method, path, body) => adminRequest(cfg, method, path, body);
const rest = (u, m, p, b) => http(m, `/rest/v1${p}`, { token: u?.token, body: b });

async function createUser(key, { confirm = true, meta = {} } = {}) {
  const u = { key, email: em(key), password: pw() };
  const r = await admin('POST', '/auth/v1/admin/users', { email: u.email, password: u.password, email_confirm: confirm, user_metadata: meta });
  assert.ok(r.status < 300, `setup: create ${key} -> ${r.status}`);
  u.id = r.json.id; state.users[key] = u; return u;
}
async function signIn(u) {
  const r = await http('POST', '/auth/v1/token?grant_type=password', { body: { email: u.email, password: u.password } });
  if (r.status === 200) u.token = r.json.access_token;
  return r;
}

before(async () => {
  assert.equal(process.env.BT_HOSTED_CONFIRM_REF, DEV_REF, 'Set BT_HOSTED_CONFIRM_REF to explicitly authorize the empty DEV persona test');
  const baseline = await preflight(cfg, db);
  state.origProviders = baseline.providers;
  saveJournal(RUN, baseline.providers);
  state.journalCreated = true;
  for (const k of ['owner', 'a', 'b', 'outsider', 'emailonly']) await createUser(k);
  await createUser('spoofer', { meta: { role: 'owner', full_name: 'Spoofer' } });
  await createUser('unconfirmed', { confirm: false });
});
after(async () => {
  try { if (state.journalCreated) await cleanupRun(cfg, db); }
  catch (e) { throw new Error('teardown failed: ' + redact(e.message, cfg)); }
  finally { await db.end(); }
});

describe('AUTH (Supabase Auth hosted)', () => {
  test('synthetic personas obtain real JWTs; unconfirmed email cannot sign in', async () => {
    for (const k of ['owner', 'a', 'b', 'outsider', 'emailonly', 'spoofer']) assert.equal((await signIn(state.users[k])).status, 200, k);
    const r = await signIn(state.users.unconfirmed);
    if (r.status === 200) { // project auto-confirms logins; the server-side claim must still refuse it
      const c = await rest(state.users.unconfirmed, 'POST', '/rpc/claim_membership', {});
      assert.equal(c.json?.reason, 'email_unverified');
    } else assert.ok(denied(r), `unconfirmed sign-in -> ${r.status}`);
  });
  test('Google-only policy: verified email/password identity cannot claim even when invited', async () => {
    await db.query(`insert into public.invitations (normalized_email) values ($1)`, [state.users.emailonly.email]); // setup
    const r = await rest(state.users.emailonly, 'POST', '/rpc/claim_membership', {});
    assert.equal(r.json?.status, 'pending'); assert.equal(r.json?.reason, 'provider_not_allowed');
  });
  test('self-edited user_metadata.role=owner is ignored', async () => {
    const s = state.users.spoofer;
    const upd = await http('PUT', '/auth/v1/user', { token: s.token, body: { data: { role: 'owner' } } });
    assert.equal(upd.status, 200);
    await signIn(s);
    const r = await rest(s, 'POST', '/rpc/claim_membership', {});
    assert.equal(r.json?.status, 'pending');
    assert.deepEqual((await rest(s, 'GET', '/projects')).json, []);
  });
  test('tampered JWT (sub swapped, signature kept) is rejected', async () => {
    const [h, p, sig] = state.users.a.token.split('.');
    const claims = JSON.parse(Buffer.from(p, 'base64url')); claims.sub = state.users.b.id;
    const forged = `${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`;
    const r = await http('GET', '/rest/v1/projects', { token: forged });
    assert.equal(r.status, 401);
  });
  test('Auth settings preserve Google signup and verified-email requirement (read-only)', async () => {
    const r = await http('GET', '/auth/v1/settings');
    assert.equal(r.status, 200);
    assert.equal(r.json.external.google, true);
    assert.equal(r.json.external.email, true);
    assert.equal(r.json.mailer_autoconfirm, false);
    // Global signup affects first-time OAuth too; never change it or POST /signup here.
  });
});

describe('DATABASE (PostgREST + RLS hosted)', () => {
  const U = () => state.users; const ctx = {};
  test('setup via README path: bootstrap owner (SQL) then owner/student claims with own JWTs', async () => {
    await db.query(`update public.app_config set allowed_providers = array['google','email'] where id`); // dev-only, restored in teardown
    const b = await db.query(`select public.bootstrap_owner($1) r`, [U().owner.email]);
    assert.equal(b.rows[0].r, 'owner_membership_created');
    assert.equal((await rest(U().owner, 'POST', '/rpc/claim_membership', {})).json.role, 'owner');
    const inv = await rest(U().owner, 'POST', '/invitations', [{ normalized_email: U().a.email }, { normalized_email: U().b.email }]);
    assert.equal(inv.status, 201);
    const pa = await rest(U().owner, 'POST', '/projects', { title: 'Proyek sintetis A', invitation_id: inv.json[0].id });
    const pb = await rest(U().owner, 'POST', '/projects', { title: 'Proyek sintetis B', invitation_id: inv.json[1].id });
    ctx.pA = pa.json[0]; ctx.pB = pb.json[0]; state.projectIds.push(ctx.pA.id, ctx.pB.id); state.ctx = ctx;
    assert.equal((await rest(U().a, 'POST', '/rpc/claim_membership', {})).json.role, 'student');
    assert.equal((await rest(U().b, 'POST', '/rpc/claim_membership', {})).json.role, 'student');
    await rest(U().owner, 'POST', '/private_notes', { project_id: ctx.pA.id, body: 'privat' });
    ctx.f = (await rest(U().owner, 'POST', '/findings', { project_id: ctx.pA.id, title: 'Temuan sintetis', severity: 'Major' })).json[0];
    ctx.m = (await rest(U().owner, 'POST', '/meetings', { project_id: ctx.pA.id, meeting_at: new Date().toISOString(), decisions: 'Keputusan dosen' })).json[0];
    ctx.ms = (await rest(U().owner, 'POST', '/milestones', { project_id: ctx.pA.id, name: 'Proposal' })).json[0];
  });
  test('S01 A sees only own project; B data invisible', async () => {
    assert.deepEqual((await rest(U().a, 'GET', '/projects?select=id')).json.map((x) => x.id), [ctx.pA.id]);
    for (const p of ['projects?id=eq.', 'milestones?project_id=eq.', 'findings?project_id=eq.', 'versions?project_id=eq.'])
      assert.deepEqual((await rest(U().a, 'GET', `/${p}${ctx.pB.id}`)).json, [], p);
    assert.deepEqual((await rest(U().a, 'GET', '/invitations')).json, []);
  });
  test('S03 A cannot change owner/student/role/stage/quota', async () => {
    for (const [m, p, b] of [['PATCH', `/projects?id=eq.${ctx.pA.id}`, { student_uid: U().b.id }], ['PATCH', `/projects?id=eq.${ctx.pA.id}`, { owner_uid: U().a.id }],
      ['PATCH', `/projects?id=eq.${ctx.pA.id}`, { stage: 'final' }], ['PATCH', `/projects?id=eq.${ctx.pA.id}`, { storage_limit_bytes: 262144000 }],
      ['PATCH', `/memberships?auth_user_id=eq.${U().a.id}`, { role: 'owner' }], ['POST', '/memberships', { auth_user_id: U().a.id, verified_email: U().a.email, role: 'owner' }],
      ['POST', '/rpc/bootstrap_owner', { p_email: U().a.email }], ['POST', '/projects', { title: 'liar' }]]) {
      const r = await rest(U().a, m, p, b); assert.ok(denied(r), `${m} ${p} -> ${r.status}`);
    }
    const p = (await rest(U().owner, 'GET', `/projects?id=eq.${ctx.pA.id}`)).json[0];
    assert.equal(p.owner_uid, U().owner.id); assert.equal(p.student_uid, U().a.id); assert.equal(p.stage, 'proposal');
  });
  test('S04 private notes owner-only', async () => {
    assert.deepEqual((await rest(U().a, 'GET', '/private_notes')).json, []);
    assert.ok(denied(await rest(U().a, 'POST', '/private_notes', { project_id: ctx.pA.id, body: 'x' })));
  });
  test('S05 outsider (verified, not invited) gets pending and no data', async () => {
    assert.equal((await rest(U().outsider, 'POST', '/rpc/claim_membership', {})).json.reason, 'not_invited');
    for (const p of ['/projects', '/memberships', '/rubric_versions', '/app_config']) assert.deepEqual((await rest(U().outsider, 'GET', p)).json, [], p);
  });
  test('S06 anonymous (publishable key only) is unauthorized', async () => {
    for (const [m, p, b] of [['GET', '/projects'], ['POST', '/projects', { title: 'anon' }], ['POST', '/rpc/claim_membership', {}], ['GET', '/private_notes']]) {
      const r = await rest(null, m, p, b); assert.ok(r.status === 401 || r.status === 403, `${m} ${p} -> ${r.status}`);
    }
  });
  test('S07 student cannot close finding / edit owner decisions; milestone completion owner-only', async () => {
    const r = await rest(U().a, 'PATCH', `/findings?id=eq.${ctx.f.id}`, { workflow_status: 'verified_closed' }); assert.ok(denied(r));
    const mt = await rest(U().a, 'PATCH', `/meetings?id=eq.${ctx.m.id}`, { decisions: 'x' }); assert.ok(denied(mt) || mt.json.length === 0);
    assert.ok(denied(await rest(U().a, 'PATCH', `/milestones?id=eq.${ctx.ms.id}`, { status: 'selesai' })));
    assert.equal((await rest(U().a, 'PATCH', `/milestones?id=eq.${ctx.ms.id}`, { status: 'diajukan', progress_note: 'ok' })).status, 200);
  });
  test('P05 stale row_version -> zero rows', async () => {
    const cur = (await rest(U().owner, 'GET', `/projects?id=eq.${ctx.pA.id}`)).json[0];
    assert.equal((await rest(U().owner, 'PATCH', `/projects?id=eq.${ctx.pA.id}&row_version=eq.${cur.row_version}`, { summary: '1' })).json.length, 1);
    assert.deepEqual((await rest(U().a, 'PATCH', `/projects?id=eq.${ctx.pA.id}&row_version=eq.${cur.row_version}`, { summary: '2' })).json, []);
  });
  test('rubric: 92 rules, source hash, toolkit weights label', async () => {
    const r = (await rest(U().a, 'GET', '/rubric_versions?select=rule_count,source_sha256,dimension_weights')).json[0];
    assert.equal(r.rule_count, 92); assert.equal(r.source_sha256, '756c63c4f0c4de476a37aa20d8f83386a39f09ce7c1e44359e94491e64b45569');
    assert.equal(r.dimension_weights.label, 'Bobot awal toolkit v1.0');
  });
});

describe('STORAGE (Supabase Storage API hosted)', () => {
  const U = () => state.users;
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const up = (u, path, { upsert = false, type = 'application/pdf', body = pdf } = {}) =>
    http('POST', `/storage/v1/object/thesis-files/${path}`, { token: u?.token, raw: true, body, headers: { 'Content-Type': type, 'x-upsert': String(upsert) } });
  const sign = (u, path) => http('POST', `/storage/v1/object/sign/thesis-files/${path}`, { token: u?.token, body: { expiresIn: 60 } });
  const get = (u, path) => http('GET', `/storage/v1/object/authenticated/thesis-files/${path}`, { token: u?.token });
  let vA, vA2;
  test('A uploads to the server-bound path of own uploading version', async () => {
    const ctx = state.ctx;
    vA = (await rest(U().a, 'POST', '/versions', { project_id: ctx.pA.id, file_name: 'v1.pdf', file_size: pdf.length })).json[0];
    assert.equal(vA.file_path, `${ctx.pA.id}/${vA.id}.pdf`);
    state.versionA = vA; state.pdf = pdf;
    const r = await up(U().a, vA.file_path); assert.ok(r.status === 200, `upload -> ${r.status} ${JSON.stringify(r.json)}`);
  });
  test('cross-student / unbound / overwrite uploads are denied', async () => {
    const ctx = state.ctx;
    assert.ok(denied(await up(U().b, vA.file_path)), 'B into A path');
    assert.ok(denied(await up(U().a, `${ctx.pA.id}/bebas.pdf`)), 'unbound path');
    assert.ok(denied(await up(U().a, vA.file_path, { upsert: true })), 'upsert/overwrite');
    assert.ok(denied(await up(null, vA.file_path)), 'anonymous');
  });
  test('bucket rejects non-PDF content type', async () => {
    vA2 = (await rest(U().a, 'POST', '/versions', { project_id: state.ctx.pA.id, file_name: 'v2.pdf', file_size: 10 })).json[0];
    assert.ok(denied(await up(U().a, vA2.file_path, { type: 'text/plain', body: Buffer.from('bukan pdf') })));
  });
  test('S02 knowing the object path is insufficient: B cannot sign or download A file', async () => {
    assert.ok(denied(await sign(U().b, vA.file_path)), 'B signed URL');
    assert.ok(denied(await get(U().b, vA.file_path)), 'B download');
    assert.ok(denied(await get(U().outsider, vA.file_path)), 'outsider download');
    assert.equal((await get(U().a, vA.file_path)).status, 200, 'A download');
    assert.equal((await get(U().owner, vA.file_path)).status, 200, 'owner download');
    const s = await sign(U().a, vA.file_path); assert.equal(s.status, 200);
  });
  test('student cannot delete stored object', async () => {
    await http('DELETE', '/storage/v1/object/thesis-files', { token: U().a.token, body: { prefixes: [vA.file_path] } });
    assert.equal((await get(U().owner, vA.file_path)).status, 200, 'object still exists');
  });
});

describe('CHECKPOINT C (authenticated PostgREST/RPC hosted)', () => {
  const U = () => state.users;
  const ok = (r) => {
    assert.ok(r.status >= 200 && r.status < 300, `HTTP ${r.status}`);
    return Array.isArray(r.json) ? r.json[0] : r.json;
  };
  const rpc = (u, name, args) => rest(u, 'POST', `/rpc/${name}`, args);
  const rejected = (r, code, message) => {
    assert.ok(r.status >= 400, `Expected rejection, got ${r.status}`);
    assert.equal(r.json?.code, code);
    if (code === 'PT409') assert.equal(r.status, 409, 'Business conflict returns promptly as HTTP 409');
    assert.ok(r.json?.message?.includes(message), 'Unexpected rejection reason');
  };
  test('C01 uploaded PDF becomes sealed; cross-project RPC, stale edit and sealed text rejected', async () => {
    let v = state.versionA;
    const hash = createHash('sha256').update(state.pdf).digest('hex');
    rejected(await rpc(U().b, 'version_upload_result', { p_version: v.id, p_expected: v.row_version, p_hash: hash }), '42501', 'not_found');
    v = ok(await rpc(U().a, 'version_upload_result', { p_version: v.id, p_expected: v.row_version, p_hash: hash }));
    const pages = [{ pdf_page: 1, printed_label: 'iv', text: 'Pendahuluan', source: 'pdfjs' },
      { pdf_page: 2, printed_label: '1', text: 'Metode', source: 'pdfjs' }];
    v = ok(await rpc(U().a, 'version_save_pages', { p_version: v.id, p_expected: v.row_version, p_page_count: 2, p_pages: pages }));
    rejected(await rpc(U().a, 'version_save_pages', { p_version: v.id, p_expected: v.row_version - 1, p_page_count: 2, p_pages: pages }), 'PT409', 'edit_conflict');
    v = ok(await rpc(U().a, 'version_save_ranges', { p_version: v.id, p_expected: v.row_version,
      p_ranges: [{ chapter: 'B1', start_page: 1, end_page: 1 }, { chapter: 'B3', start_page: 2, end_page: 2 }] }));
    v = ok(await rpc(U().a, 'version_confirm', { p_version: v.id, p_expected: v.row_version }));
    assert.equal(v.status, 'confirmed'); assert.equal(v.file_hash, hash); assert.match(v.extraction_hash, /^[a-f0-9]{64}$/);
    rejected(await rpc(U().a, 'version_save_pages', { p_version: v.id, p_expected: v.row_version, p_page_count: 2, p_pages: pages }), '42501', 'version_sealed');
    state.versionA = v;
  });
  test('C02 private draft persists with CAS; owner cannot read it; B cannot write into A', async () => {
    const d = ok(await rest(U().a, 'POST', '/workspace_drafts', { project_id: state.ctx.pA.id, scope: 'proof:hosted', payload: { text: 'autosaved' } }));
    const filter = `/workspace_drafts?id=eq.${d.id}&row_version=eq.${d.row_version}`;
    assert.equal((await rest(U().a, 'PATCH', filter, { payload: { text: 'new' } })).json.length, 1);
    assert.deepEqual((await rest(U().a, 'PATCH', filter, { payload: { text: 'stale' } })).json, []);
    assert.equal((await rest(U().a, 'GET', `/workspace_drafts?id=eq.${d.id}`)).json[0].payload.text, 'new');
    assert.deepEqual((await rest(U().owner, 'GET', `/workspace_drafts?id=eq.${d.id}`)).json, []);
    assert.ok(denied(await rest(U().b, 'POST', '/workspace_drafts', { project_id: state.ctx.pA.id, scope: 'proof:hosted', payload: {} })));
  });
  test('C03 revision evidence is bound to sealed PDF; only owner closes and reopening needs a reason', async () => {
    let f = ok(await rpc(U().a, 'finding_transition', { p_finding: state.ctx.f.id, p_expected: state.ctx.f.row_version, p_status: 'in_progress' }));
    f = ok(await rpc(U().a, 'finding_transition', { p_finding: f.id, p_expected: f.row_version, p_status: 'submitted',
      p_proof: { version_id: state.versionA.id, start_page: 1, end_page: 2, description: 'Bukti revisi sintetis hosted' } }));
    assert.equal(f.revision_proof.file_hash, state.versionA.file_hash);
    rejected(await rpc(U().a, 'finding_transition', { p_finding: f.id, p_expected: f.row_version, p_status: 'verified_closed' }), '42501', 'owner_only');
    f = ok(await rpc(U().owner, 'finding_transition', { p_finding: f.id, p_expected: f.row_version, p_status: 'verified_closed' }));
    assert.equal(f.closed_by, U().owner.id);
    rejected(await rpc(U().owner, 'finding_transition', { p_finding: f.id, p_expected: f.row_version, p_status: 'reopened' }), '22023', 'reopen_reason_required');
    f = ok(await rpc(U().owner, 'finding_transition', { p_finding: f.id, p_expected: f.row_version, p_status: 'reopened', p_reason: 'Perbaiki penjelasan metode' }));
    assert.equal(f.workflow_status, 'reopened');
    const audit = ok(await rest(U().owner, 'GET', `/audit_events?project_id=eq.${state.ctx.pA.id}&action=eq.revision_transition&order=created_at.desc`));
    assert.ok(audit);
  });
});
