/** Deterministic scoring kernel. AI ratings must be accepted by supervisor first. */
export type RatingStatus = 'Assessed' | 'Not assessed' | 'N/A';
export type Dimension = {
  id: string;
  weight: number;
  status: RatingStatus;
  rating: number | null;
};
export function calculateChapter(dimensions: Dimension[]) {
  if (new Set(dimensions.map(d => d.id)).size !== dimensions.length)
    throw new Error('Duplicate dimension IDs');
  let relevant = 0, assessed = 0, weighted = 0;
  for (const d of dimensions) {
    if (!Number.isFinite(d.weight) || d.weight <= 0)
      throw new Error('Weights must be positive');
    if (!['Assessed','Not assessed','N/A'].includes(d.status))
      throw new Error('Invalid status');
    if (d.status === 'Assessed') {
      if (d.rating === null || !Number.isInteger(d.rating) || d.rating < 0 || d.rating > 3)
        throw new Error('Assessed rating must be 0..3');
    } else if (d.rating !== null) throw new Error('Unassessed rating must be null');
    if (d.status === 'N/A') continue;
    relevant += d.weight;
    if (d.status === 'Assessed') {
      assessed += d.weight;
      weighted += d.weight * (d.rating as number);
    }
  }
  return {
    score: assessed ? 100 * weighted / (3 * assessed) : null,
    coverage: relevant ? 100 * assessed / relevant : null,
    assessedWeight: assessed, relevantWeight: relevant,
    incomplete: relevant > 0 && assessed / relevant < 0.8,
  };
}
export function reviewStatus(findings: {severity: string; status: string}[]) {
  const failures = findings.filter(f => f.status === 'Fail');
  if (failures.some(f => f.severity === 'Critical')) return 'Revisi prioritas kritis';
  if (failures.some(f => f.severity === 'Major')) return 'Revisi mayor';
  if (failures.some(f => f.severity === 'Minor')) return 'Revisi minor';
  if (failures.some(f => f.severity === 'Review')) return 'Perlu pertimbangan pembimbing';
  return 'Tidak ada temuan gagal pada bagian yang dinilai';
}
