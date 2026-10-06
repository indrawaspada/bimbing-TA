// Scoring kernel (owner kit tests, unchanged semantics) + toolkit v1.0 weight data checks.
// Run: yarn test:score   (Node 22, --experimental-strip-types loads score_reference.ts unchanged)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { calculateChapter, reviewStatus } from '../../src/lib/score/score_reference.ts';
import { weights } from '../../scripts/seed-rubric.mjs';

const d = (id, weight, status, rating) => ({ id, weight, status, rating });

test('kit scoring checks (score_reference.test.mjs)', () => {
  assert.equal(calculateChapter([d('a', 1, 'Assessed', 3)]).score, 100);
  let r = calculateChapter([d('a', 1, 'Assessed', 3), d('b', 1, 'Not assessed', null)]);
  assert.equal(r.score, 100); assert.equal(r.coverage, 50); assert.equal(r.incomplete, true);
  r = calculateChapter([d('a', 1, 'Assessed', 3), d('b', 1, 'N/A', null)]);
  assert.equal(r.coverage, 100);
  assert.equal(calculateChapter([d('a', 1, 'Not assessed', null)]).score, null);
  assert.throws(() => calculateChapter([d('a', 1, 'Assessed', 4)]));
  assert.throws(() => calculateChapter([d('a', -1, 'Assessed', 3)]));
  assert.throws(() => calculateChapter([d('a', 1, 'Assessed', 3), d('a', 1, 'Assessed', 3)]));
  assert.equal(reviewStatus([{ severity: 'Critical', status: 'Fail' }]), 'Revisi prioritas kritis');
});

test('score_reference.ts is byte-identical to the owner kit', () => {
  const h = (p) => createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex');
  assert.equal(h('../../src/lib/score/score_reference.ts'), h('../../docs/score_reference.ts'));
});

test('toolkit v1.0 weights: dimensions per chapter and chapter totals = 100', () => {
  assert.equal(weights.label, 'Bobot awal toolkit v1.0');
  const exp = { B1: [35, 30, 25, 10], B2: [25, 30, 20, 25], B3: [25, 20, 20, 25, 10], B4: [20, 30, 25, 15, 10], B5: [35, 35, 15, 15] };
  for (const [c, ws] of Object.entries(exp)) assert.deepEqual(weights.chapters[c].dimensions.map((x) => x.weight), ws, c);
  assert.deepEqual(weights.stage_chapter_weights.final, { B1: 20, B2: 20, B3: 25, B4: 25, B5: 10 });
  const p = weights.stage_chapter_weights.proposal;
  assert.deepEqual(Object.keys(p), ['B1', 'B2', 'B3']);
  assert.ok(Math.abs(p.B1 + p.B2 + p.B3 - 100) < 0.001);
  assert.ok(Math.abs(p.B3 - (25 / 65) * 100) < 0.001);
});

test('weights plug into the kernel: all full ratings -> 100; N/A excluded', () => {
  for (const c of Object.keys(weights.chapters)) {
    const dims = weights.chapters[c].dimensions.map((x) => d(x.id, x.weight, 'Assessed', 3));
    assert.equal(calculateChapter(dims).score, 100, c);
  }
  const b3 = weights.chapters.B3.dimensions.map((x) => d(x.id, x.weight, x.id === 'ilustrasi' ? 'Not assessed' : 'Assessed', x.id === 'ilustrasi' ? null : 2));
  const r = calculateChapter(b3);
  assert.ok(Math.abs(r.score - 66.6667) < 0.01); assert.equal(r.coverage, 90); assert.equal(r.incomplete, false);
});
