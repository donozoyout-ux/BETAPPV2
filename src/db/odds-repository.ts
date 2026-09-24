import type { OddsFixture, NormalizedOdds } from '../domain/odds.js';
import { normalizeTeamAlias, teamNameSimilarity } from '../matching/team-alias.js';
import { competitionKey } from '../matching/competition.js';
import { OddsAnalysisRepository } from './odds-analysis-repository.js';
import type { DatabasePool } from './pool.js';

export function oddsChanged(previous: number | null, current: number): boolean {
  return previous === null || previous !== current;
}

export class OddsRepository {
  private readonly analysis: Pick<OddsAnalysisRepository, 'analyzeAndSave'>;

  constructor(
    private readonly pool: DatabasePool,
    private readonly onAnalysisError?: (error: unknown, matchId: string) => void,
    analysis?: Pick<OddsAnalysisRepository, 'analyzeAndSave'>,
  ) {
    this.analysis = analysis ?? new OddsAnalysisRepository(pool);
  }

  async resolveMatchDetailed(fixture: OddsFixture): Promise<{
    matchId: string | null; reason: 'MATCHED_EXACT' | 'MATCHED_ALIAS' | 'NO_CANDIDATE' | 'LEAGUE_MISMATCH' | 'TEAM_MISMATCH' | 'AMBIGUOUS' | 'KICKOFF_MISMATCH';
    homeSimilarity: number; awaySimilarity: number; kickoffMinutes: number | null;
  }> {
    const candidates = await this.pool.query<{ id: string; kickoff_at: Date; home_team: string; away_team: string; league: string }>(
      `SELECT m.id,m.kickoff_at,home.name home_team,away.name away_team,l.name league
       FROM matches m JOIN teams home ON home.id=m.home_team_id JOIN teams away ON away.id=m.away_team_id
       JOIN leagues l ON l.id=m.league_id
       WHERE m.kickoff_at BETWEEN $1::timestamptz - interval '2 hours' AND $1::timestamptz + interval '2 hours'
       AND m.status IN ('scheduled','live')`, [fixture.kickoffAt],
    );
    if (!candidates.rows.length) return { matchId: null, reason: 'NO_CANDIDATE', homeSimilarity: 0, awaySimilarity: 0, kickoffMinutes: null };

    const wantedLeague = fixture.leagueName ? competitionKey(fixture.leagueName) : null;
    const leagueCompatible = candidates.rows.filter((candidate) => !wantedLeague || competitionKey(candidate.league) === wantedLeague);
    if (wantedLeague && !leagueCompatible.length) {
      return { matchId: null, reason: 'LEAGUE_MISMATCH', homeSimilarity: 0, awaySimilarity: 0, kickoffMinutes: null };
    }
    const pool = leagueCompatible.length ? leagueCompatible : candidates.rows;
    const scored = pool.map((candidate) => {
      const homeSimilarity = teamNameSimilarity(candidate.home_team, fixture.homeTeam);
      const awaySimilarity = teamNameSimilarity(candidate.away_team, fixture.awayTeam);
      const kickoffMinutes = Math.abs(candidate.kickoff_at.getTime() - fixture.kickoffAt.getTime()) / 60_000;
      const exact = normalizeTeamAlias(candidate.home_team) === normalizeTeamAlias(fixture.homeTeam)
        && normalizeTeamAlias(candidate.away_team) === normalizeTeamAlias(fixture.awayTeam);
      const score = (homeSimilarity + awaySimilarity) / 2 - Math.min(kickoffMinutes, 120) / 600;
      return { candidate, homeSimilarity, awaySimilarity, kickoffMinutes, exact, score };
    }).sort((a, b) => b.score - a.score);

    const best = scored[0]!;
    if (best.kickoffMinutes > 45) return { matchId: null, reason: 'KICKOFF_MISMATCH',
      homeSimilarity: best.homeSimilarity, awaySimilarity: best.awaySimilarity, kickoffMinutes: best.kickoffMinutes };
    if (best.homeSimilarity < 0.86 || best.awaySimilarity < 0.86) return { matchId: null, reason: 'TEAM_MISMATCH',
      homeSimilarity: best.homeSimilarity, awaySimilarity: best.awaySimilarity, kickoffMinutes: best.kickoffMinutes };
    const second = scored[1];
    if (second && second.score >= best.score - 0.03 && second.homeSimilarity >= 0.86 && second.awaySimilarity >= 0.86) {
      return { matchId: null, reason: 'AMBIGUOUS', homeSimilarity: best.homeSimilarity,
        awaySimilarity: best.awaySimilarity, kickoffMinutes: best.kickoffMinutes };
    }
    return { matchId: best.candidate.id, reason: best.exact ? 'MATCHED_EXACT' : 'MATCHED_ALIAS',
      homeSimilarity: best.homeSimilarity, awaySimilarity: best.awaySimilarity, kickoffMinutes: best.kickoffMinutes };
  }

