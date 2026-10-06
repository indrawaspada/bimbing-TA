// Entry point: runs the hosted suite only when frontend + admin config exist; otherwise reports PENDING (no connection attempts).
import { test } from 'node:test';
import { loadConfig } from '../../scripts/lib/env.mjs';
let ready = true;
try { loadConfig({ needAdmin: true }); } catch (e) {
  if (e.code !== 'CONFIG_MISSING') throw e;
  ready = false;
  test('HOSTED SUITE PENDING — no hosted credentials configured', { skip: e.message }, () => {});
}
if (ready) await import('./suite.mjs');
