import { createHash } from 'node:crypto';
import type { DatabasePool } from '../db/pool.js';
import { kickoffConfidence, normalizeTeamAlias } from '../matching/team-alias.js';
import type { NowgoalArchivedOddsValue } from '../providers/nowgoal.js';
import type {
  ArchivedOddsBackfillProgress,
  HistoricalArchivedFixture,
  HistoricalArchivedMatchResolution,
} from './types.js';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class HistoricalArchivedOddsRepository {
  constructor(private readonly pool: DatabasePool) {}

  async resolveHistoricalMatch(fixture: HistoricalArchivedFixture): Promise<HistoricalArchivedMatchResolution> {
    const mapped = await this.pool.query<{ internal_id: string }>(
      `SELECT internal_id FROM provider_entities
       WHERE provider='nowgoal' AND entity_type='match' AND external_id=$1`,
      [fixture.providerMatchId],
    );
    if (mapped.rows[0]) {
      return { status: 'MATCHED', matchId: mapped.rows[0].internal_id, confidence: 'PROVIDER_ID' };
    }

    const candidates = await this.pool.query<{
      id: string; kickoff_at: Date; home_team: string; away_team: string; league: string;
    }>(
      `SELECT m.id,m.kickoff_at,home.name home_team,away.name away_team,l.name league
       FROM matches m
       JOIN teams home ON home.id=m.home_team_id
       JOIN teams away ON away.id=m.away_team_id
       JOIN leagues l ON l.id=m.league_id
       WHERE m.status='finished'
         AND m.kickoff_at BETWEEN $1::timestamptz - interval '2 hours' AND $1::timestamptz + interval '2 hours'`,
      [fixture.kickoffAt],
    );

    const home = normalizeTeamAlias(fixture.homeTeam);
    const away = normalizeTeamAlias(fixture.awayTeam);
    const exactTeams = candidates.rows.filter((candidate) =>
      normalizeTeamAlias(candidate.home_team) === home
      && normalizeTeamAlias(candidate.away_team) === away
      && Math.abs(candidate.kickoff_at.getTime() - fixture.kickoffAt.getTime()) <= 30 * 60_000);

    if (exactTeams.length === 0) return { status: 'UNMATCHED' };
    if (exactTeams.length > 1) return { status: 'AMBIGUOUS', candidates: exactTeams.map((item) => item.id) };

    const candidate = exactTeams[0]!;
    const confidence = kickoffConfidence(candidate.kickoff_at, fixture.kickoffAt);
    if (!['EXACT','HIGH','MEDIUM'].includes(confidence)) return { status: 'UNMATCHED' };
    return { status: 'MATCHED', matchId: candidate.id, confidence };
  }

  async saveStates(
    matchId: string,
    fixture: HistoricalArchivedFixture,
    states: NowgoalArchivedOddsValue[],
    sourceDate: string,
    fetchedAt = new Date(),
  ): Promise<{ inserted: number; duplicates: number }> {
    const client = await this.pool.connect();
    let inserted = 0;
    let duplicates = 0;
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO provider_entities(provider,entity_type,external_id,internal_id,source_updated_at,first_seen_at,last_seen_at)
         VALUES('nowgoal','match',$1,$2,$3,now(),now())
         ON CONFLICT(provider,entity_type,external_id) DO UPDATE
         SET internal_id=excluded.internal_id,source_updated_at=excluded.source_updated_at,last_seen_at=now()`,
        [fixture.providerMatchId, matchId, fetchedAt],
      );

      for (const state of states) {
        const canonical = {
          provider: state.provider,
          providerMatchId: state.providerMatchId,
          marketType: state.marketType,
          marketName: state.marketName,
          line: state.line,
          selection: state.selection,
          oddsDecimal: state.oddsDecimal,
          stateGroup: state.stateGroup,
          sourceDate,
        };
        const provenance = {
          source: 'nowgoal',
          sourceDate,
          sourceFields: 'UpOdds/Goal/DownOdds',
          semanticBoundary: 'archived odds level only; no source timestamp; not opening or closing',
          routeEligible: false,
        };
        const result = await client.query(
          `INSERT INTO historical_archived_odds_states(
            match_id,source,provider,provider_match_id,market_type,market_name,line,selection,odds_decimal,
            state_group,source_date,source_observation_at,match_kickoff_at,fetched_at,raw_payload_hash,provenance)
           VALUES($1,'nowgoal',$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12,$13,$14::jsonb)
           ON CONFLICT DO NOTHING`,
          [matchId,state.provider,state.providerMatchId,state.marketType,state.marketName,state.line,state.selection,
            state.oddsDecimal,state.stateGroup,sourceDate,fixture.kickoffAt,fetchedAt,hash(canonical),JSON.stringify(provenance)],
        );
        if ((result.rowCount ?? 0) > 0) inserted += 1;
        else duplicates += 1;
      }
      await client.query('COMMIT');
      return { inserted, duplicates };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async startJob(source: string, fromDate: string, toDate: string) {
    const result = await this.pool.query<{ id: string; cursor_date: string | null }>(
      `INSERT INTO historical_odds_backfill_jobs(source,from_date,to_date,status)
       VALUES($1,$2,$3,'RUNNING')
       ON CONFLICT(source,from_date,to_date) DO UPDATE SET status='RUNNING',updated_at=now(),completed_at=NULL,last_error=NULL
       RETURNING id,cursor_date`,
      [source,fromDate,toDate],
    );
    return result.rows[0]!;
  }

  async updateJob(
    id: string,
    progress: ArchivedOddsBackfillProgress,
    status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'DRY_RUN',
    lastError: string | null = null,
  ) {
    await this.pool.query(
      `UPDATE historical_odds_backfill_jobs SET
        cursor_date=$2,status=$3,dates_requested=$4,fixtures_seen=$5,finished_fixtures=$6,
        matched=$7,unmatched=$8,ambiguous=$9,states_seen=$10,inserted=$11,duplicates=$12,
        errors=$13,last_error=$14,updated_at=now(),
        completed_at=CASE WHEN $3 IN('COMPLETED','FAILED','DRY_RUN') THEN now() ELSE NULL END
       WHERE id=$1`,
      [id,progress.cursorDate,status,progress.datesRequested,progress.fixturesSeen,progress.finishedFixtures,
        progress.matched,progress.unmatched,progress.ambiguous,progress.statesSeen,progress.inserted,
        progress.duplicates,progress.errors,lastError],
    );
  }

  async audit() {
    const totals = await this.pool.query(`SELECT
      count(*)::integer states,
      count(DISTINCT match_id)::integer matches,
      min(source_date) oldest_source_date,
      max(source_date) newest_source_date,
      count(DISTINCT provider)::integer providers
      FROM historical_archived_odds_states`);
    const markets = await this.pool.query(`SELECT market_type,market_name,line,selection,
      count(DISTINCT match_id)::integer matches,count(*)::integer states,
      count(DISTINCT provider)::integer bookmakers,
      avg(odds_decimal)::numeric average_odds
      FROM historical_archived_odds_states
      GROUP BY market_type,market_name,line,selection
      ORDER BY matches DESC,market_type,line NULLS FIRST,selection`);
    const jobs = await this.pool.query(`SELECT source,from_date,to_date,cursor_date,status,dates_requested,fixtures_seen,
      finished_fixtures,matched,unmatched,ambiguous,states_seen,inserted,duplicates,errors,last_error,
      started_at,updated_at,completed_at
      FROM historical_odds_backfill_jobs ORDER BY updated_at DESC LIMIT 10`);
    const row = totals.rows[0] ?? {};
    return {
      source: 'nowgoal',
      status: Number(row.states ?? 0) > 0 ? 'ARCHIVED_LEVEL_AVAILABLE' : 'EMPTY',
      semantics: 'ARCHIVED_ODDS_LEVEL_ONLY',
      routeEligible: false,
      openingClosingKnown: false,
      oldestImportedDate: row.oldest_source_date ?? null,
      newestImportedDate: row.newest_source_date ?? null,
      matches: Number(row.matches ?? 0),
      states: Number(row.states ?? 0),
      providers: Number(row.providers ?? 0),
      markets: markets.rows.map((item) => ({
        marketType: item.market_type,
        marketName: item.market_name,
        line: item.line == null ? null : Number(item.line),
        selection: item.selection,
        matches: Number(item.matches),
        states: Number(item.states),
        bookmakers: Number(item.bookmakers),
        averageOdds: Number(item.average_odds),
      })),
      jobs: jobs.rows,
    };
  }
}
