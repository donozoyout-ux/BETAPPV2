import { describe, expect, it } from 'vitest';
import { apiPrematchOdds, type ApiFixture } from '../../src/providers/api-football.js';
import { buildBookmakerMarkets } from '../../src/odds-analysis/movement.js';

const fixture: ApiFixture = {
  snapshot: { provider:'api-football', externalId:'1001', status:'scheduled', phase:'UNKNOWN',
    homeScore:null, awayScore:null, minute:null, addedTime:null, observedAt:'2026-09-24T12:00:00Z' },
  league:'Eredivisie', kickoffAt:'2026-09-24T18:00:00Z',
  homeTeam:'Ajax', awayTeam:'PSV', homeId:1, awayId:2,
};

describe('API-Football prematch odds normalization', () => {
  it('keeps only supported pre-match markets and preserves real capture time', () => {
    const capturedAt = new Date('2026-09-24T15:00:00Z');
    const rows = [{ fixture:{id:1001}, bookmakers:[{ name:'Pinnacle', bets:[
      { name:'Match Winner', values:[{value:'Ajax',odd:'2.10'},{value:'Draw',odd:'3.50'},{value:'PSV',odd:'3.20'}] },
      { name:'Goals Over/Under', values:[{value:'Over 2.5',odd:'1.90'},{value:'Under 2.5',odd:'1.95'}] },
      { name:'Asian Handicap', values:[{value:'Ajax -0.5',odd:'2.00'},{value:'PSV +0.5',odd:'1.85'}] },
      { name:'Total Corners', values:[{value:'Over 9.5',odd:'1.92'},{value:'Under 9.5',odd:'1.88'}] },
      { name:'Correct Score', values:[{value:'1:0',odd:'8.0'}] },
    ]}] }];
    const odds = apiPrematchOdds(rows, fixture, capturedAt);
    expect(new Set(odds.map((item) => item.marketType))).toEqual(new Set([
      'MATCH_RESULT','TOTAL_GOALS','ASIAN_HANDICAP','TOTAL_CORNERS',
    ]));
    expect(odds.filter((item) => item.marketType === 'MATCH_RESULT').map((item) => item.selection).sort())
      .toEqual(['AWAY','DRAW','HOME']);
    expect(odds.find((item) => item.marketType === 'ASIAN_HANDICAP' && item.selection === 'HOME'))
      .toMatchObject({ line:-0.5, provider:'api-football:pinnacle' });
    expect(odds.find((item) => item.marketType === 'ASIAN_HANDICAP' && item.selection === 'AWAY'))
      .toMatchObject({ line:-0.5, provider:'api-football:pinnacle' });
    expect(odds.every((item) => item.capturedAt.getTime() === capturedAt.getTime())).toBe(true);
  });

  it('never turns live or post-kickoff data into prematch evidence', () => {
    const rows = [{ fixture:{id:1001}, bookmakers:[{ name:'Pinnacle', bets:[
      { name:'Match Winner', values:[{value:'Home',odd:'2.1'},{value:'Draw',odd:'3.5'},{value:'Away',odd:'3.2'}] },
    ]}] }];
    expect(apiPrematchOdds(rows, {...fixture,snapshot:{...fixture.snapshot,status:'live'}}, new Date('2026-09-24T17:00:00Z'))).toEqual([]);
    expect(apiPrematchOdds(rows, fixture, new Date('2026-09-24T18:00:00Z'))).toEqual([]);
  });

  it('deduplicates the same bookmaker across NowGoal and API-Football for analysis coverage', () => {
    const at = new Date('2026-09-24T15:00:00Z');
    const later = new Date('2026-09-24T16:00:00Z');
    const rows = ['HOME','DRAW','AWAY'].flatMap((selection, index) => [
      {matchId:'m1',provider:'nowgoal:pinnacle',marketType:'1X2',marketName:'1X2',line:null,selection,oddsDecimal:[2.1,3.5,3.2][index]!,capturedAt:at},
      {matchId:'m1',provider:'api-football:pinnacle',marketType:'1X2',marketName:'1X2',line:null,selection,oddsDecimal:[2.0,3.6,3.3][index]!,capturedAt:later},
    ]);
    const markets = buildBookmakerMarkets(rows);
    expect(markets).toHaveLength(1);
    expect(markets[0]!.provider).toBe('pinnacle');
  });
});
