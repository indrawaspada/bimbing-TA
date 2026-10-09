// Apply BimbingTA migrations to a HOSTED Supabase DEV project. Safe by default:
//   node scripts/hosted-migrate.mjs                       -> dry run: shows applied/pending, changes nothing
//   node scripts/hosted-migrate.mjs --apply --confirm-ref=<project-ref> [--seed]
// Never resets, never drops tables/schemas, never deletes user data. Each migration runs in its own transaction
// and is recorded in supabase_migrations.schema_migrations (same table the Supabase CLI uses) plus
// supabase/hosted-migrations.log.json (no secrets). Secret values are never printed.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { ROOT, loadConfig, describe, redact } from './lib/env.mjs';
import { validateAuditTarget } from './lib/hosted-audit.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
let cfg;
try { cfg = loadConfig({ needDb: true }); } catch (e) { console.error(e.message); process.exit(2); }
try { validateAuditTarget(cfg); } catch (e) { console.error(e.code); process.exit(2); }
const ref = new URL(cfg.url).hostname.split('.')[0];
console.log(`target: ${describe(cfg)} mode=${args.apply ? 'APPLY' : 'DRY-RUN'}`);
if (args.apply && args['confirm-ref'] !== ref) {
  console.error(`Refusing to apply: pass --confirm-ref=${ref} to confirm this is the DEV/TEST project.`); process.exit(2);
}

const dir = join(ROOT, 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
const FORBIDDEN = /\b(drop\s+(table|schema|database)|truncate|delete\s+from\s+auth\.|db\s+reset)\b/i;
const sha = (s) => createHash('sha256').update(s).digest('hex');

const client = new pg.Client({ application_name: 'bimbingta-migrate', connectionString: cfg.dbUrl, ssl: process.env.BT_DB_NO_SSL ? false : { rejectUnauthorized: false }, statement_timeout: 120000 });
try {
  await client.connect();
  // read-only in dry run: only inspect; the tracking table is created only in --apply mode
  const hasTracking = (await client.query(`select to_regclass('supabase_migrations.schema_migrations') is not null as ok`)).rows[0].ok;
  if (args.only && !hasTracking) throw new Error('Guarded repair requires the existing migration history; no tracking schema created.');
  if (args.apply && !hasTracking) {
    await client.query(`create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
  }
  const recorded = hasTracking || args.apply ? (await client.query('select version,statements from supabase_migrations.schema_migrations')).rows : [];
  for (const row of recorded) {
    const file = files.find((f) => f.slice(0, 14) === row.version);
    if (!file || row.statements?.length !== 1 || sha(row.statements[0]) !== sha(readFileSync(join(dir, file))))
      throw new Error('Recorded migration SQL does not match this reviewed source; no pending migration applied.');
  }
  const applied = new Set(recorded.map((r) => r.version));
  console.log(`tracking table: ${hasTracking ? 'exists' : 'absent (will be created on --apply)'}`);
  const pending = files.filter((f) => !applied.has(f.slice(0, 14)));
  if (args.only && (args.only !== '20261009000010' || pending.some((f) => f.slice(0, 14) !== args.only)))
    throw new Error('Guarded repair permits only migration 20261009000010; no other pending SQL may be applied.');
  if (args.only && args.seed) throw new Error('Guarded repair must not reseed owner weights.');
  console.log(`applied: ${files.filter((f) => applied.has(f.slice(0, 14))).join(', ') || '(none)'}`);
  console.log(`pending: ${pending.join(', ') || '(none)'}`);

  if (pending.length && !applied.size) {
    // fresh-project guard: our tables must not already exist without migration records
    const clash = (await client.query(`select table_name from information_schema.tables where table_schema='public'
      and table_name = any($1)`, [['memberships', 'invitations', 'projects', 'versions', 'findings', 'private_notes']])).rows;
    if (clash.length) throw new Error(`public tables already exist without migration records: ${clash.map((r) => r.table_name).join(', ')}. Aborting (no reset).`);
  }
  for (const f of pending) {
    const sql = readFileSync(join(dir, f), 'utf8');
    if (FORBIDDEN.test(sql)) throw new Error(`${f} contains a destructive statement; aborting.`);
  }
  if (!args.apply) { console.log('dry run complete; nothing changed.'); process.exit(0); }

  const log = existsSync(join(ROOT, 'supabase', 'hosted-migrations.log.json')) ? JSON.parse(readFileSync(join(ROOT, 'supabase', 'hosted-migrations.log.json'), 'utf8')) : [];
  for (const f of pending) {
    const sql = readFileSync(join(dir, f), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)', [f.slice(0, 14), f.slice(15, -4), [sql]]);
      await client.query('commit');
      log.push({ project_ref: ref, migration: f, sha256: sha(sql), applied_at: new Date().toISOString() });
      console.log(`applied ${f}`);
    } catch (e) { await client.query('rollback'); throw new Error(`${f} failed and was rolled back: ${e.message}`); }
  }
  if (args.seed) {
    const seed = execFileSync(process.execPath, [join(ROOT, 'scripts', 'seed-rubric.mjs')], { encoding: 'utf8' });
    await client.query(seed);
    log.push({ project_ref: ref, seed: 'rule_engine-v1.0 + master_prompt-v1 + Bobot awal toolkit v1.0', applied_at: new Date().toISOString() });
    console.log('seeded rubric/prompt (idempotent)');
  }
  writeFileSync(join(ROOT, 'supabase', 'hosted-migrations.log.json'), JSON.stringify(log, null, 2));

  // post-checks
  const noRls = (await client.query(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and not relrowsecurity`)).rows;
  const bucket = (await client.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id='thesis-files'`)).rows[0];
  const rubric = (await client.query(`select rule_count, source_sha256, dimension_weights->>'label' label from public.rubric_versions where is_active`)).rows[0];
  console.log(`post-check: tables_without_rls=${noRls.length} bucket_private=${bucket && !bucket.public} file_limit=${bucket?.file_size_limit} rubric=${rubric ? `${rubric.rule_count} rules ${rubric.source_sha256.slice(0, 12)}… "${rubric.label}"` : 'not seeded'}`);
} catch (e) {
  console.error('ERROR:', redact(e.message, cfg)); process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
