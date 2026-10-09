// Native PG17 multiple connections, source SQL unchanged, no HTTP/provider clients.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import pg from 'pg';
import { validateNativeLedgerTarget, initializeNativeLedgerDb, observeBudgetBlock } from '../../scripts/lib/native-ledger-test.mjs';
import { extractionDigest } from '../../scripts/lib/backup-restore.mjs';

let pool, admin, owner, projects, versions, model, engine;
let passedCases = 0, observedWaits = 0;
const month = "to_char(now() at time zone 'UTC','YYYY-MM')";
const claimSql = 'select public.ai_claim($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result';
const key = () => `native-${randomUUID()}`;
const args = (projectIndex = 0, idem = key(), cache = 'native-scope-a') => [owner, projects[projectIndex], versions[projectIndex], model.id,
  'review', 'B1', { start_page: 1, end_page: 1 }, idem, cache, { model: model.config_hash, scope: 'synthetic-scope', rubric: 'synthetic-rubric', prompt: 'master_prompt-v1' }];
const claim = async (client, values) => (await client.query(claimSql, values)).rows[0].result;
const counts = async () => (await admin.query(`select
  (select count(*)::int from ai_runs) runs,(select count(*)::int from usage_reservations) reservations,
  (select coalesce(sum(max_cost),0)::text from usage_reservations) held`)).rows[0];

before(async () => {
  validateNativeLedgerTarget(process.env.BT_NATIVE_LEDGER_DB_URL);
  pool = new pg.Pool({ connectionString: process.env.BT_NATIVE_LEDGER_DB_URL, max: 4,
    connectionTimeoutMillis: 5000, query_timeout: 10000, statement_timeout: 8000,
    application_name: 'bimbingta-disposable-native-ledger-test' });
  admin = await pool.connect();
  engine = await initializeNativeLedgerDb(admin);
  owner = randomUUID();
  await admin.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,'native-owner@example.test',now(),'{\"provider\":\"google\"}')", [owner]);
  await admin.query("select public.bootstrap_owner('native-owner@example.test')");
  projects = [], versions = [];
  for (let index = 0; index < 2; index++) {
    const project = (await admin.query("insert into projects(owner_uid,title) values($1,$2) returning id", [owner, `Synthetic concurrent project ${index}`])).rows[0].id;
    const version = (await admin.query("insert into versions(project_id,file_name,file_size,page_count) values($1,'synthetic.pdf',32,1) returning *", [project])).rows[0];
    await admin.query("insert into storage.objects(bucket_id,name,metadata) values('thesis-files',$1,'{\"size\":32,\"mimetype\":\"application/pdf\"}')", [version.file_path]);
    await admin.query("update versions set status='extracted',file_hash=$2 where id=$1", [version.id, 'a'.repeat(64)]);
    await admin.query("insert into pages(version_id,pdf_page,text,text_hash) values($1,1,'Synthetic thesis concurrency evidence.','computed')", [version.id]);
    await admin.query("insert into chapter_ranges(version_id,chapter,start_page,end_page,confirmed) values($1,'B1',1,1,true)", [version.id]);
    await admin.query("update versions set status='confirmed',extraction_hash=$2,confirmed_by=$3,confirmed_at=now() where id=$1", [version.id, await extractionDigest(admin, version.id), owner]);
    await admin.query("insert into ai_consents(project_id,user_id,allowed_data,provider_terms_ack) values($1,$2,'{\"providers\":[\"openai\"],\"chapter_text\":true}',true)", [project, owner]);
    projects.push(project); versions.push(version.id);
  }
  model = (await admin.query(`insert into model_settings(provider,model_id,max_input_tokens,max_output_tokens,input_usd_per_million,output_usd_per_million)
    values('openai','synthetic-native-model',1000,100,10,100) returning *`)).rows[0];
  await admin.query("update model_settings set last_test_status='ok',last_tested_hash=config_hash,enabled=true where id=$1", [model.id]);
  await admin.query(`insert into budget_settings(month,ai_enabled,max_cost_usd,per_call_max_usd,max_calls) values(${month},true,5,0.25,40)`);
});

beforeEach(async () => {
  if (!admin) return;
  // Dedicated fresh disposable database only; these are synthetic fixtures, never Supabase rows.
  await admin.query('delete from ai_runs');
  await admin.query(`update budget_settings set ai_enabled=true,max_cost_usd=5,per_call_max_usd=0.25,max_calls=40 where month=${month}`);
});

after(async () => {
  if (admin) {
    const summary = { ...engine, source_sha: process.env.GITHUB_SHA, cases_passed: passedCases,
      observed_budget_lock_waits: observedWaits, authenticated_google_tested: false,
      live_provider_tested: false, supabase_ai_changed: false };
    console.log('NATIVE LEDGER SUMMARY:', JSON.stringify(summary));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## Isolated native ledger concurrency\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n\nOnly runner-local synthetic PostgreSQL; no Supabase secrets, provider calls or application AI activation.\n`);
    admin.release();
  }
  if (pool) await pool.end();
});

