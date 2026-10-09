// Opt-in native SQL restore rehearsal. Synthetic fixture only; always rollback; no API clients.
import pg from 'pg';
import { appendFile } from 'node:fs/promises';
import { loadConfig } from './lib/env.mjs';
import { DEV_REF, validateAuditTarget, auditReference, auditHosted } from './lib/hosted-audit.mjs';
import { rehearseBackupInTransaction, BackupError } from './lib/backup-restore.mjs';
import { makeBackupFixture, packBackup } from '../tests/restore/fixtures.mjs';

let client;
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || !args.includes(`--confirm-ref=${DEV_REF}`) || !args.includes('--use-existing-owner'))
    throw new BackupError('hosted_rehearsal_requires_dev_and_existing_owner_confirmation');
  const cfg = loadConfig({ needDb: true });
  validateAuditTarget(cfg);
  const reference = await auditReference();
  const fixture = await makeBackupFixture();
  client = new pg.Client({ connectionString: cfg.dbUrl, ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000, query_timeout: 25000, statement_timeout: 20000,
    application_name: 'bimbingta-synthetic-restore-rollback' });
  await client.connect();
  const preflight = await auditHosted(client, reference);
  if (preflight.counts.owners !== 1) throw new BackupError('hosted_rehearsal_requires_one_existing_owner');
  await client.query('begin read only');
  let owner;
  try {
    owner = (await client.query("select auth_user_id from public.memberships where role='owner' and active")).rows[0]?.auth_user_id;
  } finally { await client.query('rollback'); }
  const report = await rehearseBackupInTransaction(client, fixture.zip, { existingOwnerUid: owner });
  const gapped = structuredClone(fixture.metadata);
  gapped.versions[1].sequence = 4;
  const gapReport = await rehearseBackupInTransaction(client, packBackup(gapped, fixture.pdfs), { existingOwnerUid: owner });
  const postflight = await auditHosted(client, reference);
  if (JSON.stringify(preflight.counts) !== JSON.stringify(postflight.counts)) throw new BackupError('hosted_rehearsal_counts_changed');
  const result = { mode: 'hosted_native_sql_rollback', passed: true, synthetic_fixture: true,
    project_ref: DEV_REF, source_sha: process.env.GITHUB_SHA, cases_passed: 2,
    contiguous_versions: report, gapped_versions: gapReport, ai_enabled: false,
    real_google_tested: false, live_pdf_upload_tested: false, production_restore_tested: false };
  console.log('HOSTED RESTORE SQL REHEARSAL PASS');
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## Hosted native SQL restore rollback\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n\nSynthetic PDF bytes and Storage rows; no Storage/Auth API, Google OAuth, provider call or persistent restore.\n`);
} catch (error) {
  console.error('HOSTED RESTORE REHEARSAL FAILED:', /^[A-Z0-9_]+$/i.test(error.code || '') ? error.code : 'rehearsal_connection_or_query_failed');
  process.exitCode = 1;
} finally { if (client) await client.end().catch(() => {}); }
