import {describe,expect,it,vi} from 'vitest';
import {dryRunHistoricalBackfill,plannedBackfillSources} from '../../src/historical/data-backfill-dry-run.js';
import {openFootballLeagueSources} from '../../src/historical/openfootball-source.js';
import {parseOpenFootballDataset} from '../../src/historical/openfootball-parser.js';

const source=openFootballLeagueSources.find(item=>item.configKey==='PremierLeague')!;
const dataset={...source,season:'2024-25',sourceKey:'openfootball:2024-25:en.1.json',
  url:'https://example.test/2024-25/en.1.json'};
const match=(date:string,time:string,ft?:[number,number])=>({date,time,team1:'Arsenal',team2:'Chelsea',
  ...(ft?{score:{ft}}:{})});

describe('historical data backfill dry-run',()=>{
  it('keeps repeat dry-runs deterministic and performs no writes',async()=>{
    const fetcher=vi.fn(async()=>({matches:[match('2025-01-01','15:00',[1,0]),match('2025-01-02','15:00',[2,1])]}));
    const input={competitionKey:'PremierLeague',baseUrl:'https://example.test',seasons:['2024-25'],fetcher};
    const [first,second]=await Promise.all([dryRunHistoricalBackfill(input),dryRunHistoricalBackfill(input)]);
    expect(first.eligible).toBe(2);expect(second.eligible).toBe(2);
    expect(first.duplicate).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('requires explicit kickoff and a valid FT score',async()=>{
    const report=await dryRunHistoricalBackfill({competitionKey:'PremierLeague',baseUrl:'https://example.test',
      seasons:['2024-25'],fetcher:async()=>({matches:[match('2025-01-01','15:00',[1,0]),
        match('2025-01-02','',[2,0]),match('2025-01-03','15:00'),match('2025-01-04','15:00',[-1,2])]})});
    expect(report.eligible).toBe(1);expect(report.unsafe_time).toBe(1);expect(report.skipped).toBe(1);
    expect(report.invalid_result).toBe(1);
  });

  it('rejects unsupported competition mapping and reports missing source as an error',async()=>{
    await expect(dryRunHistoricalBackfill({competitionKey:'Eredivisie',baseUrl:'x',seasons:[],fetcher:async()=>({})}))
      .rejects.toThrow('Choose one of');
    const result=await dryRunHistoricalBackfill({competitionKey:'Ligue1',baseUrl:'https://example.test',
      seasons:['2024-25'],fetcher:async()=>{throw new Error('network');}});
    expect(result.errors).toBe(1);expect(result.eligible).toBe(0);
  });

  it('maps open match-data source and isolates timestamp-unsafe odds as shadow only',()=>{
    const sources=plannedBackfillSources('https://example.test',['2024-25'],['PremierLeague']);
    expect(sources.openFootball[0]).toMatchObject({competition:'Premier League',policy:'PRODUCTION_ELIGIBLE_CC0'});
    expect(sources.openFootball[0]?.exactOddsTimestamps).toBe(false);
    expect(sources.footballDataArchive).toMatchObject({automatedCollection:false,
      odds:'SHADOW_RESEARCH_ONLY_NO_TRUSTED_CAPTURE_TIMESTAMP'});
  });

  it('uses the parser kickoff as historical event time and preserves match identity input',async()=>{
    const payload={matches:[match('2025-01-01','15:00',[1,0])]};
    const first=await dryRunHistoricalBackfill({competitionKey:'PremierLeague',baseUrl:'https://example.test',
      seasons:['2024-25'],fetcher:async()=>payload});
    const second=await dryRunHistoricalBackfill({competitionKey:'PremierLeague',baseUrl:'https://example.test',
      seasons:['2024-25'],fetcher:async()=>payload});
    expect(first.seasons[0]?.eligible).toBe(1);
    expect(second.seasons[0]?.eligible).toBe(1);
    const datasetWithUrl={...source,season:'2024-25',sourceKey:'openfootball:2024-25:en.1.json',
      url:'https://example.test/2024-25/en.1.json'};
    expect(parseOpenFootballDataset(payload,datasetWithUrl).matches[0]?.match.providerExternalId)
      .toBe(parseOpenFootballDataset(payload,datasetWithUrl).matches[0]?.match.providerExternalId);
    expect(dataset.sourceKey).toContain('2024-25');
    expect(first.seasons[0]?.duplicate).toBeNull();
  });
});