async function overlapping(firstArgs, secondArgs, { rollbackFirst = false } = {}) {
  const a = await pool.connect(), b = await pool.connect();
  let pending;
  try {
    const aPid = (await a.query('select pg_backend_pid() pid')).rows[0].pid;
    const bPid = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
    assert.notEqual(aPid, bPid);
    await a.query('begin'); await a.query('set local role service_role');
    await b.query('begin'); await b.query('set local role service_role');
    const first = await claim(a, firstArgs);
    let settled = false;
    pending = claim(b, secondArgs).then((value) => { settled = true; return { value }; }, (error) => { settled = true; return { error }; });
    await observeBudgetBlock(admin, bPid, aPid, () => settled);
    observedWaits++;
    await a.query(rollbackFirst ? 'rollback' : 'commit');
    const second = await pending;
    await b.query(second.error ? 'rollback' : 'commit');
    return { first, second, rollbackFirst };
  } finally {
    await a.query('rollback').catch(() => {});
    if (pending) await pending;
    await b.query('rollback').catch(() => {});
    a.release(); b.release();
  }
}

test('A03 native overlap: same idempotency yields one committed dispatch/run/reservation', async () => {
  const values = args();
  const { first, second } = await overlapping(values, values);
  assert.equal(first.dispatch, true);
  assert.equal(second.value.dispatch, false);
  assert.equal(first.run.id, second.value.run.id);
  assert.deepEqual(await counts(), { runs: 1, reservations: 1, held: '0.020000' });
  passedCases++;
});

test('A04 native overlap: different projects share atomic monthly cost cap', async () => {
  await admin.query(`update budget_settings set max_cost_usd=0.0200 where month=${month}`);
  const { first, second } = await overlapping(args(0), args(1));
  assert.equal(first.dispatch, true);
  assert.equal(second.error.code, '22023');
  assert.equal(second.error.message, 'budget_exceeded');
  assert.equal((await counts()).reservations, 1);
  passedCases++;
});

test('A04 native overlap: monthly call limit blocks the second project', async () => {
  await admin.query(`update budget_settings set max_calls=1 where month=${month}`);
  const { second } = await overlapping(args(0), args(1));
  assert.equal(second.error.message, 'budget_exceeded');
  assert.equal((await counts()).runs, 1);
  passedCases++;
});

test('native overlap: different keys cannot create two active runs in one project', async () => {
  const { second } = await overlapping(args(0), args(0));
  assert.equal(second.error.code, 'PT409');
  assert.equal(second.error.message, 'project_busy');
  assert.equal((await counts()).runs, 1);
  passedCases++;
});

test('native overlap: rolled-back claim leaves no reservation; waiter claims the same key', async () => {
  const values = args();
  const { first, second } = await overlapping(values, values, { rollbackFirst: true });
  assert.equal(second.value.dispatch, true);
  assert.notEqual(first.run.id, second.value.run.id);
  assert.equal((await admin.query('select count(*)::int n from ai_runs where id=$1', [first.run.id])).rows[0].n, 0);
  assert.equal((await counts()).reservations, 1);
  passedCases++;
});

test('A05 native overlap: completed scope cache creates no second reservation or dispatch', async () => {
  const original = await claim(admin, args(0, key(), 'cached-native-scope'));
  await admin.query("select public.ai_finish($1,'succeeded','{\"findings\":[]}','{}','{\"synthetic\":true}',0.01,null,null,'[]',null)", [original.run.id]);
  const { first, second } = await overlapping(args(0, key(), 'cached-native-scope'), args(0, key(), 'cached-native-scope'));
  assert.equal(first.dispatch, false);
  assert.equal(second.value.dispatch, false);
  assert.equal(first.run.cached_from, original.run.id);
  assert.equal(second.value.run.cached_from, original.run.id);
  assert.equal((await counts()).reservations, 1);
  assert.equal((await counts()).runs, 3);
  passedCases++;
});

test('native overlap: same idempotency key cannot redirect a run to another project', async () => {
  const idem = key();
  const { second } = await overlapping(args(0, idem), args(1, idem));
  assert.equal(second.error.code, 'PT409');
  assert.equal(second.error.message, 'idempotency_conflict');
  assert.equal((await counts()).runs, 1);
  passedCases++;
});

test('A01 native: disabled budget denies claim without run or reservation', async () => {
  await admin.query(`update budget_settings set ai_enabled=false where month=${month}`);
  await assert.rejects(claim(admin, args()), (e) => e.code === '42501' && e.message === 'ai_disabled');
  assert.deepEqual(await counts(), { runs: 0, reservations: 0, held: '0' });
  passedCases++;
});

test('native ACL: anon/authenticated cannot execute service-only claim or finish', async () => {
  for (const role of ['anon', 'authenticated']) {
    await admin.query('begin');
    try {
      await admin.query(`set local role ${role}`);
      await assert.rejects(claim(admin, args()), (e) => e.code === '42501');
    } finally { await admin.query('rollback'); }
    await admin.query('begin');
    try {
      await admin.query(`set local role ${role}`);
      await assert.rejects(admin.query("select public.ai_finish($1,'failed','{}','{}','{}',null,null,null,'[]',null)", [randomUUID()]), (e) => e.code === '42501');
    } finally { await admin.query('rollback'); }
  }
  passedCases++;
});
