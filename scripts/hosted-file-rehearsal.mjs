// Opt-in synthetic real Auth/PostgREST/Storage QA on nonempty DEV. No Google impersonation or AI activation.
import { readFile, writeFile, mkdir, unlink, access, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, loadConfig } from './lib/env.mjs';
import { DEV_REF, createPool, adminRequest, isJwt } from './hosted-ci.mjs';
import { auditReference, auditHosted } from './lib/hosted-audit.mjs';
import { captureRehearsalState, digest } from './lib/backup-restore.mjs';
import { newFileQaState, validateFileQaState, exerciseFileServices, cleanupFileServices, FileQaError } from './lib/hosted-file-qa.mjs';
import { makeBackupFixture } from '../tests/restore/fixtures.mjs';

const journalPath = join(ROOT, '.secrets/hosted-file-qa.json');
const fixturePath = join(ROOT, '.secrets/hosted-file-qa-source.zip');
const exists = async (path) => access(path).then(() => true, () => false);
let pool, client;
const args = process.argv.slice(2), mode = args[0];
try {
  if (args.length !== 3 || !['prepare','run','cleanup'].includes(mode) || !args.includes(`--confirm-ref=${DEV_REF}`) || !args.includes('--use-existing-owner'))
    throw new FileQaError('file_qa_requires_mode_dev_and_existing_owner_confirmation');
  if (mode === 'cleanup' && !await exists(journalPath)) { console.log('FILE QA CLEANUP: no journal; no writes.'); }
  else {
    const cfg = loadConfig({ needAdmin: true });
    pool = createPool(cfg); client = await pool.connect();
    const admin = (method, path, body) => adminRequest(cfg, method, path, body);
    const http = async (token, method, path, { body, raw = false, binary = false, headers = {} } = {}) => {
      if (!/^\/(rest|auth|storage|functions)\/v1\//.test(path)) throw new FileQaError('file_qa_unexpected_api_path');
      const h = { apikey: cfg.anonKey, ...headers };
      if (token) h.Authorization = `Bearer ${token}`; else if (isJwt(cfg.anonKey)) h.Authorization = `Bearer ${cfg.anonKey}`;
      if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
      if (path.startsWith('/rest/')) h.Prefer = 'return=representation';
      const response = await fetch(cfg.url + path, { method, headers: h, redirect: 'error', signal: AbortSignal.timeout(20000),
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
      if (binary) return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
      return { status: response.status, json: await response.json().catch(() => null) };
    };
    const reference = await auditReference();
    let result;
    if (mode === 'prepare') {
      if (await exists(journalPath) || await exists(fixturePath)) throw new FileQaError('file_qa_previous_journal_requires_cleanup');
      const preflight = await auditHosted(client, reference);
      if (preflight.counts.owners !== 1) throw new FileQaError('file_qa_requires_one_existing_owner');
      const settings = await http(null, 'GET', '/auth/v1/settings');
      if (settings.status !== 200 || !settings.json?.external?.email || !settings.json?.external?.google)
        throw new FileQaError('file_qa_existing_auth_providers_required_no_settings_changed');
      const source = await makeBackupFixture();
      await client.query('begin read only');
      let state;
      try {
        state = newFileQaState(await captureRehearsalState(client), process.env.GITHUB_SHA || null, digest(source.zip));
        validateFileQaState(state);
        const collisions = (await client.query(`select
          (select count(*)::int from projects where id=any($1::uuid[])) projects,
          (select count(*)::int from auth.users where lower(email)=any($2::text[])) users,
          (select count(*)::int from storage.objects where split_part(name,'/',1)=any($3::text[])) objects`,
          [state.project_ids, Object.values(state.emails), state.project_ids])).rows[0];
        if (Object.values(collisions).some((n) => n !== 0)) throw new FileQaError('file_qa_planned_scope_already_exists');
      } finally { await client.query('rollback'); }
      await mkdir(join(ROOT, '.secrets'), { recursive: true });
      await writeFile(fixturePath, source.zip, { flag: 'wx', mode: 0o600 });
      await writeFile(journalPath, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
      result = { mode: 'prepared_no_hosted_writes', journal_ready: true, original_tables_hashed: 31, fixture_hash_verified: true,
        recovery_contains_secrets: false, google_oauth_tested: false, ai_enabled: false };
    } else {
      const state = JSON.parse(await readFile(journalPath, 'utf8'));
      validateFileQaState(state);
      if (mode === 'run') {
        await auditHosted(client, reference);
        const bytes = await readFile(fixturePath);
        let failure;
        try { result = await exerciseFileServices(client, state, bytes, { url: cfg.url, admin, http,
          signedDownload: async (url) => {
            const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
            return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
          } }); }
        catch (error) { failure = error; }
        // Cleanup is mandatory even on failed assertion/network operation.
        const cleanup = await cleanupFileServices(client, state, admin);
        await auditHosted(client, reference);
        if (failure) throw failure;
        result = { mode: 'hosted_synthetic_file_service_rehearsal', passed: true, source_sha: process.env.GITHUB_SHA,
          project_ref: DEV_REF, ...result, ...cleanup };
      } else {
        result = { mode: 'file_qa_recovery', ...await cleanupFileServices(client, state, admin) };
        await auditHosted(client, reference);
      }
      // Preserve journal/source on any failure for exact-scope recovery.
      await unlink(journalPath);
      await unlink(fixturePath).catch(() => {});
    }
    console.log(mode === 'run' ? 'HOSTED FILE SERVICE REHEARSAL PASS' : 'HOSTED FILE QA ' + mode.toUpperCase());
    console.log(JSON.stringify(result, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## Current-data synthetic file QA: ${mode}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n\nPassword-JWT/student memberships are synthetic fixtures; no real Google OAuth or browser extraction. No AI/provider/production restore.\n`);
  }
} catch (error) {
  // No messages/details/actual SQL rows: they may contain credentials, emails or signed URLs.
  console.error('HOSTED FILE QA FAILED:', /^[a-z0-9_]+$/i.test(error.code || '') ? error.code : 'file_qa_connection_or_operation_failed');
  process.exitCode = 1;
} finally { if (client) client.release(); if (pool) await pool.end(); }
