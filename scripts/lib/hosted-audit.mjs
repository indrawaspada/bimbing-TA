// Existing-data checkpoint D audit. Hosted queries are SELECT-only in a read-only transaction.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './env.mjs';
import { createRehearsalDb } from './backup-restore.mjs';

export const DEV_REF = 'tghcovjdsxirhpexpqor';
const hash = (v) => createHash('sha256').update(v).digest('hex');
const check = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
const canonical = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
    : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
const equal = (a, b, code) => {
  if (canonical(a) === canonical(b)) return;
  const error = Object.assign(new Error(code), { code });
  if (Array.isArray(a) && Array.isArray(b)) {
    const index = b.findIndex((row, i) => canonical(row) !== canonical(a[i]));
    error.auditDiagnostic = { actual_count: a.length, expected_count: b.length, first_index: index,
      fields: index < 0 ? [] : Object.keys(b[index]).filter((k) => canonical(b[index][k]) !== canonical(a[index]?.[k])) };
  }
  throw error;
};

export function validateAuditTarget(cfg) {
  check(cfg.url === `https://${DEV_REF}.supabase.co`, 'AUDIT_WRONG_PROJECT');
  let uri;
  try { uri = new URL(cfg.dbUrl); } catch { check(false, 'AUDIT_INVALID_DATABASE_URI'); }
  check(['postgres:', 'postgresql:'].includes(uri.protocol), 'AUDIT_INVALID_DATABASE_URI');
  check((uri.hostname === `db.${DEV_REF}.supabase.co` && uri.username === 'postgres') ||
    (uri.hostname.endsWith('.pooler.supabase.com') && uri.username === `postgres.${DEV_REF}`), 'AUDIT_WRONG_DATABASE');
  check(!uri.port || uri.port === '5432', 'AUDIT_SESSION_PORT_REQUIRED');
  check(uri.pathname === '/postgres' && !!uri.password && !uri.search && !uri.hash, 'AUDIT_INVALID_DATABASE_URI');
}

export async function migrationSources() {
  const directory = join(ROOT, 'supabase/migrations');
  const files = (await readdir(directory)).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  return Promise.all(files.map(async (f) => ({ version: f.slice(0, 14), sql: await readFile(join(directory, f), 'utf8') })));
}

export async function catalogSnapshot(db, functions) {
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  const tables = await rows(`select c.relname name,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
    has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') anon_table,
    has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') anon_column
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by c.relname`);
  const columns = await rows(`select c.relname table_name,a.attname name,format_type(a.atttypid,a.atttypmod) type,
    a.attnotnull not_null,
    has_column_privilege('authenticated',c.oid,a.attnum,'SELECT') auth_read,
    has_column_privilege('authenticated',c.oid,a.attnum,'INSERT') auth_insert,
    has_column_privilege('authenticated',c.oid,a.attnum,'UPDATE') auth_update
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
    order by c.relname,a.attnum`);
  // pg's name[] (OID 1003) has no built-in parser; text[] is decoded identically to PGlite.
  const policies = await rows(`select schemaname,tablename,policyname,permissive,roles::text[] roles,cmd,qual,with_check
    from pg_policies where schemaname='public' or (schemaname='storage' and tablename='objects')
    order by schemaname,tablename,policyname`);
  const fn = await rows(`select n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) args,
    p.prosrc source,l.lanname language,p.prosecdef definer,p.provolatile volatility,p.proconfig config,
    has_function_privilege('anon',p.oid,'EXECUTE') anon,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
    has_function_privilege('service_role',p.oid,'EXECUTE') service,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='app' or (n.nspname='public' and p.proname=any($1::text[]))
    order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)`, [functions]);
  const triggers = await rows(`select c.relname table_name,t.tgname name,t.tgenabled enabled,
    pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
    order by c.relname,t.tgname`);
  return { tables, columns, policies, functions: fn, triggers };
}

export async function auditReference({ throughVersion = '99999999999999' } = {}) {
  const migrations = (await migrationSources()).filter((m) => m.version <= throughVersion);
  const functions = [...new Set(migrations.flatMap(({ sql }) => [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_]+)/gi)].map((m) => m[1])))].sort();
  const db = await createRehearsalDb({ throughVersion });
  try { return { migrations, functions, catalog: await catalogSnapshot(db, functions) }; }
  finally { await db.close(); }
}

