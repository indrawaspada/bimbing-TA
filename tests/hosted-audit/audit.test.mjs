import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { auditReference, auditHosted, validateAuditTarget, DEV_REF } from '../../scripts/lib/hosted-audit.mjs';
import { createRehearsalDb } from '../../scripts/lib/backup-restore.mjs';

let reference, db;
before(async () => {
  reference = await auditReference();
  db = await createRehearsalDb();
  await db.exec('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,statements text[])');
  for (const source of reference.migrations)
    await db.query('insert into supabase_migrations.schema_migrations values($1,$2)', [source.version, [source.sql]]);
});
after(async () => { if (db) await db.close(); });

test('audit pins DEV session database and refuses other targets without logging secrets', () => {
  const cfg = { url: `https://${DEV_REF}.supabase.co`, dbUrl: `postgresql://postgres.${DEV_REF}:dummy-secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres` };
  assert.doesNotThrow(() => validateAuditTarget(cfg));
  for (const dbUrl of [cfg.dbUrl.replace(DEV_REF, 'other-project'), cfg.dbUrl.replace(':5432', ':6543'), cfg.dbUrl + '?options=anything', 'dummy-secret']) {
    assert.throws(() => validateAuditTarget({ ...cfg, dbUrl }), (e) => e.message.startsWith('AUDIT_') && !e.message.includes('dummy-secret'));
  }
  assert.throws(() => validateAuditTarget({ ...cfg, url: 'https://other.supabase.co' }), /AUDIT_WRONG_PROJECT/);
});

test('native SQL audit compares all ten migrations, guards, policies and grants; only read-only SELECTs and rollback', async () => {
  const queries = [];
  const tracked = { query(sql, params) {
    assert.match(sql.trim(), /^(begin isolation level repeatable read read only|show transaction_read_only|select\b|rollback$)/i);
    queries.push(sql);
    return db.query(sql, params);
  } };
  const result = await auditHosted(tracked, reference);
  assert.equal(result.migrations, 10);
  assert.equal(result.rls_tables, 28);
  assert.equal(result.read_only, true);
  assert.equal(result.provider_called, false);
  assert.equal(queries.at(-1), 'rollback');
  assert.equal(result.counts.projects, 0);
});

test('failure to enter read-only mode prevents any hosted SELECT', async () => {
  let calls = 0;
  await assert.rejects(auditHosted({ query: async () => { calls++; throw new Error('blocked'); } }, reference), /blocked/);
  assert.equal(calls, 1);
});

async function rejectsMutation(change, restore, code) {
  await db.exec(change);
  const queries = [];
  try {
    await assert.rejects(auditHosted({ query(sql, p) { queries.push(sql); return db.query(sql, p); } }, reference), { code });
    assert.equal(queries.at(-1), 'rollback');
    assert.equal((await db.query('show transaction_read_only')).rows[0].transaction_read_only, 'off');
  } finally { await db.exec(restore); }
}

test('recorded migration hash drift fails and rolls back', async () => {
  const source = reference.migrations[0];
  await db.query('update supabase_migrations.schema_migrations set statements=$1 where version=$2', [['tampered'], source.version]);
  try { await assert.rejects(auditHosted(db, reference), { code: 'AUDIT_MIGRATION_HASH' }); }
  finally { await db.query('update supabase_migrations.schema_migrations set statements=$1 where version=$2', [[source.sql], source.version]); }
});

test('disabled RLS and anonymous grants fail catalog verification', async () => {
  await rejectsMutation('alter table public.projects disable row level security',
    'alter table public.projects enable row level security', 'AUDIT_CATALOG_TABLES');
  await rejectsMutation('grant select on public.projects to anon',
    'revoke select on public.projects from anon', 'AUDIT_CATALOG_TABLES');
});

test('an added permissive policy cannot hide behind unchanged recorded migrations', async () => {
  await rejectsMutation('create policy unexpected_access on public.projects for select to authenticated using(true)',
    'drop policy unexpected_access on public.projects', 'AUDIT_CATALOG_POLICIES');
});

test('service-only AI RPC ACL widening fails', async () => {
  const fn = reference.catalog.functions.find((f) => f.schema === 'public' && f.name === 'ai_finish');
  assert.ok(fn);
  const signature = `public.ai_finish(${fn.args})`;
  await rejectsMutation(`grant execute on function ${signature} to authenticated`,
    `revoke execute on function ${signature} from authenticated`, 'AUDIT_CATALOG_FUNCTIONS');
});

