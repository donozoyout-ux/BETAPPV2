import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { openFootballKickoff, parseOpenFootballDataset } from '../../src/historical/openfootball-parser.js';
import { currentOpenFootballSeason, openFootballDatasets, openFootballInternationalDatasets } from '../../src/historical/openfootball-source.js';
import { OpenFootballHistoricalImporter } from '../../src/historical/openfootball-importer.js';
import { createHash } from 'node:crypto';
import { vi } from 'vitest';

describe('OpenFootball CC0 historical import', () => {
  it('uses only verified configured league-season files', () => {
    const rows=openFootballDatasets('https://raw.githubusercontent.com/openfootball/football.json/master',
      ['2026-27','2025-26'],['PremierLeague','BelgianProLeague','SuperLig']);
    expect(rows.map((row)=>row.sourceKey)).toEqual([
      'openfootball:2026-27:en.1.json',
      'openfootball:2025-26:en.1.json',
      'openfootball:2025-26:be.1.json',
      'openfootball:2025-26:tr.1.json',
    ]);
    expect(currentOpenFootballSeason(new Date('2026-09-24T12:00:00Z'))).toBe('2026-27');
    expect(currentOpenFootballSeason(new Date('2027-03-01T12:00:00Z'))).toBe('2026-27');
  });


  it('adds only the verified safe international datasets when configured', () => {
    const rows=openFootballInternationalDatasets(['WorldCup','EURO']);
    expect(rows.map((row)=>row.sourceKey)).toEqual([
      'openfootball:worldcup:2026',
      'openfootball:worldcup:2022',
      'openfootball:euro:2024',
    ]);
    expect(openFootballInternationalDatasets(['PremierLeague'])).toEqual([]);
  });

  it('parses explicit World Cup UTC offsets without guessing a host timezone', () => {
    const dataset=openFootballInternationalDatasets(['WorldCup'])[0]!;
    const payload={name:'World Cup 2026',matches:[
      {round:'Matchday 1',date:'2026-06-11',time:'13:00 UTC-6',team1:'Mexico',team2:'South Africa',score:{ft:[2,0],ht:[1,0]}},
    ]};
    const parsed=parseOpenFootballDataset(payload,dataset,new Date('2026-09-24T12:00:00Z'));
    expect(parsed.matches[0]!.match).toMatchObject({
      status:'finished',season:'2026',homeTeam:{name:'Mexico'},awayTeam:{name:'South Africa'},homeScore:2,awayScore:0,
    });
    expect(parsed.matches[0]!.match.kickoffAt.toISOString()).toBe('2026-06-11T19:00:00.000Z');
  });

  it('imports only finished rows with an explicit kickoff time', () => {
    const dataset=openFootballDatasets('https://raw.githubusercontent.com/openfootball/football.json/master',
      ['2026-27'],['PremierLeague'])[0]!;
    const payload={name:'English Premier League 2026/27',matches:[
      {round:'Matchday 1',date:'2026-08-21',time:'20:00',team1:'Arsenal FC',team2:'Coventry City FC',score:{ft:[3,0],ht:[2,0]}},
      {round:'Matchday 2',date:'2026-08-28',time:'20:00',team1:'Team A',team2:'Team B',score:{}},
      {round:'Matchday 3',date:'2026-09-01',team1:'Team C',team2:'Team D',score:{ft:[1,1]}},
    ]};
    const parsed=parseOpenFootballDataset(payload,dataset,new Date('2026-09-24T12:00:00Z'));
    expect(parsed).toMatchObject({totalMatches:3,finishedRows:1,skippedUnfinished:1,skippedUnsafeTime:1});
    expect(parsed.matches[0]!.match).toMatchObject({
      status:'finished',season:'2026/2027',homeScore:3,awayScore:0,round:'Matchday 1',
    });
    expect(parsed.matches[0]!.match.kickoffAt.toISOString()).toBe('2026-08-21T19:00:00.000Z');
    expect(parsed.matches[0]!.statistics.statistics).toEqual([]);
  });

  it('uses timezone rules and never invents a missing time', () => {
    expect(openFootballKickoff('2025-08-08','20:30','Europe/Istanbul')?.toISOString())
      .toBe('2025-08-08T17:30:00.000Z');
    expect(openFootballKickoff('2026-08-21','20:00','Europe/London')?.toISOString())
      .toBe('2026-08-21T19:00:00.000Z');
    expect(openFootballKickoff('2026-08-21','13:00 UTC-6',null)?.toISOString())
      .toBe('2026-08-21T19:00:00.000Z');
    expect(openFootballKickoff('2026-08-21',null,'Europe/London')).toBeNull();
    expect(openFootballKickoff('2026-08-21','13:00',null)).toBeNull();
    expect(openFootballKickoff('2025-02-31','15:00','Europe/London')).toBeNull();
    expect(openFootballKickoff('2025-03-30','01:30','Europe/London')).toBeNull();
    expect(openFootballKickoff('2025-10-26','01:30','Europe/London')).toBeNull();
  });

  it('rejects pre-2024 and future fixtures from the official historical import set',()=>{
    const dataset=openFootballDatasets('https://raw.githubusercontent.com/openfootball/football.json/master',
      ['2024-25'],['PremierLeague'])[0]!;
    const parsed=parseOpenFootballDataset({matches:[
      {date:'2023-12-31',time:'20:00',team1:'Old A',team2:'Old B',score:{ft:[1,0]}},
      {date:'2026-10-01',time:'20:00',team1:'Future A',team2:'Future B',score:{ft:[1,0]}},
    ]},dataset,new Date('2026-09-27T12:00:00Z'));
    expect(parsed.matches).toHaveLength(0);
    expect(parsed.skippedBeforeCutoff).toBe(1);
    expect(parsed.skippedFuture).toBe(1);
  });

  it('keeps historical imports behind the global opt-in and leaves Football-Data automation disabled', () => {
    const config=loadConfig({DATABASE_URL:'postgresql://localhost/test'});
    expect(config.OPENFOOTBALL_IMPORT_ENABLED).toBe(false);
    expect(config.DATA_BACKFILL_ENABLED).toBe(false);
    expect(config.DATA_BACKFILL_MAX_MATCHES_PER_RUN).toBe(150);
    expect(config.OPENFOOTBALL_IMPORT_SEASONS).toEqual(['2026-27','2025-26','2024-25']);
    expect(config.OPENFOOTBALL_BATCH_SIZE).toBe(150);
    expect(config.OPENFOOTBALL_CURRENT_REFRESH_MS).toBe(86400000);

    const yaml=readFileSync('render.yaml','utf8').replace(/\r\n/g,'\n');
    const worker=yaml.split('name: betapp-v2-collector')[1] ?? '';
    const web=yaml.split('name: betapp-v2-web')[1]?.split('name: betapp-v2-collector')[0] ?? '';
    expect(web).not.toContain('OPENFOOTBALL_IMPORT_ENABLED');
    expect(worker).toContain('key: PUBLIC_CSV_IMPORT_ENABLED\n        value: "false"');
    expect(worker).toContain('key: OPENFOOTBALL_IMPORT_ENABLED\n        value: "true"');
    expect(worker).toContain('key: DATA_BACKFILL_ENABLED\n        value: "false"');
    expect(worker).toContain('key: DATA_BACKFILL_MAX_MATCHES_PER_RUN\n        value: "150"');
    expect(worker).toContain('key: OPENFOOTBALL_IMPORT_SEASONS\n        value: 2026-27,2025-26,2024-25');
    expect(worker).toContain('key: OPENFOOTBALL_CURRENT_REFRESH_MS\n        value: "86400000"');
  });

  it('does not reimport an unchanged completed OpenFootball dataset on rerun', async () => {
    const payload={name:'English Premier League 2026/27',matches:[
      {date:'2026-08-21',time:'20:00',team1:'Arsenal FC',team2:'Coventry City FC',score:{ft:[3,0]}},
    ]};
    const text=JSON.stringify(payload);
    const config=loadConfig({DATABASE_URL:'postgresql://localhost/test',SUPPORTED_COMPETITIONS:'PremierLeague',
      OPENFOOTBALL_IMPORT_ENABLED:'true',OPENFOOTBALL_IMPORT_SEASONS:'2026-27'});
    const imports={ensureDatasets:vi.fn(),state:vi.fn(async()=>({status:'COMPLETED',
      content_hash:createHash('sha256').update(text).digest('hex')})),checked:vi.fn()};
    const football={upsertMatch:vi.fn()};const historical={save:vi.fn()};
    const logger={info:vi.fn(),warn:vi.fn()};
    const importer=new OpenFootballHistoricalImporter(config,football as never,historical as never,imports as never,logger as never);
    const originalFetch=globalThis.fetch;
    globalThis.fetch=vi.fn(async()=>new Response(text,{status:200})) as typeof fetch;
    try {
      await expect(importer.runCycle()).resolves.toMatchObject({state:'NO_CHANGE'});
      expect(football.upsertMatch).not.toHaveBeenCalled();
      expect(historical.save).not.toHaveBeenCalled();
      expect(imports.checked).toHaveBeenCalledOnce();
    } finally { globalThis.fetch=originalFetch; }
  });

  it('isolates a failed import batch and leaves it resumable',async()=>{
    const payload={matches:[{date:'2026-08-21',time:'20:00',team1:'Arsenal FC',team2:'Coventry City FC',score:{ft:[3,0]}}]};
    const text=JSON.stringify(payload);
    const config=loadConfig({DATABASE_URL:'postgresql://localhost/test',SUPPORTED_COMPETITIONS:'PremierLeague',
      OPENFOOTBALL_IMPORT_ENABLED:'true',OPENFOOTBALL_IMPORT_SEASONS:'2026-27'});
    const imports={ensureDatasets:vi.fn(async()=>undefined),state:vi.fn().mockResolvedValueOnce(null)
      .mockResolvedValueOnce({status:'RUNNING',cursor_row:0}),markRunning:vi.fn(async()=>undefined),
      fail:vi.fn(async()=>undefined),markProgress:vi.fn(async()=>undefined)};
    const football={upsertMatch:vi.fn(async()=>{throw new Error('isolated fixture failure');})};
    const historical={save:vi.fn()};const logger={info:vi.fn(),warn:vi.fn()};
    const importer=new OpenFootballHistoricalImporter(config,football as never,historical as never,imports as never,logger as never);
    const originalFetch=globalThis.fetch;globalThis.fetch=vi.fn(async()=>new Response(text,{status:200})) as typeof fetch;
    try {
      await expect(importer.runCycle()).resolves.toMatchObject({state:'ERROR'});
      expect(imports.fail).toHaveBeenCalledOnce();
      expect(imports.markProgress).not.toHaveBeenCalled();
    } finally { globalThis.fetch=originalFetch; }
  });
});
