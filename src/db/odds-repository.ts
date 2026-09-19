import type { OddsFixture, NormalizedOdds } from '../domain/odds.js';
import { normalizeTeamAlias } from '../matching/team-alias.js';
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

  async resolveMatch(fixture: OddsFixture): Promise<string | null> {
    const candidates = await this.pool.query<{ id: string; kickoff_at: Date; home_team: string; away_team: string }>(
      `SELECT m.id,m.kickoff_at,home.name home_team,away.name away_team
       FROM matches m JOIN teams home ON home.id=m.home_team_id JOIN teams away ON away.id=m.away_team_id
       WHERE m.kickoff_at BETWEEN $1::timestamptz - interval '2 hours' AND $1::timestamptz + interval '2 hours'
       AND m.status IN ('scheduled','live')`, [fixture.kickoffAt],
    );
    const home = normalizeTeamAlias(fixture.homeTeam);
    const away = normalizeTeamAlias(fixture.awayTeam);
    const exact = candidates.rows.filter((candidate) => normalizeTeamAlias(candidate.home_team) === home
      && normalizeTeamAlias(candidate.away_team) === away);
    if (exact.length !== 1) return null;
    const differenceMinutes = Math.abs(exact[0]!.kickoff_at.getTime() - fixture.kickoffAt.getTime()) / 60_000;
    return differenceMinutes <= 30 ? exact[0]!.id : null;
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

  async summary(matchId: string) {
    return (await this.pool.query('SELECT * FROM odds_summary WHERE match_id=$1', [matchId])).rows;
  }
}
