import type { DatabasePool } from '../db/pool.js';
import { competitionKey } from '../matching/competition.js';
import { normalizeTeamAlias, teamNameSimilarity } from '../matching/team-alias.js';
import type { BackfillCompetitionResult } from './data-backfill-dry-run.js';

type ExistingMatch={competition:string;season:string|null;home_team:string;away_team:string;kickoff_at:Date|string;
  provider:string|null;external_id:string|null};
type ExistingCompetitionCount={competition:string;total_matches:number|string;finished:number|string};
type Candidate={providerExternalId:string;competition:string;season:string;homeTeam:string;awayTeam:string;kickoffAt:string};

const canonicalSeason=(value:string|null|undefined)=>{
  const years=value?.match(/(?:19|20)\d{2}/g)??[];
  return years.length>=2?`${years[0]}/${years.at(-1)}`:value?.replace(/-/g,'/')??'';
};
function editSimilarity(left:string,right:string){
  const a=left.replace(/\s/g,''),b=right.replace(/\s/g,'');
  if(!a.length||!b.length)return 0;
  let previous=Array.from({length:b.length+1},(_,index)=>index);
  for(let i=1;i<=a.length;i+=1){
    const current=[i];
    for(let j=1;j<=b.length;j+=1)current[j]=Math.min(current[j-1]!+1,previous[j]!+1,
      previous[j-1]!+(a[i-1]===b[j-1]?0:1));
    previous=current;
  }
  return 1-previous[b.length]!/Math.max(a.length,b.length);
}

