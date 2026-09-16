import type { CornerModelConfig } from './config.js';
import { chooseDistribution, overProbability } from './distributions.js';
import { buildTeamProfile } from './profiles.js';
import { calculateDataQuality, calculateModelConfidence } from './quality.js';
import { mean, shrink } from './statistics.js';
import type { CornerAnalysis, HistoricalCornerMatch, LeagueCornerBaseline, ProfileWindow, TeamCornerProfile, Venue } from './types.js';

const probabilityLines = [6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5] as const;

export type CornerAnalysisInput = {
  match: { competitionId: string; season: string; kickoffAt: Date; homeTeamId: string; awayTeamId: string };
  history: HistoricalCornerMatch[];
  baseline: LeagueCornerBaseline;
  consensusConfidence?: number;
};

function profile(profiles: TeamCornerProfile[], teamId: string, venue: Venue, windowType: TeamCornerProfile['windowType']) {
  return profiles.find((item) => item.teamId === teamId && item.venue === venue && item.windowType === windowType)!;
}

type ProfileSet = Record<ProfileWindow, TeamCornerProfile>;

function weightedSide(
  own: ProfileSet, opponent: ProfileSet, prior: number,
  config: CornerModelConfig,
) {
  const values: Array<[number, number]> = [
    [shrink(own.SEASON.cornersForAvg, own.SEASON.sampleSize, prior, config.shrinkageSample), config.weights.teamVenueFor],
    [shrink(opponent.SEASON.cornersAgainstAvg, opponent.SEASON.sampleSize, prior, config.shrinkageSample), config.weights.opponentVenueAgainst],
    [shrink(own.LAST_5.cornersForAvg, own.LAST_5.sampleSize, prior, config.shrinkageSample), config.weights.teamLast5For],
    [shrink(opponent.LAST_5.cornersAgainstAvg, opponent.LAST_5.sampleSize, prior, config.shrinkageSample), config.weights.opponentLast5Against],
    [shrink(own.LAST_10.cornersForAvg, own.LAST_10.sampleSize, prior, config.shrinkageSample), config.weights.teamLast10For],
    [shrink(opponent.LAST_10.cornersAgainstAvg, opponent.LAST_10.sampleSize, prior, config.shrinkageSample), config.weights.opponentLast10Against],
    [shrink(own.SEASON.cornersForAvg, own.SEASON.sampleSize, prior, config.shrinkageSample), config.weights.teamSeasonFor],
    [shrink(opponent.SEASON.cornersAgainstAvg, opponent.SEASON.sampleSize, prior, config.shrinkageSample), config.weights.opponentSeasonAgainst],
    [prior, config.weights.leagueBaseline],
  ];
  return { expected: values.reduce((sum, [value, weight]) => sum + value * weight, 0), components: values.map(([value, weight]) => ({ value, weight })) };
}

function pressure(matches: HistoricalCornerMatch[], teamId: string, asOf: Date, config: CornerModelConfig): number | null {
  const recent = matches.filter((match) => match.kickoffAt < asOf && (match.homeTeamId === teamId || match.awayTeamId === teamId))
    .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime()).slice(0, 10);
  const scores = recent.flatMap((match) => {
    const home = match.homeTeamId === teamId;
    const shots = home ? match.homeShots : match.awayShots;
    const onTarget = home ? match.homeShotsOnTarget : match.awayShotsOnTarget;
    const possession = home ? match.homePossession : match.awayPossession;
    return shots == null || onTarget == null || possession == null ? [] : [
      shots * config.pressureComponents.shots + onTarget * config.pressureComponents.shotsOnTarget +
      possession * config.pressureComponents.possession,
    ];
  });
  return mean(scores);
}

