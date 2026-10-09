// Disposable localhost PostgreSQL only. Never loads Supabase/admin/provider configuration.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './env.mjs';
import { migrationSources } from './hosted-audit.mjs';

export function validateNativeLedgerTarget(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('NATIVE_LOCAL_TEST_DB_REQUIRED'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username !== 'postgres' ||
      url.pathname !== '/bimbingta_ledger_test' || !url.password || url.search || url.hash ||
      (url.port && !/^\d+$/.test(url.port))) throw new Error('NATIVE_LOCAL_TEST_DB_REQUIRED');
}

export async function initializeNativeLedgerDb(client) {
  const info = (await client.query(`select current_database() db,current_user username,
    current_setting('server_version_num')::int version,
    (select count(*)::int from pg_tables where schemaname='public') public_tables,
    exists(select 1 from pg_namespace where nspname in('app','auth','storage')) app_schema`)).rows[0];
  if (info.db !== 'bimbingta_ledger_test' || info.username !== 'postgres' || info.public_tables !== 0 || info.app_schema ||
      info.version < 170000 || info.version >= 180000) throw new Error('NATIVE_EMPTY_POSTGRES_17_REQUIRED');
  await client.query(await readFile(join(ROOT, 'supabase/tests/local/00_supabase_shim.sql'), 'utf8'));
  const sources = await migrationSources();
  for (const { sql } of sources) {
    await client.query('begin');
    try { await client.query(sql); await client.query('commit'); }
    catch (e) { await client.query('rollback'); throw e; }
  }
  await client.query(execFileSync(process.execPath, [join(ROOT, 'scripts/seed-rubric.mjs')], { encoding: 'utf8' }));
  return { engine: 'native_postgresql', server_version: (await client.query('show server_version')).rows[0].server_version,
    migrations: sources.length, supabase_tested: false, provider_called: false, synthetic_database: true };
}

// Require observed PostgreSQL blocking, not timing guesses or Promise concurrency alone.
export async function observeBudgetBlock(observer, waiterPid, blockerPid, isSettled) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const row = (await observer.query('select pg_blocking_pids($1) blockers', [waiterPid])).rows[0];
    if (row.blockers.includes(blockerPid)) return;
    if (isSettled()) throw new Error('NATIVE_CLAIM_DID_NOT_WAIT_FOR_BUDGET_LOCK');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('NATIVE_BUDGET_LOCK_NOT_OBSERVED');
}
