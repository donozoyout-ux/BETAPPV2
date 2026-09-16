import { mean, rateOver, stddev, variance } from './statistics.js';
import type { HistoricalCornerMatch, LeagueCornerBaseline, ProfileWindow, TeamCornerProfile, Venue } from './types.js';

const profileLines = [7.5, 8.5, 9.5, 10.5, 11.5, 12.5] as const;
const windowSizes: Record<ProfileWindow, number | null> = { LAST_5: 5, LAST_10: 10, LAST_20: 20, SEASON: null };

function completedCorners(match: HistoricalCornerMatch) {
  return match.homeCorners != null && match.awayCorners != null;
}

export function buildTeamProfile(
  matches: HistoricalCornerMatch[], teamId: string, competitionId: string, season: string,
  windowType: ProfileWindow, venue: Venue, asOf = new Date(8640000000000000),
): TeamCornerProfile {
  const eligible = matches
    .filter((match) => match.competitionId === competitionId && (windowType === 'SEASON' ? match.season === season : true) && match.kickoffAt < asOf)
    .filter((match) => venue === 'HOME' ? match.homeTeamId === teamId : match.awayTeamId === teamId)
    .filter(completedCorners)
    .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime());
  const selected = windowSizes[windowType] == null ? eligible : eligible.slice(0, windowSizes[windowType]!);
  const cornersFor = selected.map((match) => venue === 'HOME' ? match.homeCorners! : match.awayCorners!);
  const cornersAgainst = selected.map((match) => venue === 'HOME' ? match.awayCorners! : match.homeCorners!);
  const totals = selected.map((match) => match.homeCorners! + match.awayCorners!);
  const firstHalfFor = selected.flatMap((match) => {
    const value = venue === 'HOME' ? match.firstHalfHomeCorners : match.firstHalfAwayCorners;
    return value == null ? [] : [value];
  });
  const firstHalfAgainst = selected.flatMap((match) => {
    const value = venue === 'HOME' ? match.firstHalfAwayCorners : match.firstHalfHomeCorners;
    return value == null ? [] : [value];
  });
  return {
    teamId, competitionId, season, windowType, venue, sampleSize: selected.length,
    cornersForAvg: mean(cornersFor), cornersAgainstAvg: mean(cornersAgainst), totalMatchCornersAvg: mean(totals),
    cornersForStddev: stddev(cornersFor), cornersAgainstStddev: stddev(cornersAgainst),
    overRates: Object.fromEntries(profileLines.map((line) => [String(line), rateOver(totals, line)])),
    firstHalfCornersForAvg: mean(firstHalfFor), firstHalfCornersAgainstAvg: mean(firstHalfAgainst),
  };
}

export function buildAllTeamProfiles(matches: HistoricalCornerMatch[], asOf?: Date): TeamCornerProfile[] {
  const groups = new Map<string, { teamId: string; competitionId: string; season: string }>();
  for (const match of matches) {
    groups.set(`${match.homeTeamId}:${match.competitionId}:${match.season}`, { teamId: match.homeTeamId, competitionId: match.competitionId, season: match.season });
    groups.set(`${match.awayTeamId}:${match.competitionId}:${match.season}`, { teamId: match.awayTeamId, competitionId: match.competitionId, season: match.season });
  }
  return [...groups.values()].flatMap((group) =>
    (['HOME', 'AWAY'] as const).flatMap((venue) =>
      (Object.keys(windowSizes) as ProfileWindow[]).map((window) => buildTeamProfile(matches, group.teamId, group.competitionId, group.season, window, venue, asOf))));
}

export function buildLeagueBaseline(
  matches: HistoricalCornerMatch[], competitionId: string, season: string,
  asOf = new Date(8640000000000000),
): LeagueCornerBaseline {
  const eligible = matches.filter((match) => match.competitionId === competitionId && match.season === season &&
    match.kickoffAt < asOf && completedCorners(match));
  const home = eligible.map((match) => match.homeCorners!);
  const away = eligible.map((match) => match.awayCorners!);
  const totals = eligible.map((match) => match.homeCorners! + match.awayCorners!);
  return {
    competitionId, season, avgHomeCorners: mean(home) ?? 0, avgAwayCorners: mean(away) ?? 0,
    avgTotalCorners: mean(totals) ?? 0, stddevTotalCorners: stddev(totals) ?? 0,
    varianceTotalCorners: variance(totals) ?? 0,
    overRates: Object.fromEntries(profileLines.map((line) => [String(line), rateOver(totals, line)])),
    sampleSize: eligible.length,
  };
}

export function buildAllLeagueBaselines(matches: HistoricalCornerMatch[], asOf?: Date) {
  const groups = new Set(matches.map((match) => `${match.competitionId}\u0000${match.season}`));
  return [...groups].map((key) => {
    const [competitionId, season] = key.split('\u0000') as [string, string];
    return buildLeagueBaseline(matches, competitionId, season, asOf);
  });
}