export async function reconcileHistoricalBackfill(pool:DatabasePool,competitions:BackfillCompetitionResult[]){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    await client.query("SET LOCAL statement_timeout = '12000'");
    await client.query("SET LOCAL lock_timeout = '2000'");
    const [totals,counts]=await Promise.all([
      client.query<{total_matches:number|string;finished:number|string}>(`SELECT count(*)::int total_matches,
        count(*) FILTER(WHERE status='finished')::int finished FROM matches`),
      client.query<ExistingCompetitionCount>(`SELECT l.name competition,count(m.id)::int total_matches,
        count(m.id) FILTER(WHERE m.status='finished')::int finished FROM leagues l LEFT JOIN matches m ON m.league_id=l.id
        GROUP BY l.name ORDER BY l.name`),
    ]);
    const ambiguousMatches:Array<{competition:string;season:string;kickoffAt:string;
      reason:'MULTIPLE_EXACT'|'FUZZY_TEAM_OR_KICKOFF'|'COMPETITION_SEASON_CONFLICT'}>=[];
    const competitionSummary=[];
    for(const competition of competitions){
      const seasonSummary=[];
      for(const season of competition.seasons){
        let duplicate=0,ambiguous=0;
        const candidates=season.eligibleMatches as Candidate[];
        for(let offset=0;offset<candidates.length;offset+=150){
          const batch=candidates.slice(offset,offset+150);
          if(!batch.length)continue;
          const kickoffs=batch.map(candidate=>new Date(candidate.kickoffAt).getTime());
          const lower=new Date(Math.min(...kickoffs)-30*60_000),upper=new Date(Math.max(...kickoffs)+30*60_000);
          const existing=await client.query<ExistingMatch>(`SELECT l.name competition,m.season,ht.name home_team,
            at.name away_team,m.kickoff_at,pe.provider,pe.external_id FROM matches m JOIN leagues l ON l.id=m.league_id
            JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
            LEFT JOIN provider_entities pe ON pe.internal_id=m.id AND pe.entity_type='match' AND pe.provider='openfootball'
            WHERE pe.external_id=ANY($1::text[]) OR (l.name=ANY($2::text[]) AND m.kickoff_at BETWEEN $3 AND $4)
            LIMIT 2000`,[batch.map(candidate=>candidate.providerExternalId),[season.competition],lower,upper]);
          if(existing.rows.length>=2000)throw new Error('RECONCILIATION_CANDIDATE_BATCH_TOO_BROAD');
          const current=existing.rows;
          for(const candidate of batch){
          const providerMatches=current.filter(row=>row.provider==='openfootball'&&row.external_id===candidate.providerExternalId);
          if(providerMatches.length===1){duplicate+=1;continue;}
          if(providerMatches.length>1){ambiguous+=1;ambiguousMatches.push({competition:candidate.competition,
            season:candidate.season,kickoffAt:candidate.kickoffAt,reason:'MULTIPLE_EXACT'});continue;}
          const candidateCompetition=competitionKey(candidate.competition);
          const candidateHome=normalizeTeamAlias(candidate.homeTeam),candidateAway=normalizeTeamAlias(candidate.awayTeam);
          const candidateKickoff=new Date(candidate.kickoffAt).getTime();
          const sameCompetition=current.filter(row=>competitionKey(row.competition)===candidateCompetition);
          const sameScope=sameCompetition.filter(row=>canonicalSeason(row.season)===canonicalSeason(candidate.season));
          const exact=sameScope.filter(row=>normalizeTeamAlias(row.home_team)===candidateHome
            &&normalizeTeamAlias(row.away_team)===candidateAway
            &&new Date(row.kickoff_at).getTime()===candidateKickoff);
          if(exact.length===1){duplicate+=1;continue;}
          if(exact.length>1){ambiguous+=1;ambiguousMatches.push({competition:candidate.competition,
            season:candidate.season,kickoffAt:candidate.kickoffAt,reason:'MULTIPLE_EXACT'});continue;}
          const possible=sameCompetition.filter(row=>{
            const difference=Math.abs(new Date(row.kickoff_at).getTime()-candidateKickoff);
            if(difference>30*60_000)return false;
            const homeSimilarity=Math.max(teamNameSimilarity(row.home_team,candidate.homeTeam),
              editSimilarity(normalizeTeamAlias(row.home_team),candidateHome));
            const awaySimilarity=Math.max(teamNameSimilarity(row.away_team,candidate.awayTeam),
              editSimilarity(normalizeTeamAlias(row.away_team),candidateAway));
            return homeSimilarity>=0.85&&awaySimilarity>=0.85;
          });
          if(possible.length){ambiguous+=1;ambiguousMatches.push({competition:candidate.competition,
            season:candidate.season,kickoffAt:candidate.kickoffAt,
            reason:possible.some(row=>canonicalSeason(row.season)!==canonicalSeason(candidate.season))
              ?'COMPETITION_SEASON_CONFLICT':'FUZZY_TEAM_OR_KICKOFF'});}
          }
        }
        const eligible=season.eligible;
        seasonSummary.push({competition:season.competition,season:season.season,source_candidates:season.discovered,eligible,
          existing_duplicate:duplicate,new_insertable:eligible-duplicate-ambiguous,ambiguous,
          invalid:season.invalid,errors:season.errors,inserted:0,imported:0});
      }
      competitionSummary.push({competition:competition.competition,source_candidates:seasonSummary.reduce((s,r)=>s+r.source_candidates,0),
        eligible:seasonSummary.reduce((s,r)=>s+r.eligible,0),existing_duplicate:seasonSummary.reduce((s,r)=>s+r.existing_duplicate,0),
        new_insertable:seasonSummary.reduce((s,r)=>s+r.new_insertable,0),ambiguous:seasonSummary.reduce((s,r)=>s+r.ambiguous,0),
        invalid:seasonSummary.reduce((s,r)=>s+r.invalid,0),seasons:seasonSummary});
    }
    const result={status:'RECONCILED' as const,production_before:{total_matches:Number(totals.rows[0]?.total_matches??0),
      finished:Number(totals.rows[0]?.finished??0),competition_counts:counts.rows.map(row=>({competition:row.competition,
        total_matches:Number(row.total_matches),finished:Number(row.finished)}))},
      source_summary:{source_candidates:competitionSummary.reduce((s,r)=>s+r.source_candidates,0),
        eligible:competitionSummary.reduce((s,r)=>s+r.eligible,0),invalid:competitionSummary.reduce((s,r)=>s+r.invalid,0)},
      competition_summary:competitionSummary,duplicate_summary:{existing_duplicate:competitionSummary.reduce((s,r)=>s+r.existing_duplicate,0),
        new_insertable:competitionSummary.reduce((s,r)=>s+r.new_insertable,0),ambiguous:competitionSummary.reduce((s,r)=>s+r.ambiguous,0)},
      ambiguous_matches:ambiguousMatches,safety_checks:{transactionReadOnly:true,insertUpdateDelete:0,oddsPredictionTablesTouched:false,
        maxSourceMatchesPerQuery:150,maximumDatabaseRowsPerQuery:2000,statementTimeoutMs:12000,
        kickoffCutoff:'2024-01-01T00:00:00.000Z',futureMatchesExcluded:true,duplicateRule:'provider identity, then exact competition/season/team/kickoff',
        fuzzyMatchesNeverCountedAsDuplicates:true}};
    await client.query('COMMIT');
    return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}
  finally{client.release();}
}