export async function auditHosted(db, reference) {
  // BEGIN failure must not be followed by SELECT outside the protected transaction.
  await db.query('begin isolation level repeatable read read only');
  try {
    const rows = async (sql, params) => (await db.query(sql, params)).rows;
    check((await rows('show transaction_read_only'))[0].transaction_read_only === 'on', 'AUDIT_READ_ONLY_REQUIRED');
    const applied = await rows('select version,statements from supabase_migrations.schema_migrations order by version');
    equal(applied.map((m) => m.version), reference.migrations.map((m) => m.version), 'AUDIT_MIGRATION_SET');
    for (const source of reference.migrations) {
      const stored = applied.find((m) => m.version === source.version);
      check(stored.statements?.length === 1 && hash(stored.statements[0]) === hash(source.sql), 'AUDIT_MIGRATION_HASH');
    }
    const catalog = await catalogSnapshot(db, reference.functions);
    for (const section of Object.keys(reference.catalog)) equal(catalog[section], reference.catalog[section], `AUDIT_CATALOG_${section.toUpperCase()}`);
    const bucket = (await rows("select public,file_size_limit::text,allowed_mime_types from storage.buckets where id='thesis-files'"))[0];
    equal(bucket, { public: false, file_size_limit: '26214400', allowed_mime_types: ['application/pdf'] }, 'AUDIT_PDF_BUCKET');
    const app = await rows('select allowed_providers from public.app_config where id');
    equal(app, [{ allowed_providers: ['google'] }], 'AUDIT_MEMBERSHIP_PROVIDER');
    const rubricBytes = await readFile(join(ROOT, 'data/rule_engine.json'));
    const rubric = (await rows('select content_json,source_sha256,rule_count from public.rubric_versions where is_active'));
    check(rubric.length === 1, 'AUDIT_ACTIVE_RUBRIC');
    equal(rubric[0].content_json, JSON.parse(rubricBytes), 'AUDIT_RUBRIC_CONTENT');
    check(rubric[0].source_sha256 === hash(rubricBytes) && rubric[0].rule_count === JSON.parse(rubricBytes).rules.length, 'AUDIT_RUBRIC_HASH');
    const promptBytes = await readFile(join(ROOT, 'data/master_prompt.txt'));
    const prompt = await rows('select content,source_sha256 from public.prompt_versions where is_active');
    check(prompt.length === 1 && prompt[0].content === promptBytes.toString('utf8') && prompt[0].source_sha256 === hash(promptBytes), 'AUDIT_PROMPT_HASH');
    const ai = (await rows(`select
      (select count(*)::int from public.budget_settings where ai_enabled or student_ai_enabled) enabled_budgets,
      (select count(*)::int from public.model_settings where enabled) enabled_models,
      (select count(*)::int from public.ai_runs) runs,
      (select count(*)::int from public.usage_reservations) reservations`))[0];
    check(ai.enabled_budgets === 0 && ai.enabled_models === 0 && ai.runs === 0 && ai.reservations === 0, 'AUDIT_AI_MUST_REMAIN_OFF');
    const counts = (await rows(`select
      (select count(*)::int from auth.users) auth_users,
      (select count(*)::int from public.memberships where role='owner' and active) owners,
      (select count(*)::int from public.memberships where role='student' and active) students,
      (select count(*)::int from public.projects) projects,
      (select count(*)::int from public.invitations) invitations,
      (select count(*)::int from public.versions) versions,
      (select count(*)::int from storage.objects where bucket_id='thesis-files') pdf_objects`))[0];
    return { project_ref: DEV_REF, migrations: applied.length, rls_tables: catalog.tables.length,
      functions: catalog.functions.length, policies: catalog.policies.length, triggers: catalog.triggers.length,
      rubric_rules: rubric[0].rule_count, counts, ai, read_only: true,
      real_oauth_tested: false, hosted_flows_tested: false, provider_called: false };
  } finally { await db.query('rollback'); }
}