test('public PDF bucket and enabled AI fail without changing settings', async () => {
  await rejectsMutation("update storage.buckets set public=true where id='thesis-files'",
    "update storage.buckets set public=false where id='thesis-files'", 'AUDIT_PDF_BUCKET');
  await rejectsMutation("insert into public.budget_settings(month,ai_enabled) values('2099-12',true)",
    "delete from public.budget_settings where month='2099-12'", 'AUDIT_AI_MUST_REMAIN_OFF');
});

test('owner-adjusted rubric weights are allowed and never reseeded', async () => {
  const old = (await db.query('select dimension_weights from public.rubric_versions where is_active')).rows[0].dimension_weights;
  await db.query('update public.rubric_versions set dimension_weights=$1 where is_active', [{ custom: 17 }]);
  try {
    await auditHosted(db, reference);
    assert.deepEqual((await db.query('select dimension_weights from public.rubric_versions where is_active')).rows[0].dimension_weights, { custom: 17 });
  } finally { await db.query('update public.rubric_versions set dimension_weights=$1 where is_active', [old]); }
});

test('rubric weights and prompt activation update successfully; snapshot fields remain immutable', async () => {
  const rubric = (await db.query('select * from public.rubric_versions where is_active')).rows[0];
  const prompt = (await db.query('select * from public.prompt_versions where is_active')).rows[0];
  await db.exec('begin');
  try {
    await db.query('update public.rubric_versions set dimension_weights=$1, is_active=false where id=$2', [{ owner: 23 }, rubric.id]);
    await db.query('update public.prompt_versions set is_active=false where id=$1', [prompt.id]);
    assert.equal((await db.query('select dimension_weights from public.rubric_versions where id=$1', [rubric.id])).rows[0].dimension_weights.owner, 23);
  } finally { await db.exec('rollback'); }
  for (const [sql, params, message] of [
    ['update public.rubric_versions set content_json=$1 where id=$2', [{ altered: true }, rubric.id], 'rubric_snapshot_immutable'],
    ['update public.rubric_versions set source_sha256=$1 where id=$2', ['altered', rubric.id], 'rubric_snapshot_immutable'],
    ['update public.rubric_versions set version=$1 where id=$2', ['altered', rubric.id], 'rubric_snapshot_immutable'],
    ['update public.prompt_versions set content=$1 where id=$2', ['altered', prompt.id], 'prompt_snapshot_immutable'],
    ['update public.prompt_versions set source_sha256=$1 where id=$2', ['altered', prompt.id], 'prompt_snapshot_immutable'],
    ['update public.prompt_versions set version=$1 where id=$2', ['altered', prompt.id], 'prompt_snapshot_immutable'],
  ]) await assert.rejects(db.query(sql, params), (e) => e.code === '42501' && e.message === message);
  assert.deepEqual((await db.query('select * from public.rubric_versions where id=$1', [rubric.id])).rows[0], rubric);
  assert.deepEqual((await db.query('select * from public.prompt_versions where id=$1', [prompt.id])).rows[0], prompt);
});

test('authenticated owner can persist weights; authenticated student cannot change owner settings', async () => {
  const owner = randomUUID(), student = randomUUID();
  await db.exec('begin');
  try {
    for (const [id, role] of [[owner, 'owner'], [student, 'student']]) {
      await db.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),'{\"provider\":\"google\"}')", [id, `${role}@example.test`]);
      await db.query('insert into public.memberships(auth_user_id,verified_email,role) values($1,$2,$3)', [id, `${role}@example.test`, role]);
    }
    await db.exec('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [owner, JSON.stringify({ sub: owner, role: 'authenticated' })]);
    const updated = await db.query("update public.rubric_versions set dimension_weights='{\"owner\":23}' where is_active returning dimension_weights");
    assert.deepEqual(updated.rows, [{ dimension_weights: { owner: 23 } }]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [student, JSON.stringify({ sub: student, role: 'authenticated' })]);
    assert.deepEqual((await db.query("update public.rubric_versions set dimension_weights='{}' where is_active returning id")).rows, []);
    await db.exec('reset role');
    assert.deepEqual((await db.query('select dimension_weights from public.rubric_versions where is_active')).rows[0].dimension_weights, { owner: 23 });
  } finally { await db.exec('rollback'); }
});