export function analyzeCorners(input: CornerAnalysisInput, config: CornerModelConfig): CornerAnalysis {
  const eligible = input.history.filter((match) => match.kickoffAt < input.match.kickoffAt);
  const windows = ['LAST_5', 'LAST_10', 'LAST_20', 'SEASON'] as const;
  const profiles = [
    ...windows.map((window) => buildTeamProfile(eligible, input.match.homeTeamId, input.match.competitionId, input.match.season, window, 'HOME', input.match.kickoffAt)),
    ...windows.map((window) => buildTeamProfile(eligible, input.match.awayTeamId, input.match.competitionId, input.match.season, window, 'AWAY', input.match.kickoffAt)),
  ];
  const home = Object.fromEntries(windows.map((window) => [window, profile(profiles, input.match.homeTeamId, 'HOME', window)])) as ProfileSet;
  const away = Object.fromEntries(windows.map((window) => [window, profile(profiles, input.match.awayTeamId, 'AWAY', window)])) as ProfileSet;
  const homeCalculation = weightedSide(home, away, input.baseline.avgHomeCorners, config);
  const awayCalculation = weightedSide(away, home, input.baseline.avgAwayCorners, config);
  let expectedHome = homeCalculation.expected;
  let expectedAway = awayCalculation.expected;
  const h2h = eligible.filter((match) => [match.homeTeamId, match.awayTeamId].includes(input.match.homeTeamId) &&
    [match.homeTeamId, match.awayTeamId].includes(input.match.awayTeamId) && match.homeCorners != null && match.awayCorners != null)
    .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime()).slice(0, 5);
  const h2hTotal = mean(h2h.map((match) => match.homeCorners! + match.awayCorners!));
  if (h2hTotal != null && config.h2hWeight > 0) {
    const current = expectedHome + expectedAway;
    const adjusted = current * (1 - config.h2hWeight) + h2hTotal * config.h2hWeight;
    expectedHome *= adjusted / current; expectedAway *= adjusted / current;
  }
  const homePressure = pressure(eligible, input.match.homeTeamId, input.match.kickoffAt, config);
  const awayPressure = pressure(eligible, input.match.awayTeamId, input.match.kickoffAt, config);
  if (config.pressureFeatureEnabled && homePressure != null && awayPressure != null) {
    expectedHome *= 1 + (homePressure - 1) * config.pressureWeight;
    expectedAway *= 1 + (awayPressure - 1) * config.pressureWeight;
  }
  const expectedTotal = expectedHome + expectedAway;
  const distribution = chooseDistribution(config, input.baseline);
  const variance = distribution === 'NEGATIVE_BINOMIAL' ? Math.max(input.baseline.varianceTotalCorners, expectedTotal + 0.01) : expectedTotal;
  const probabilities = Object.fromEntries(probabilityLines.map((line) => {
    const over = overProbability(line, expectedTotal, distribution, variance);
    return [String(line), { over, under: 1 - over }];
  }));
  const cornerRows = eligible.filter((match) => match.homeCorners != null && match.awayCorners != null);
  const relevantRows = eligible.filter((match) => match.homeTeamId === input.match.homeTeamId || match.awayTeamId === input.match.homeTeamId ||
    match.homeTeamId === input.match.awayTeamId || match.awayTeamId === input.match.awayTeamId);
  const missingFields = [] as string[];
  if (!home.SEASON.sampleSize) missingFields.push('home_history');
  if (!away.SEASON.sampleSize) missingFields.push('away_history');
  if (!input.baseline.sampleSize) missingFields.push('league_baseline');
  const dataQuality = calculateDataQuality({ homeSample: home.SEASON.sampleSize, awaySample: away.SEASON.sampleSize,
    leagueSample: input.baseline.sampleSize, recentHome: home.LAST_5.sampleSize, recentAway: away.LAST_5.sampleSize,
    cornerCompleteness: relevantRows.length ? cornerRows.filter((row) => relevantRows.includes(row)).length / relevantRows.length : 0,
    consensusConfidence: input.consensusConfidence ?? 0.5, missingFields }, config.minimumEligibleQuality);
  const confidence = calculateModelConfidence({ homeSample: home.SEASON.sampleSize, awaySample: away.SEASON.sampleSize,
    variance: input.baseline.varianceTotalCorners, mean: input.baseline.avgTotalCorners,
    venueAgreement: Math.abs((home.SEASON.cornersForAvg ?? input.baseline.avgHomeCorners) - (away.SEASON.cornersAgainstAvg ?? input.baseline.avgHomeCorners)),
    recentConsistency: Math.abs((home.LAST_5.cornersForAvg ?? input.baseline.avgHomeCorners) - (home.LAST_10.cornersForAvg ?? input.baseline.avgHomeCorners)) +
      Math.abs((away.LAST_5.cornersForAvg ?? input.baseline.avgAwayCorners) - (away.LAST_10.cornersForAvg ?? input.baseline.avgAwayCorners)),
    teamLeagueDeviation: Math.abs(expectedTotal - input.baseline.avgTotalCorners), distributionSample: input.baseline.sampleSize });
  return {
    expectedHomeCorners: expectedHome, expectedAwayCorners: expectedAway, expectedTotalCorners: expectedTotal,
    probabilities, distribution, dataQuality, modelConfidence: confidence,
    sample: { home: home.SEASON.sampleSize, away: away.SEASON.sampleSize, league: input.baseline.sampleSize, h2h: h2h.length },
    calculationDetails: { homeCalculation, awayCalculation, h2hTotal, homePressure, awayPressure, profiles, baseline: input.baseline },
  };
}
