import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { competitionKey } from '../../src/matching/competition.js';
import { nationalTeamAliases } from '../../src/matching/team-alias.js';
import { fotmobCompetitions } from '../../src/providers/fotmob.js';
import { discoverScope, parseExpansionArgs, blankReport, selectedCycleCount } from '../../src/historical/competition-scope.js';
import { runCompetitionBackfill } from '../../src/historical/competition-backfill.js';
import type { ExpansionReport } from '../../src/historical/competition-scope.js';
import type { NormalizedMatch } from '../../src/domain/types.js';
const competition = { id: 57, key: 'Eredivisie', name: 'Eredivisie' };
function fixture(id: string, season = '2025', status: NormalizedMatch['status'] = 'finished'): NormalizedMatch {
  const observed = new Date('2026-09-24');
  const team = (name: string) => ({ providerExternalId: name, name, country: null, shortName: null, logoUrl: null, sourceUpdatedAt: observed, raw: {} });
  return { providerExternalId: id, league: { providerExternalId: '57', name: 'Eredivisie', country: null, logoUrl: null, sourceUpdatedAt: observed, raw: {} },
    homeTeam: team('Home'), awayTeam: team('Away'), kickoffAt: new Date('2025-01-01'), season, status,
    round: null, homeScore: 2, awayScore: 1, sourceUpdatedAt: observed, raw: {} };
}
function harness() {
  let report: ExpansionReport | null = null;
  const cursors = new Map<string, Record<string, unknown>>();
  const persisted = new Set<string>(); const imported = new Set<string>(); const order: string[] = [];
  const provider = { getAvailableSeasons: vi.fn(async () => ['2026','2025']),
    getSeasonFixtures: vi.fn(async (_id: number, season: string) => [fixture(season, season)]),
    getMatchStatistics: vi.fn(async (id: string) => { order.push(`detail:${id}`); return { matchProviderExternalId: id, sourceUpdatedAt: new Date(), statistics: [], raw: {} }; }) };
  const historical = { expansionReport: vi.fn(async () => report), saveExpansionReport: vi.fn(async (r: ExpansionReport) => { report = structuredClone(r); }),
    startJob: vi.fn(async (_p: string,_c: string,season: string) => ({ id: season, cursor: cursors.get(season) ?? {} })),
    updateJob: vi.fn(async (id: string,p: { cursor: Record<string,unknown> }) => { cursors.set(id,structuredClone(p.cursor)); }),
    detailsImported: vi.fn(async (id: string) => imported.has(id)), save: vi.fn(async (_p: string,m: NormalizedMatch) => { imported.add(m.providerExternalId); }),
    competitionEvidence: vi.fn(async () => ({ examples: 0, odds: 0, corners: 0 })) };
  const football = { upsertMatch: vi.fn(async (_p: string,m: NormalizedMatch,outcome: {matchesInserted: number; matchesUpdated: number; duplicateMatchesPrevented: number}) => {
    order.push(`fixture:${m.providerExternalId}`);
    if (persisted.has(m.providerExternalId)) { outcome.matchesUpdated++; outcome.duplicateMatchesPrevented++; } else outcome.matchesInserted++;
    persisted.add(m.providerExternalId); return m.providerExternalId;
  }), upsertStatistics: vi.fn() };
  const corners = { saveHistorical: vi.fn(), recordBackfillFailure: vi.fn(), resolveBackfillFailure: vi.fn() };
  const deps = { provider, historical, football, corners, pause: vi.fn(async () => undefined), refreshPipeline: vi.fn(async () => undefined) };
  return { deps, order, persisted, imported };
}
describe('competition expansion', () => {
  it('enables verified IDs/config/aliases in both Render services', () => {
    const expected = [ [57,'Eredivisie','Netherlands Eredivisie','eredivisie'], [40,'BelgianProLeague','First Division A','belgian_pro_league'],
      [46,'DanishSuperliga','Superligaen','danish_superliga'],[67,'Allsvenskan','Swedish Allsvenskan','allsvenskan'],[135,'GreekSuperLeague','Super League 1','greek_super_league'] ] as const;
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/test' });
    const yaml = readFileSync('render.yaml','utf8');
    for (const [id,key,alias,canonical] of expected) {
      expect(fotmobCompetitions.find(c => c.key === key)?.id).toBe(id);
      expect(config.SUPPORTED_COMPETITIONS).toContain(key);
      expect(competitionKey(alias)).toBe(canonical);
      expect(yaml.split(/- key: SUPPORTED_COMPETITIONS/).slice(1).every(s => s.split('\n')[1]?.includes(key))).toBe(true);
    }
  });
  it('supports spaced/equal CLI flags and rejects unbounded seasons', () => {
    expect(parseExpansionArgs(['--competition','Eredivisie','--seasons=2','--resume','--dry-run'])).toMatchObject({ competition:'Eredivisie',seasons:2,resume:true,dryRun:true });
    expect(() => parseExpansionArgs(['--seasons','20'])).toThrow();
  });
  it('selects only discovered current/previous completed seasons and skips future labels', async () => {
    const h = harness(); h.deps.provider.getAvailableSeasons.mockResolvedValue(['2030','2026','2025']);
    const scope = await discoverScope(h.deps.provider,competition,2,h.deps.pause,undefined,new Date('2026-09-24'));
    expect([...scope.selected.keys()]).toEqual(['2026','2025']);
    expect(h.deps.provider.getSeasonFixtures.mock.calls.map(c => c[1])).toEqual(['2026','2025']);
  });
  it('groups provider-exposed tournament stages into two real cycles', async () => {
    const h = harness(); h.deps.provider.getAvailableSeasons.mockResolvedValue(['2022/2023','2023','2018/2019','2019']);
    const scope = await discoverScope(h.deps.provider,{id:10607,key:'EUROQualification',name:'EURO Qualification'},2,h.deps.pause);
    expect([...scope.selected.keys()]).toEqual(['2022/2023','2023','2018/2019','2019']);
    expect(selectedCycleCount('EURO Qualification',[...scope.selected.keys()])).toBe(2);
  });
  it('expands a completed one-cycle import to a second cycle when coverage still needs data', async () => {
    const h = harness();
    const first = await runCompetitionBackfill(competition,{seasons:1,resume:true,dryRun:false},h.deps as never);
    expect(first.selectedSeasons).toEqual(['2026']);
    expect(first.phase).toBe('COMPLETE');
    const second = await runCompetitionBackfill(competition,{seasons:2,resume:true,dryRun:false},h.deps as never);
    expect(second.selectedSeasons).toEqual(['2026','2025']);
    expect(h.deps.provider.getSeasonFixtures).toHaveBeenCalledWith(57,'2025');
  });
  it('dry-run does no database writes or detail import', async () => {
    const h = harness(); const r = await runCompetitionBackfill(competition,{seasons:2,resume:false,dryRun:true},h.deps as never);
    expect(r.status).toBe('PASS'); expect(r.matchesInserted).toBe(0);
    expect(h.deps.football.upsertMatch).not.toHaveBeenCalled(); expect(h.deps.historical.saveExpansionReport).not.toHaveBeenCalled();
    expect(h.deps.provider.getMatchStatistics).not.toHaveBeenCalled();
  });
  it('persists all fixtures before details, retains unavailable stats and prevents duplicates on rerun', async () => {
    const h = harness(); const options = { seasons:2,resume:false,dryRun:false };
    const first = await runCompetitionBackfill(competition,options,h.deps as never);
    expect(h.order).toEqual(['fixture:2026','fixture:2025','detail:2026','detail:2025']);
    expect(first).toMatchObject({ matchesInserted:2, statisticsUnavailable:2, historicalExamplesGenerated:0, oddsCoveredMatches:0 });
    const second = await runCompetitionBackfill(competition,options,h.deps as never);
    expect(second).toMatchObject({matchesInserted:0,matchesUpdated:2,duplicateMatchesPrevented:2,detailsSkipped:2});
    expect(h.deps.provider.getMatchStatistics).toHaveBeenCalledTimes(2);
    expect(h.deps.football.upsertStatistics.mock.calls[0]?.[1].statistics).toEqual([]);
    expect(h.deps.pause.mock.calls.length).toBeGreaterThanOrEqual(8);
  });
  it('continues after stats failure and resumes by identity even if fixture order changes', async () => {
    const h = harness(); h.deps.provider.getMatchStatistics.mockRejectedValueOnce(new Error('provider unavailable'));
    const first = await runCompetitionBackfill(competition,{seasons:2,resume:false,dryRun:false},h.deps as never);
    expect(first.status).toBe('PARTIAL'); expect(first.statisticsFailed).toBe(1); expect(h.imported.has('2025')).toBe(true);
    const next = await runCompetitionBackfill(competition,{seasons:2,resume:true,dryRun:false},h.deps as never);
    expect(next.statisticsFailed).toBe(0); expect(h.deps.football.upsertMatch).toHaveBeenCalledTimes(2);
    expect(h.deps.provider.getMatchStatistics).toHaveBeenCalledTimes(3);
  });
  it('supports national-team imports and exact senior aliases without youth/club collisions', async () => {
    expect(nationalTeamAliases('Turkey')).toEqual(nationalTeamAliases('Türkiye'));
    expect(nationalTeamAliases('USA')).toEqual(nationalTeamAliases('United States'));
    expect(nationalTeamAliases('South Korea')).toEqual(nationalTeamAliases('Korea Republic'));
    expect(nationalTeamAliases('Czechia')).toEqual(nationalTeamAliases('Czech Republic'));
    expect(nationalTeamAliases('Turkey U21')).not.toEqual(nationalTeamAliases('Turkey'));
    expect(nationalTeamAliases('Turkey FC')).not.toEqual(nationalTeamAliases('Turkey'));
    const h = harness(); const c = {id:77,key:'WorldCup',name:'FIFA World Cup'};
    const r = await runCompetitionBackfill(c,{seasons:2,resume:false,dryRun:false},h.deps as never);
    expect(r.competition).toBe('FIFA World Cup'); expect(r.matchesInserted).toBe(2);
    expect(blankReport(c,true).dryRun).toBe(true);
  });
});
