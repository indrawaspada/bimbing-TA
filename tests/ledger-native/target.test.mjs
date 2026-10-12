import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNativeLedgerTarget, initializeNativeLedgerDb } from '../../scripts/lib/native-ledger-test.mjs';

test('native harness refuses hosted/non-dedicated database and never echoes connection values', () => {
  const valid = 'postgresql://postgres:ci-only-password@127.0.0.1:5432/bimbingta_ledger_test';
  assert.doesNotThrow(() => validateNativeLedgerTarget(valid));
  for (const value of [undefined, 'secret', valid.replace('127.0.0.1', 'db.tghcovjdsxirhpexpqor.supabase.co'),
    valid.replace('bimbingta_ledger_test', 'postgres'), valid + '?options=unsafe', valid.replace('postgres:', 'postgres.other:')])
    assert.throws(() => validateNativeLedgerTarget(value), (e) => e.message === 'NATIVE_LOCAL_TEST_DB_REQUIRED');
});

test('initializer refuses nonempty/wrong-version targets before any mutation', async () => {
  for (const info of [
    { db: 'postgres', username: 'postgres', public_tables: 0, app_schema: false, version: 170011 },
    { db: 'bimbingta_ledger_test', username: 'postgres', public_tables: 1, app_schema: false, version: 170011 },
    { db: 'bimbingta_ledger_test', username: 'postgres', public_tables: 0, app_schema: true, version: 170011 },
    { db: 'bimbingta_ledger_test', username: 'postgres', public_tables: 0, app_schema: false, version: 180000 },
  ]) {
    let calls = 0;
    await assert.rejects(initializeNativeLedgerDb({ query: async (sql) => {
      calls++; assert.match(sql, /^select /); return { rows: [info] };
    } }), /NATIVE_EMPTY_POSTGRES_17_REQUIRED/);
    assert.equal(calls, 1);
  }
});
