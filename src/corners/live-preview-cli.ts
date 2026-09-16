import { loadConfig } from '../config.js';
import type { MatchStatistics, NormalizedMatch } from '../domain/types.js';
import { createLogger } from '../logger.js';
import { FotMobProvider } from '../providers/fotmob.js';
import { cornerModelConfig } from './config.js';
import { analyzeCorners } from './engine.js';
import { buildLeagueBaseline } from './profiles.js';
import type { HistoricalCornerMatch } from './types.js';

function arg(name: string, fallback: string) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
}

function numeric(value: string | number | null | undefined) {
  if (value == null) return null;
  const result = Number(String(value).replace('%', '').replace(',', '.').match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(result) ? result : null;
}

function pair(stats: MatchStatistics, keys: string[]) {
  const item = stats.statistics.find((entry) => entry.period === 'ALL' && keys.includes(entry.key));
  return [numeric(item?.homeValue), numeric(item?.awayValue)] as const;
}

function historyRow(match: NormalizedMatch, stats: MatchStatistics): HistoricalCornerMatch {
  const corners = pair(stats, ['corners', 'corner_kicks']);
  const xg = pair(stats, ['expected_goals_xg', 'expected_goals']);
  const shots = pair(stats, ['total_shots']);
  const target = pair(stats, ['shots_on_target']);
  const possession = pair(stats, ['ball_possession']);
  const fouls = pair(stats, ['fouls_committed', 'fouls']);
  const yellow = pair(stats, ['yellow_cards']);
  const red = pair(stats, ['red_cards']);
  return {
    matchId: match.providerExternalId, competitionId: match.league.providerExternalId, season: match.season ?? 'unknown',
    kickoffAt: match.kickoffAt, homeTeamId: match.homeTeam.providerExternalId, awayTeamId: match.awayTeam.providerExternalId,
    homeGoals: match.homeScore, awayGoals: match.awayScore, homeCorners: corners[0], awayCorners: corners[1],
    firstHalfHomeCorners: null, firstHalfAwayCorners: null, homeXg: xg[0], awayXg: xg[1],
    homeShots: shots[0], awayShots: shots[1], homeShotsOnTarget: target[0], awayShotsOnTarget: target[1],
    homePossession: possession[0], awayPossession: possession[1], homeFouls: fouls[0], awayFouls: fouls[1],
    homeYellowCards: yellow[0], awayYellowCards: yellow[1], homeRedCards: red[0], awayRedCards: red[1],
    provider: 'fotmob', sourceTimestamp: stats.sourceUpdatedAt,
  };
}

const date = arg('date', new Date().toISOString().slice(0, 10));
const limit = Number(arg('limit', '3'));
const config = loadConfig();
const logger = createLogger({ ...config, LOG_LEVEL: 'silent' });
const provider = new FotMobProvider(config, logger);
const targetDate = new Date(`${date}T12:00:00Z`);
const upcoming = (await provider.getFixtures({ date: targetDate })).filter((match) => match.status === 'scheduled').slice(0, limit);

for (const target of upcoming) {
  const leagueId = Number(target.league.providerExternalId);
  const seasons = (await provider.getAvailableSeasons(leagueId)).slice(0, 2);
  const manifests = (await Promise.all(seasons.map((season) => provider.getHistoricalFixtures(leagueId, season)))).flat()
    .filter((match) => match.kickoffAt < target.kickoffAt).sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime());
  const selected = new Map<string, NormalizedMatch>();
  for (const match of manifests.slice(0, 60)) selected.set(match.providerExternalId, match);
  for (const match of manifests.filter((item) => item.homeTeam.providerExternalId === target.homeTeam.providerExternalId).slice(0, 20)) selected.set(match.providerExternalId, match);
  for (const match of manifests.filter((item) => item.awayTeam.providerExternalId === target.awayTeam.providerExternalId).slice(0, 20)) selected.set(match.providerExternalId, match);
  const history: HistoricalCornerMatch[] = [];
  for (const match of selected.values()) {
    try { history.push(historyRow(match, await provider.getMatchStatistics(match.providerExternalId))); }
    catch { history.push(historyRow(match, { matchProviderExternalId: match.providerExternalId, statistics: [], sourceUpdatedAt: new Date(), raw: {} })); }
  }
  const baseline = buildLeagueBaseline(history, target.league.providerExternalId, target.season ?? seasons[0] ?? 'unknown', target.kickoffAt);
  const analysis = analyzeCorners({ match: { competitionId: target.league.providerExternalId, season: target.season ?? seasons[0] ?? 'unknown',
    kickoffAt: target.kickoffAt, homeTeamId: target.homeTeam.providerExternalId, awayTeamId: target.awayTeam.providerExternalId }, history, baseline }, cornerModelConfig);
  console.log(JSON.stringify({ match: `${target.homeTeam.name} - ${target.awayTeam.name}`, kickoff: target.kickoffAt,
    expectedHomeCorners: analysis.expectedHomeCorners, expectedAwayCorners: analysis.expectedAwayCorners,
    expectedTotalCorners: analysis.expectedTotalCorners, probabilities: analysis.probabilities,
    dataQuality: analysis.dataQuality, modelConfidence: analysis.modelConfidence, distribution: analysis.distribution,
    sample: analysis.sample, fetchedHistoricalMatches: history.length }, null, 2));
}
