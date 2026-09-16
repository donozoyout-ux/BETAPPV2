import { chooseDistribution } from '../corners/distributions.js';
import { cornerModelConfig } from '../corners/config.js';
import { buildAllLeagueBaselines } from '../corners/profiles.js';
import { mean, stddev, variance } from '../corners/statistics.js';
import type { HistoricalCornerMatch } from '../corners/types.js';

function percentage(part: number, total: number) {
  return total ? part / total : 0;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function coverage(matches: HistoricalCornerMatch[], predicate: (match: HistoricalCornerMatch) => boolean) {
  const count = matches.filter(predicate).length;
  return { count, rate: percentage(count, matches.length) };
}

export type IntegrityCounts = { duplicateMatches: number; duplicateTeamStats: number; duplicateProviderMappings: number };

export function auditDataset(matches: HistoricalCornerMatch[], integrity: IntegrityCounts = {
  duplicateMatches: 0, duplicateTeamStats: 0, duplicateProviderMappings: 0,
}) {
  const complete = matches.filter((match) => match.homeCorners != null && match.awayCorners != null);
  const totals = complete.map((match) => match.homeCorners! + match.awayCorners!);
  const group = (key: (match: HistoricalCornerMatch) => string) => Object.entries(matches.reduce<Record<string, number>>((result, match) => {
    const value = key(match); result[value] = (result[value] ?? 0) + 1; return result;
  }, {})).map(([name, count]) => ({ name, count }));
  const teamSamples = new Map<string, { total: number; home: number; away: number }>();
  for (const match of complete) {
    const home = teamSamples.get(match.homeTeamId) ?? { total: 0, home: 0, away: 0 };
    home.total += 1; home.home += 1; teamSamples.set(match.homeTeamId, home);
    const away = teamSamples.get(match.awayTeamId) ?? { total: 0, home: 0, away: 0 };
    away.total += 1; away.away += 1; teamSamples.set(match.awayTeamId, away);
  }
  const sampleValues = [...teamSamples.values()];
  const threshold = (minimum: number) => {
    const count = sampleValues.filter((item) => item.total >= minimum).length;
    return { count, rate: percentage(count, sampleValues.length) };
  };
  const baselines = buildAllLeagueBaselines(matches).map((baseline) => {
    const distribution = chooseDistribution(cornerModelConfig, baseline);
    const dispersionRatio = baseline.avgTotalCorners > 0 ? baseline.varianceTotalCorners / baseline.avgTotalCorners : 0;
    return { ...baseline, competitionName: matches.find((item) => item.competitionId === baseline.competitionId)?.competitionName,
      dispersionRatio, selectedDistribution: distribution,
      selectionReason: baseline.sampleSize < cornerModelConfig.minimumDistributionSample
        ? `sample<${cornerModelConfig.minimumDistributionSample}`
        : dispersionRatio > cornerModelConfig.overdispersionRatio ? 'variance/mean above configured threshold' : 'variance/mean within Poisson threshold' };
  });
  return {
    generatedAt: new Date().toISOString(), totalMatches: matches.length,
    perCompetition: group((match) => match.competitionName ?? match.competitionId),
    perSeason: group((match) => match.season),
    cornerCoverage: {
      home: coverage(matches, (match) => match.homeCorners != null),
      away: coverage(matches, (match) => match.awayCorners != null),
      complete: { count: complete.length, rate: percentage(complete.length, matches.length) },
      missing: { count: matches.length - complete.length, rate: percentage(matches.length - complete.length, matches.length) },
    },
    fieldCoverage: {
      xg: coverage(matches, (match) => match.homeXg != null && match.awayXg != null),
      shots: coverage(matches, (match) => match.homeShots != null && match.awayShots != null),
      shotsOnTarget: coverage(matches, (match) => match.homeShotsOnTarget != null && match.awayShotsOnTarget != null),
      cards: coverage(matches, (match) => match.homeYellowCards != null && match.awayYellowCards != null),
      possession: coverage(matches, (match) => match.homePossession != null && match.awayPossession != null),
    },
    duplicates: integrity,
    invalid: {
      negativeCorners: matches.filter((match) => (match.homeCorners ?? 0) < 0 || (match.awayCorners ?? 0) < 0).length,
      impossibleScore: matches.filter((match) => (match.homeGoals ?? 0) < 0 || (match.awayGoals ?? 0) < 0).length,
      homeAwayDuplicate: matches.filter((match) => match.homeTeamId === match.awayTeamId).length,
      missingTeams: matches.filter((match) => !match.homeTeamId || !match.awayTeamId).length,
      missingCompetition: matches.filter((match) => !match.competitionId).length,
    },
    cornerDistribution: { mean: mean(totals), median: median(totals), stddev: stddev(totals), variance: variance(totals),
      min: totals.length ? Math.min(...totals) : null, max: totals.length ? Math.max(...totals) : null },
    samples: { teamsCount: teamSamples.size, availability: { last5: threshold(5), last10: threshold(10), last20: threshold(20) },
      perTeam: [...teamSamples.entries()].map(([teamId, values]) => ({ teamId, ...values })) },
    leagueBaselines: baselines,
  };
}
