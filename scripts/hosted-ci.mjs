// GitHub Actions preflight and recovery. Never prints credentials or persona tokens.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ROOT, loadConfig, describe, redact } from './lib/env.mjs';

export const DEV_REF = 'tghcovjdsxirhpexpqor';
const journalPath = join(ROOT, '.secrets', 'hosted-run.json');
const hash = (text) => createHash('sha256').update(text).digest('hex');
export const isJwt = (key) => /^eyJ/.test(key || '');
export function parseDatabaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (/^(?:export\s+)?SUPABASE_DB_URL\s*=/i.test(raw))
    throw new Error('SUPABASE_DB_URL: remove the variable name and equals sign; Secret Value must contain only the PostgreSQL URI.');
  if (/^[\x22\x27`]/.test(raw))
    throw new Error('SUPABASE_DB_URL: remove surrounding quotes or backticks from Secret Value.');
  if (/[\r\n]/.test(raw))
    throw new Error('SUPABASE_DB_URL: Secret Value contains multiple lines; paste only one PostgreSQL URI.');
  if (!/^postgres(?:ql)?:\/\//i.test(raw))
    throw new Error('SUPABASE_DB_URL: Secret Value must start with postgresql:// or postgres://; use the full Session pooler URI, not only a password or hostname.');
  try { return new URL(raw); }
  catch {
    throw new Error('SUPABASE_DB_URL: malformed PostgreSQL URI; copy Connect > Session pooler and URL-encode only the password. No connection attempted.');
  }
}
export function validateTarget(cfg) {
  assert.equal(cfg.url, `https://${DEV_REF}.supabase.co`, 'Hosted suite is pinned to BimbingTA DEV');
  const uri = parseDatabaseUrl(cfg.dbUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(uri.protocol), 'Database URI must be PostgreSQL');
  const pooler = uri.hostname.endsWith('.pooler.supabase.com') && uri.username === `postgres.${DEV_REF}`;
  const direct = uri.hostname === `db.${DEV_REF}.supabase.co` && uri.username === 'postgres';
  assert.ok(pooler || direct, 'Database target must match the DEV ref');
  assert.ok(!uri.port || uri.port === '5432', 'Use the session pooler on port 5432');
  for (const [key, role] of [[cfg.anonKey, 'anon'], [cfg.serviceKey, 'service_role']]) {
    if (isJwt(key)) {
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url'));
      assert.equal(payload.role, role, 'API key has incorrect role');
      if (payload.ref) assert.equal(payload.ref, DEV_REF, 'API key belongs to another project');
    } else assert.ok(key.startsWith(role === 'anon' ? 'sb_publishable_' : 'sb_secret_'), 'Incorrect API key type');
  }
}
export function createPool(cfg) {
  validateTarget(cfg);
  return new pg.Pool({ connectionString: cfg.dbUrl, ssl: { rejectUnauthorized: false },
    max: 3, connectionTimeoutMillis: 10000, query_timeout: 20000, statement_timeout: 20000,
    application_name: 'bimbingta-hosted-test' });
}
export async function adminRequest(cfg, method, path, body) {
  const headers = { apikey: cfg.serviceKey, 'Content-Type': 'application/json' };
  if (isJwt(cfg.serviceKey)) headers.Authorization = `Bearer ${cfg.serviceKey}`;
  const response = await fetch(cfg.url + path, { method, headers, signal: AbortSignal.timeout(20000),
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => null) };
}

export async function preflight(cfg, pool) {
  validateTarget(cfg);
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    const counts = (await client.query(`select (select count(*) from auth.users)::int users,
      (select count(*) from public.memberships)::int memberships,
      (select count(*) from public.projects)::int projects,
      (select count(*) from public.invitations)::int invitations,
      (select count(*) from storage.objects where bucket_id='thesis-files')::int pdfs`)).rows[0];
    assert.ok(Object.values(counts).every((n) => n === 0), 'Use an empty dedicated DEV project; existing data is never deleted by preflight');
    const providers = (await client.query('select allowed_providers from public.app_config where id')).rows[0]?.allowed_providers;
    assert.deepEqual(providers, ['google'], 'Application policy must initially be Google only');
    const tables = (await client.query(`select count(*)::int total, count(*) filter (where not relrowsecurity)::int unprotected
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r'`)).rows[0];
    assert.equal(tables.total, 27, 'Expected 27 migrated public tables');
    assert.equal(tables.unprotected, 0, 'All public tables must enable RLS');
    const applied = (await client.query('select version, statements from supabase_migrations.schema_migrations')).rows;
    assert.equal(applied.length, 7, 'Expected exactly seven recorded migrations');
    const directory = join(ROOT, 'supabase', 'migrations');
    const files = readdirSync(directory).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
    assert.equal(files.length, 7);
    for (const file of files) {
      const migration = applied.find((m) => m.version === file.slice(0, 14));
      assert.ok(migration && hash(migration.statements?.[0] || '') === hash(readFileSync(join(directory, file))), 'Migration SQL differs from the tested source');
    }
    const bucket = (await client.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='thesis-files'")).rows[0];
    assert.ok(bucket && !bucket.public && Number(bucket.file_size_limit) === 26214400);
    assert.deepEqual(bucket.allowed_mime_types, ['application/pdf']);
    const rubric = (await client.query('select rule_count, source_sha256 from public.rubric_versions where is_active')).rows[0];
    assert.equal(rubric?.rule_count, 92);
    assert.equal(rubric?.source_sha256, '756c63c4f0c4de476a37aa20d8f83386a39f09ce7c1e44359e94491e64b45569');
    await client.query('rollback');
  } finally {
    await client.query('rollback').catch(() => {});
    client.release();
  }
  const headers = { apikey: cfg.anonKey };
  if (isJwt(cfg.anonKey)) headers.Authorization = `Bearer ${cfg.anonKey}`;
  const response = await fetch(cfg.url + '/auth/v1/settings', { headers, signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, 'Public Auth settings unavailable');
  const auth = await response.json();
  assert.equal(auth.external?.google, true, 'Google provider must remain enabled');
  assert.equal(auth.external?.email, true, 'Email provider needed only for admin-created test personas');
  assert.equal(auth.mailer_autoconfirm, false, 'Email confirmation must remain enabled');
  const admin = await adminRequest(cfg, 'GET', '/auth/v1/admin/users?page=1&per_page=1');
  assert.equal(admin.status, 200, 'Admin key cannot read Auth users');
  assert.deepEqual(admin.json?.users, [], 'Auth API and database must both describe an empty DEV project');
  console.log(`PREFLIGHT PASS: ${describe(cfg)}; empty DEV; 7 exact migrations; 27 RLS tables; private PDF bucket; 92 rubric rules; Auth/admin connectivity verified. No writes.`);
  return { providers: ['google'] };
}

export function saveJournal(run, providers) {
  assert.match(run, /^[a-z0-9-]{8,80}$/);
  assert.deepEqual(providers, ['google']);
  if (existsSync(journalPath)) throw new Error('A previous local test journal exists; run recovery before another full test');
  mkdirSync(join(ROOT, '.secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(journalPath, JSON.stringify({ ref: DEV_REF, run, providers }), { mode: 0o600 });
}
export async function cleanupRun(cfg, pool) {
  if (!existsSync(journalPath)) { console.log('RECOVERY: no test journal; no writes.'); return; }
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  assert.equal(journal.ref, DEV_REF);
  assert.match(journal.run, /^[a-z0-9-]{8,80}$/);
  assert.deepEqual(journal.providers, ['google']);
  const suffix = `-${journal.run}@example.test`;
  const ids = (await pool.query(`select id from auth.users where email like 'bt-test-%' and right(email,length($1))=$1`, [suffix])).rows.map((r) => r.id);
  const projects = (await pool.query('select id from public.projects where owner_uid=any($1::uuid[]) or student_uid=any($1::uuid[])', [ids])).rows.map((r) => r.id);
  // Restore the provider policy even if removing a test PDF later fails.
  await pool.query('update public.app_config set allowed_providers=$1 where id and allowed_providers is distinct from $1::text[]', [journal.providers]);
  for (const project of projects) {
    const names = (await pool.query("select name from storage.objects where bucket_id='thesis-files' and name like $1", [`${project}/%`])).rows.map((r) => r.name);
    if (names.length) assert.ok((await adminRequest(cfg, 'DELETE', '/storage/v1/object/thesis-files', { prefixes: names })).status < 300, 'Test Storage cleanup failed');
  }
  if (projects.length) {
    for (const table of ['comments', 'findings', 'ai_runs', 'projects'])
      await pool.query(`delete from public.${table} where ${table === 'projects' ? 'id' : 'project_id'}=any($1::uuid[])`, [projects]);
  }
  await pool.query('delete from public.audit_events where actor_uid=any($1::uuid[])', [ids]);
  await pool.query("delete from public.invitations where normalized_email like 'bt-test-%' and right(normalized_email,length($1))=$1", [suffix]);
  for (const id of ids) assert.ok((await adminRequest(cfg, 'DELETE', `/auth/v1/admin/users/${id}`)).status < 300, 'Test Auth cleanup failed');
  const remaining = (await pool.query(`select count(*)::int n from auth.users where email like 'bt-test-%' and right(email,length($1))=$1`, [suffix])).rows[0].n;
  assert.equal(remaining, 0, 'Test users remain after cleanup');
  assert.deepEqual((await pool.query('select allowed_providers from public.app_config where id')).rows[0].allowed_providers, ['google']);
  unlinkSync(journalPath);
  console.log('CLEANUP PASS: current run test personas/data removed; Google-only application policy restored.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let cfg, pool;
  try {
    cfg = loadConfig({ needAdmin: true });
    pool = createPool(cfg);
    const mode = process.argv[2] || 'preflight';
    if (mode === 'preflight') await preflight(cfg, pool);
    else if (mode === 'cleanup') await cleanupRun(cfg, pool);
    else throw new Error('Supported modes: preflight, cleanup');
  } catch (error) {
    // Do not print assertion actual/expected fields: they may contain configuration values.
    console.error('HOSTED CI FAILED:', redact(error.message, cfg));
    process.exitCode = 1;
  } finally { if (pool) await pool.end(); }
}
