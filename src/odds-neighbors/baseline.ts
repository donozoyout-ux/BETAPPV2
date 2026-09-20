import { buildResultMap } from './result-map.js';
import type { EvidenceGap, MatchOutcomeData, WilsonInterval } from './types.js';

export function wilsonInterval(positiveCount: number, sampleSize: number): WilsonInterval {
  if (sampleSize <= 0) return { lower: null, upper: null };
  const z = 1.96; const p = positiveCount / sampleSize; const denominator = 1 + z ** 2 / sampleSize;
  const center = (p + z ** 2 / (2 * sampleSize)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * sampleSize)) / sampleSize) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

export function evidenceGaps(neighbors: MatchOutcomeData[], candidates: MatchOutcomeData[], competitionId: string, minimumBaselineSample: number): EvidenceGap[] {
  const nearby = buildResultMap(neighbors); const local = candidates.filter((item) => item.competitionId === competitionId); const localMap = new Map(buildResultMap(local).map((row) => [`${row.market}|${row.selection}|${row.line}`, row]));
  const globalMap = new Map(buildResultMap(candidates).map((row) => [`${row.market}|${row.selection}|${row.line}`, row]));
  return nearby.map((row) => {
    const key = `${row.market}|${row.selection}|${row.line}`; const localRow = localMap.get(key); const fallback = localRow && localRow.sampleSize >= minimumBaselineSample ? localRow : globalMap.get(key);
    const scope = !fallback ? 'UNAVAILABLE' : fallback === localRow ? 'SAME_COMPETITION' : 'GLOBAL_SUPPORTED_COMPETITIONS';
    return { ...row, baselineRate: fallback?.positiveRate ?? null, baselineSampleSize: fallback?.sampleSize ?? 0, baselineScope: scope,
      gapPp: row.positiveRate == null || fallback?.positiveRate == null ? null : (row.positiveRate - fallback.positiveRate) * 100,
      wilson: wilsonInterval(row.positiveCount, row.sampleSize) };
  });
}
