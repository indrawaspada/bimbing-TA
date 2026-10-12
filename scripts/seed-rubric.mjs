// Emits SQL that seeds rule_engine.json and master_prompt.txt VERBATIM (content + sha256 of original bytes).
// Usage: node scripts/seed-rubric.mjs > seed.sql   (run with psql as postgres / Supabase SQL editor)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rubricBytes = readFileSync(join(root, 'data/rule_engine.json'));
const promptBytes = readFileSync(join(root, 'data/master_prompt.txt'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const rubric = JSON.parse(rubricBytes.toString('utf8'));
if (!Array.isArray(rubric.rules) || rubric.rules.length !== 92) throw new Error('expected 92 rules');
const tag = (s) => { let t = 'bt'; while (s.includes(`$${t}$`)) t += 'x'; return `$${t}$`; };
const q = (s) => { const t = tag(s); return `${t}${s}${t}`; };
// Bobot awal toolkit v1.0 (owner-adjustable later; snapshot content_json stays immutable).
const D = (id, label, weight) => ({ id, label, weight });
const chapters = {
  B1: { weight: 20, dimensions: [D('argumentasi', 'Argumentasi', 35), D('bukti_sitasi', 'Bukti/sitasi', 30), D('konsistensi_tujuan', 'Konsistensi tujuan', 25), D('ruang_lingkup', 'Ruang lingkup', 10)] },
  B2: { weight: 20, dimensions: [D('cakupan_konsep', 'Cakupan konsep', 25), D('kedalaman_teori', 'Kedalaman teori/representasi', 30), D('mutu_sumber', 'Mutu sumber', 20), D('sintesis_terkait', 'Sintesis terkait', 25)] },
  B3: { weight: 25, dimensions: [D('desain_traceability', 'Desain/traceability', 25), D('data_subjek', 'Data/subjek', 20), D('operasional_replikasi', 'Operasional/replikasi', 20), D('evaluasi', 'Evaluasi', 25), D('ilustrasi', 'Ilustrasi', 10)] },
  B4: { weight: 25, dimensions: [D('kelengkapan_traceability', 'Kelengkapan/traceability', 20), D('validitas_evaluasi', 'Validitas evaluasi', 30), D('interpretasi', 'Interpretasi', 25), D('keterbatasan', 'Keterbatasan', 15), D('pelaporan', 'Pelaporan', 10)] },
  B5: { weight: 10, dimensions: [D('jawaban_tujuan', 'Jawaban tujuan', 35), D('kesesuaian_bukti', 'Kesesuaian bukti', 35), D('batas_klaim', 'Batas klaim', 15), D('saran', 'Saran', 15)] },
};
const proposalChapters = ['B1', 'B2', 'B3'];
const proposalSum = proposalChapters.reduce((a, c) => a + chapters[c].weight, 0);
export const weights = {
  label: 'Bobot awal toolkit v1.0',
  source: 'toolkit-1.0',
  adjustable_by: 'owner',
  unit: 'percent',
  chapters,
  stage_chapter_weights: {
    final: Object.fromEntries(Object.entries(chapters).map(([k, v]) => [k, v.weight])),
    // proposal: B1-B3 normalized to 100%, B4-B5 = N/A
    proposal: Object.fromEntries(proposalChapters.map((c) => [c, Math.round((chapters[c].weight / proposalSum) * 1e6) / 1e4])),
  },
  proposal_normalization: 'B1-B3 weight / sum(B1-B3); B4-B5 excluded (N/A)',
};
for (const [c, v] of Object.entries(chapters)) {
  const sum = v.dimensions.reduce((a, d) => a + d.weight, 0);
  if (sum !== 100) throw new Error(`${c} dimension weights sum ${sum} != 100`);
}
if (Object.values(chapters).reduce((a, v) => a + v.weight, 0) !== 100) throw new Error('chapter weights != 100');

const rubricText = rubricBytes.toString('utf8');
const promptText = promptBytes.toString('utf8');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.stdout.write(`
insert into public.rubric_versions (version, content_json, source_sha256, rule_count, dimension_weights, weights_provisional, is_active)
values ('rule_engine-v${rubric.version}', ${q(rubricText)}::jsonb, '${sha(rubricBytes)}', ${rubric.rules.length}, ${q(JSON.stringify(weights))}::jsonb, false, true)
on conflict (version) do update set dimension_weights = excluded.dimension_weights, weights_provisional = false
  where public.rubric_versions.weights_provisional;  -- only replaces the old placeholder, never owner-adjusted weights
insert into public.prompt_versions (version, content, source_sha256, is_active)
values ('master_prompt-v1', ${q(promptText)}, '${sha(promptBytes)}', true)
on conflict (version) do nothing;
`);
