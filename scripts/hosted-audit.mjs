import pg from 'pg';
import { appendFile } from 'node:fs/promises';
import { loadConfig } from './lib/env.mjs';
import { validateAuditTarget, auditReference, auditHosted } from './lib/hosted-audit.mjs';

let client;
try {
  const allowPendingRepair = process.argv.length === 3 && process.argv[2] === '--allow-pending-rubric-repair';
  if (process.argv.length !== 2 && !allowPendingRepair) throw Object.assign(new Error('AUDIT_NO_WRITE_MODE'), { code: 'AUDIT_NO_WRITE_MODE' });
  const cfg = loadConfig({ needDb: true });
  validateAuditTarget(cfg);
  client = new pg.Client({ connectionString: cfg.dbUrl, ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000, query_timeout: 20000, statement_timeout: 20000,
    application_name: 'bimbingta-checkpoint-d-readonly-audit' });
  await client.connect();
  let throughVersion;
  if (allowPendingRepair) {
    await client.query('begin read only');
    try {
      const applied = await client.query("select exists(select 1 from supabase_migrations.schema_migrations where version='20261009000010') repaired");
      if (!applied.rows[0].repaired) throughVersion = '20261008000009';
    } finally { await client.query('rollback'); }
  }
  const reference = await auditReference({ throughVersion });
  const report = await auditHosted(client, reference);
  report.pending_rubric_repair = throughVersion === '20261008000009';
  console.log('CHECKPOINT D READ-ONLY AUDIT PASS');
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## Checkpoint D read-only audit\n\nSource: \`${process.env.GITHUB_SHA}\`\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n\nThis audit does not prove real Google login, cross-user UI, hosted restore or provider execution.\n`);
} catch (error) {
  // Never print database messages/details, assertions' actual values or configuration.
  console.error('CHECKPOINT D AUDIT FAILED:', /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'AUDIT_CONNECTION_OR_QUERY_FAILED');
  if (error.auditDiagnostic) console.error('CATALOG COUNTS/FIELDS:', JSON.stringify(error.auditDiagnostic));
  process.exitCode = 1;
} finally { if (client) await client.end().catch(() => {}); }
