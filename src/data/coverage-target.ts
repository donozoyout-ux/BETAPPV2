export const DATA_TARGET_V1 = {
  clubFinishedMatches: 300,
  internationalFinishedMatches: 80,
  statisticsCoverageRatio: 0.70,
  maxSeasonCycles: 2,
} as const;

export type CoverageTargetInput = {
  type: 'CLUB' | 'INTERNATIONAL';
  finishedMatches: number;
  matchesWithStats: number;
};

export function coverageTarget(row: CoverageTargetInput) {
  const targetFinishedMatches = row.type === 'INTERNATIONAL'
    ? DATA_TARGET_V1.internationalFinishedMatches
    : DATA_TARGET_V1.clubFinishedMatches;
  const targetMatchesWithStats = Math.ceil(targetFinishedMatches * DATA_TARGET_V1.statisticsCoverageRatio);
  const finishedGap = Math.max(0, targetFinishedMatches - Number(row.finishedMatches ?? 0));
  const statsGap = Math.max(0, targetMatchesWithStats - Number(row.matchesWithStats ?? 0));
  const finishedProgress = Math.min(1, Number(row.finishedMatches ?? 0) / targetFinishedMatches);
  const statsProgress = Math.min(1, Number(row.matchesWithStats ?? 0) / targetMatchesWithStats);
  const deficitScore = Math.round(((1 - finishedProgress) * 0.6 + (1 - statsProgress) * 0.4) * 10_000) / 100;
  return {
    version: 'DATA_TARGET_V1' as const,
    targetFinishedMatches,
    targetMatchesWithStats,
    finishedGap,
    statsGap,
    deficitScore,
    needsBackfill: finishedGap > 0 || statsGap > 0,
  };
}

export function enrichCoverageTargets<T extends CoverageTargetInput>(rows: T[]) {
  return rows.map((row) => ({ ...row, target: coverageTarget(row) }));
}
