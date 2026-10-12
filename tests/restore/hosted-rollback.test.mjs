import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRehearsalDb, captureRehearsalState, rehearseBackupInTransaction, inspectBackup, planRestore } from '../../scripts/lib/backup-restore.mjs';
import { makeBackupFixture, packBackup } from './fixtures.mjs';

let fixture, db, owner, originalProject, baseline;
before(async () => {
  fixture = await makeBackupFixture();
  db = await createRehearsalDb();
  owner = randomUUID();
  await db.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,'existing-owner@example.test',now(),'{\"provider\":\"google\"}')", [owner]);
  await db.query("insert into memberships(auth_user_id,verified_email,role) values($1,'existing-owner@example.test','owner')", [owner]);
  originalProject = (await db.query("insert into projects(owner_uid,title) values($1,'Existing project must remain identical') returning id", [owner])).rows[0].id;
  await db.query("insert into private_notes(project_id,owner_uid,body) values($1,$2,'Existing private note must remain identical')", [originalProject, owner]);
  await db.query("insert into budget_settings(month,ai_enabled) values('2026-10',false)");
  baseline = await captureRehearsalState(db);
});
after(async () => { if (db) await db.close(); });

test('native-compatible SQL restore reuses existing owner, relinks proof/replies and preserves all preexisting rows after rollback', async () => {
  const queries = [];
  const tracked = { query(sql, params) {
    assert.doesNotMatch(sql.trim(), /^(commit|end|create|alter|drop|truncate)\b/i);
    queries.push(sql);
    return db.query(sql, params);
  } };
  const report = await rehearseBackupInTransaction(tracked, fixture.zip, { existingOwnerUid: owner,
    inspectRestored: async (c, plan) => {
      assert.equal(plan.project.owner_uid, owner);
      assert.notEqual(plan.project.id, fixture.metadata.project.id);
      assert.notEqual(plan.project.student_uid, fixture.metadata.project.student_uid);
      assert.equal((await c.query("select count(*)::int n from memberships where role='owner'")).rows[0].n, 1);
      const finding = (await c.query('select * from findings where project_id=$1', [plan.project.id])).rows[0];
      assert.equal(finding.approved_by, owner);
      assert.equal(finding.closed_by, owner);
      assert.equal(finding.revision_proof.version_id, plan.rows.versions[1].id);
      assert.equal(finding.revision_proof.submitted_by, plan.project.student_uid);
      const comments = (await c.query('select id,parent_id from comments where project_id=$1', [plan.project.id])).rows;
      const reply = comments.find((r) => r.parent_id);
      assert.ok(comments.some((r) => r.id === reply.parent_id));
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [plan.project.student_uid, JSON.stringify({ sub: plan.project.student_uid, role: 'authenticated' })]);
      assert.equal((await c.query('select count(*)::int n from projects where id=$1', [plan.project.id])).rows[0].n, 1);
      assert.equal((await c.query('select count(*)::int n from projects where id=$1', [originalProject])).rows[0].n, 0);
      assert.equal((await c.query('select count(*)::int n from private_notes')).rows[0].n, 0);
      assert.equal((await c.query('select count(*)::int n from versions where project_id=$1', [plan.project.id])).rows[0].n, 2);
      await c.query('reset role');
    } });
  assert.equal(report.pdf_files, 2);
  assert.equal(report.counts.findings, 1);
  assert.equal(report.counts.comments, 2);
  assert.equal(report.original_tables_verified, 31);
  assert.equal(report.original_data_unchanged, true);
  assert.equal(report.rollback_verified, true);
  assert.equal(report.api_storage_tested, false);
  assert.equal(report.provider_called, false);
  assert.equal(queries.filter((q) => q === 'rollback').length, 2);
  assert.deepEqual(await captureRehearsalState(db), baseline);
});

test('mid-restore failure rolls back every synthetic row and hides SQL/private details', async () => {
  await assert.rejects(rehearseBackupInTransaction(db, fixture.zip, { existingOwnerUid: owner,
    inspectRestored: () => { throw new Error('sensitive failing row: do not echo'); } }),
  (e) => e.code === 'transactional_sql_restore_validation_failed' && !e.message.includes('sensitive'));
  assert.deepEqual(await captureRehearsalState(db), baseline);
});

test('unverified/missing owner is refused without creating a second owner or retaining rows', async () => {
  await assert.rejects(rehearseBackupInTransaction(db, fixture.zip, { existingOwnerUid: randomUUID() }), { code: 'existing_verified_google_owner_required' });
  assert.deepEqual(await captureRehearsalState(db), baseline);
});

test('existing owner mapping cannot bind to source entity or student UUID', () => {
  const archive = inspectBackup(fixture.zip);
  for (const uid of [fixture.metadata.versions[0].id, fixture.metadata.project.student_uid, 'invalid'])
    assert.throws(() => planRestore(archive, { existingOwnerUid: uid }), { code: 'invalid_existing_owner_mapping' });
});

test('version gaps restore through unchanged guards and rollback on a nonempty target', async () => {
  const metadata = structuredClone(fixture.metadata);
  metadata.versions[1].sequence = 4;
  const guard = (await db.query("select pg_get_functiondef('app.versions_guard()'::regprocedure) definition")).rows[0].definition;
  const report = await rehearseBackupInTransaction(db, packBackup(metadata, fixture.pdfs), { existingOwnerUid: owner,
    inspectRestored: async (c, plan) => {
      assert.deepEqual((await c.query('select sequence from versions where project_id=$1 order by sequence', [plan.project.id])).rows.map((r) => r.sequence), [1, 4]);
      assert.equal((await c.query("select pg_get_functiondef('app.versions_guard()'::regprocedure) definition")).rows[0].definition, guard);
    } });
  assert.equal(report.temporary_sequence_markers_removed, 2);
  assert.deepEqual(await captureRehearsalState(db), baseline);
});

test('hosted rehearsal CLI refuses missing/extraneous confirmation or apply before reading credentials', () => {
  const script = fileURLToPath(new URL('../../scripts/hosted-restore-rehearsal.mjs', import.meta.url));
  for (const args of [[], ['--apply'], ['--confirm-ref=wrong', '--use-existing-owner'], ['--confirm-ref=tghcovjdsxirhpexpqor', '--use-existing-owner', '--apply']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /hosted_rehearsal_requires_dev_and_existing_owner_confirmation/);
    assert.equal(result.stdout, '');
  }
});
