import { competitionKind } from '../matching/competition.js';
import type { NormalizedMatch } from '../domain/types.js';
import type { FotMobProvider } from '../providers/fotmob.js';
export type ExpansionCompetition = { id: number; key: string; name: string };
export const expansionKeys = ['Eredivisie','BelgianProLeague','DanishSuperliga','Allsvenskan','GreekSuperLeague',
  'WorldCup','EURO','EUROQualification','UefaNationsLeagueA','UefaNationsLeagueB','UefaNationsLeagueC','UefaNationsLeagueD',
  'WorldCupQualificationUEFA','CopaAmerica','WorldCupQualificationCONMEBOL','InternationalFriendlies'];
export type ExpansionReport = {
  version: 'COMPETITION_BACKFILL_V1'; competition: string; providerId: number; availableSeasons: string[]; selectedSeasons: string[];
  fixturesFetched: number; finishedMatches: number; matchesInserted: number; matchesUpdated: number; teamsCreated: number;
  statisticsRequested: number; statisticsSucceeded: number; statisticsUnavailable: number; statisticsFailed: number;
  duplicateMatchesPrevented: number; historicalExamplesGenerated: number; oddsCoveredMatches: number; cornerStatsCoveredMatches: number;
  detailsSkipped: number; fixturesPersisted: number; startedAt: string; completedAt: string | null;
  status: 'PASS' | 'PARTIAL' | 'FAILED'; dryRun: boolean; phase: 'DISCOVERY' | 'FIXTURES' | 'DETAILS' | 'PIPELINE' | 'COMPLETE';
  failures: Array<{ season: string | null; matchId: string | null; phase: string; reason: string }>; notes: string[];
};
export function blankReport(c: ExpansionCompetition, dryRun: boolean): ExpansionReport {
  return { version: 'COMPETITION_BACKFILL_V1', competition: c.name, providerId: c.id, availableSeasons: [], selectedSeasons: [],
    fixturesFetched: 0, finishedMatches: 0, matchesInserted: 0, matchesUpdated: 0, teamsCreated: 0, statisticsRequested: 0,
    statisticsSucceeded: 0, statisticsUnavailable: 0, statisticsFailed: 0, duplicateMatchesPrevented: 0,
    historicalExamplesGenerated: 0, oddsCoveredMatches: 0, cornerStatsCoveredMatches: 0, detailsSkipped: 0, fixturesPersisted: 0,
    startedAt: new Date().toISOString(), completedAt: null, status: 'PARTIAL', dryRun, phase: 'DISCOVERY', failures: [], notes: [] };
}
export async function discoverScope(provider: Pick<FotMobProvider, 'getAvailableSeasons' | 'getSeasonFixtures'>,
  c: ExpansionCompetition, count: number, pause: () => Promise<void>, pinned?: string[], now = new Date()) {
  if (!Number.isInteger(count) || count < 1 || count > 2) throw new Error('--seasons must be 1 or 2; expansion never imports all seasons');
  const availableSeasons = [...new Set(await provider.getAvailableSeasons(c.id))];
  const selected = new Map<string, NormalizedMatch[]>();
  const cycle = (s: string) => competitionKind(c.name) === 'INTERNATIONAL' ? s.match(/(?:19|20)\d{2}/g)?.at(-1) ?? s : s;
  if (pinned?.length) {
    if (new Set(pinned.map(cycle)).size > count || pinned.some(s => !availableSeasons.includes(s))) throw new Error('Checkpoint seasons are not in the discovered provider catalog/scope');
    for (const season of pinned) { await pause(); selected.set(season, await provider.getSeasonFixtures(c.id, season)); }
  } else {
    // Keep every provider-exposed stage of a selected international cycle (e.g. EURO playoffs).
    const year = (s: string) => Number(s.match(/(?:19|20)\d{2}/)?.[0] ?? 0);
    const candidates = availableSeasons.filter(s => year(s) <= now.getUTCFullYear());
    const groups = new Map<string, string[]>();
    for (const season of candidates) groups.set(cycle(season), [...(groups.get(cycle(season)) ?? []), season]);
    const ordered = [...groups.values()].sort((a,b) => Number(cycle(b[0]!).match(/(?:19|20)\d{2}/g)?.at(-1) ?? year(b[0]!))
      - Number(cycle(a[0]!).match(/(?:19|20)\d{2}/g)?.at(-1) ?? year(a[0]!)));
    let cycles = 0;
    for (const seasons of ordered.slice(0, 5)) {
      if (seasons.length > 4) throw new Error('Provider cycle has more than four stage labels; manual scope review required');
      const group = new Map<string, NormalizedMatch[]>();
      for (const season of seasons) { await pause(); group.set(season, await provider.getSeasonFixtures(c.id, season)); }
      const fixtures = [...group.values()].flat();
      const completed = fixtures.some(m => m.status === 'finished') && fixtures.every(m =>
        ['finished','cancelled'].includes(m.status) && m.kickoffAt <= now);
      if (!cycles || completed) { for (const [s, f] of group) selected.set(s, f); cycles++; }
      if (cycles >= count) break;
    }
  }
  return { availableSeasons, selected };
}
export function parseExpansionArgs(values: string[]) {
  const args = new Map<string, string>();
  for (let i = 0; i < values.length; i++) {
    const token = values[i]!;
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const [key, ...rest] = token.slice(2).split('=');
    if (!['competition','seasons','resume','dry-run','output'].includes(key!)) throw new Error(`Unknown option: ${key}`);
    const value = rest.length ? rest.join('=') : values[i+1] && !values[i+1]!.startsWith('--') ? values[++i]! : 'true';
    args.set(key!, value);
  }
  const seasons = Number(args.get('seasons') ?? '2');
  if (!Number.isInteger(seasons) || seasons < 1 || seasons > 2) throw new Error('--seasons must be 1 or 2');
  for (const flag of ['resume','dry-run']) if (args.has(flag) && !['true','false'].includes(args.get(flag)!)) throw new Error(`--${flag} must be true or false`);
  return { competition: args.get('competition'), seasons, resume: args.get('resume') === 'true', dryRun: args.get('dry-run') === 'true', output: args.get('output') };
}