  async resolveMatch(fixture: OddsFixture): Promise<string | null> {
    return (await this.resolveMatchDetailed(fixture)).matchId;
  }

  async appendMany(matchId: string, oddsItems: NormalizedOdds[]): Promise<number> {
    const client = await this.pool.connect();
    let inserted = 0;
    try {
      await client.query('BEGIN');
      for (const odds of oddsItems) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [
          `${matchId}:${odds.provider}:${odds.marketType}:${odds.marketName}`,
          `${odds.line ?? 'null'}:${odds.selection}`,
        ]);
        const previous = await client.query<{ odds_decimal: string }>(
          `SELECT odds_decimal FROM odds_snapshots WHERE match_id=$1 AND provider=$2 AND market_type=$3
           AND market_name=$4 AND line IS NOT DISTINCT FROM $5 AND selection=$6 ORDER BY captured_at DESC LIMIT 1`,
          [matchId, odds.provider, odds.marketType, odds.marketName, odds.line, odds.selection],
        );
        if (!oddsChanged(previous.rows[0] ? Number(previous.rows[0].odds_decimal) : null, odds.oddsDecimal)) continue;
        const result = await client.query(
          `INSERT INTO odds_snapshots(match_id,provider,provider_match_id,market_type,market_name,line,selection,odds_decimal,captured_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
          [matchId, odds.provider, odds.providerMatchId, odds.marketType, odds.marketName, odds.line,
            odds.selection, odds.oddsDecimal, odds.capturedAt],
        );
        inserted += result.rowCount ?? 0;
      }
      await client.query('COMMIT');
      return inserted;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async append(matchId: string, odds: NormalizedOdds): Promise<boolean> {
    return (await this.appendMany(matchId, [odds])) === 1;
  }

  async appendManyAndAnalyze(matchId: string, oddsItems: NormalizedOdds[]): Promise<{
    inserted: number; analysisGenerated: boolean; analysisFailed: boolean;
  }> {
    const inserted = await this.appendMany(matchId, oddsItems);
    if (inserted === 0) return { inserted, analysisGenerated: false, analysisFailed: false };
    try {
      const result = await this.analysis.analyzeAndSave(matchId);
      return { inserted, analysisGenerated: result?.inserted === true, analysisFailed: false };
    } catch (error) {
      this.onAnalysisError?.(error, matchId);
      return { inserted, analysisGenerated: false, analysisFailed: true };
    }
  }

  async collectionStates(provider: string, matchIds: string[]) {
    if (!matchIds.length) return new Map<string, { lastAttemptAt: Date | null; lastSuccessAt: Date | null; snapshotsInserted: number }>();
    const result = await this.pool.query(`SELECT match_id,last_attempt_at,last_success_at,snapshots_inserted
      FROM odds_collection_state WHERE provider=$1 AND match_id=ANY($2::uuid[])`, [provider, matchIds]);
    return new Map(result.rows.map((row) => [String(row.match_id), {
      lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at) : null,
      lastSuccessAt: row.last_success_at ? new Date(row.last_success_at) : null,
      snapshotsInserted: Number(row.snapshots_inserted ?? 0),
    }]));
  }

  async markCollectionState(input: {
    provider: string; matchId: string; providerMatchId: string | null;
    status: 'SUCCESS' | 'NO_ODDS' | 'ERROR'; inserted: number; capturedAt?: Date | null; error?: unknown;
  }) {
    const error = input.error == null ? null : (input.error instanceof Error ? input.error.message : String(input.error)).slice(0, 1000);
    await this.pool.query(`INSERT INTO odds_collection_state(provider,match_id,provider_match_id,last_attempt_at,last_success_at,
      last_snapshot_at,attempts,snapshots_inserted,last_status,last_error)
      VALUES($1,$2,$3,now(),CASE WHEN $4='SUCCESS' THEN now() ELSE NULL END,$5,1,$6,$4,$7)
      ON CONFLICT(provider,match_id) DO UPDATE SET provider_match_id=excluded.provider_match_id,last_attempt_at=now(),
        last_success_at=CASE WHEN excluded.last_status='SUCCESS' THEN now() ELSE odds_collection_state.last_success_at END,
        last_snapshot_at=COALESCE(excluded.last_snapshot_at,odds_collection_state.last_snapshot_at),
        attempts=odds_collection_state.attempts+1,
        snapshots_inserted=odds_collection_state.snapshots_inserted+excluded.snapshots_inserted,
        last_status=excluded.last_status,last_error=excluded.last_error`,
    [input.provider,input.matchId,input.providerMatchId,input.status,input.capturedAt ?? null,input.inserted,error]);
  }

  async summary(matchId: string) {
    return (await this.pool.query('SELECT * FROM odds_summary WHERE match_id=$1', [matchId])).rows;
  }
}
