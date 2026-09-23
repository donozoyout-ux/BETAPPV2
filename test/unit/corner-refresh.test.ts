import { describe, expect, it, vi } from 'vitest';
import { refreshUpcomingCornerAnalyses } from '../../src/corners/refresh.js';
import { CornerRepository } from '../../src/db/corner-repository.js';
import type { HistoricalCornerMatch, CornerAnalysis } from '../../src/corners/types.js';
import type { CornerModelConfig } from '../../src/corners/config.js';

const now = new Date('2099-01-01T00:00:00Z');
const target = { id:'a',status:'scheduled',competition_id:'league',competition:'International Friendlies',season:'2099',
  home_team_id:'home',away_team_id:'away',kickoff_at:new Date('2099-01-02T18:00:00Z') };
const config = { SUPPORTED_COMPETITIONS:['InternationalFriendlies'],COLLECTOR_FUTURE_DAYS:3 };
const logger = { info:vi.fn(),error:vi.fn() };
function repo(rows = [target], history: HistoricalCornerMatch[] = []) {
  const saved = new Set<string>();
  return { loadHistory:vi.fn().mockResolvedValue(history),upcomingRange:vi.fn().mockResolvedValue(rows),
    saveAnalysis:vi.fn<(id:string, analysis:CornerAnalysis, config:CornerModelConfig, hash:string) => Promise<boolean>>(async (id) => {
      const fresh = !saved.has(id);saved.add(id);return fresh;
    }) };
}

describe('upcoming corner refresh', () => {
  it('generates national-team analysis with honest low quality and remains idempotent', async () => {
    const repository = repo();
    expect(await refreshUpcomingCornerAnalyses(repository,config,logger,now)).toEqual({ scheduledTargets:1,generated:1,alreadyExisting:0,insufficientData:1,failed:0 });
    expect(repository.saveAnalysis.mock.calls[0]?.[1].dataQuality.analysisEligible).toBe(false);
    expect(repository.saveAnalysis.mock.calls[0]?.[1].sample).toMatchObject({ home:0,away:0,league:0 });
    expect(await refreshUpcomingCornerAnalyses(repository,config,logger,now)).toMatchObject({ generated:0,alreadyExisting:1 });
  });
  it('excludes finished, cancelled, out-of-range and inactive MLS targets', async () => {
    const repository = repo([{...target,status:'finished'},{...target,status:'cancelled'},
      {...target,competition:'MLS'},{...target,kickoff_at:new Date('2099-03-01')}]);
    expect(await refreshUpcomingCornerAnalyses(repository,config,logger,now)).toMatchObject({ scheduledTargets:0,generated:0 });
    expect(repository.saveAnalysis).not.toHaveBeenCalled();
  });
  it('continues after one target fails', async () => {
    const repository = repo([target,{...target,id:'b'}]);
    repository.saveAnalysis.mockRejectedValueOnce(new Error('target failure'));
    expect(await refreshUpcomingCornerAnalyses(repository,config,logger,now)).toMatchObject({ scheduledTargets:2,generated:1,failed:1 });
  });
  it('ignores historical rows at or after target kickoff', async () => {
    const future = { matchId:'future',competitionId:'league',season:'2099',homeTeamId:'home',awayTeamId:'away',
      kickoffAt:new Date('2099-01-03'),homeCorners:99,awayCorners:99 } as HistoricalCornerMatch;
    const empty = repo();
    const contaminated = repo([target],[future,{...future,kickoffAt:target.kickoff_at}]);
    await refreshUpcomingCornerAnalyses(empty,config,logger,now);
    await refreshUpcomingCornerAnalyses(contaminated,config,logger,now);
    expect(contaminated.saveAnalysis.mock.calls).toEqual(empty.saveAnalysis.mock.calls);
  });
  it('queries the scheduled range and filters configured competitions', async () => {
    const query = vi.fn().mockResolvedValue({ rows:[target,{...target,id:'mls',competition:'MLS'}] });
    const repository = new CornerRepository({query} as never);
    const to = new Date('2099-01-04');
    expect(await repository.upcomingRange(now,to,config.SUPPORTED_COMPETITIONS)).toEqual([target]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("m.status='scheduled'"),[now,to]);
  });
  it('also generates club competition targets', async () => {
    expect(await refreshUpcomingCornerAnalyses(repo([{...target,competition:'Premier League'}]),
      {...config,SUPPORTED_COMPETITIONS:['PremierLeague']},logger,now)).toMatchObject({generated:1});
  });
});
