import type { NormalizedOdds } from '../domain/odds.js';
import { OddsAnalysisRepository } from './odds-analysis-repository.js';
import type { DatabasePool } from './pool.js';

export function oddsChanged(previous: number | null, current: number): boolean {
  return previous === null || previous !== current;
}

export class OddsRepository {
  private readonly analysis: OddsAnalysisRepository;

  constructor(private readonly pool: DatabasePool, private readonly onAnalysisError?: (error: unknown) => void) {
    this.analysis = new OddsAnalysisRepository(pool);
  }

  async append(matchId: string, odds: NormalizedOdds): Promise<boolean> {
    return this.pool.connect().then(async (client) => {
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [
          `${matchId}:${odds.provider}:${odds.marketType}:${odds.marketName}`,
          `${odds.line ?? 'null'}:${odds.selection}`,
        ]);
        const previous = await client.query<{ odds_decimal: string }>(
          `SELECT odds_decimal FROM odds_snapshots WHERE match_id=$1 AND provider=$2 AND market_type=$3
           AND market_name=$4 AND line IS NOT DISTINCT FROM $5 AND selection=$6 ORDER BY captured_at DESC LIMIT 1`,
          [matchId, odds.provider, odds.marketType, odds.marketName, odds.line, odds.selection],
        );
        if (!oddsChanged(previous.rows[0] ? Number(previous.rows[0].odds_decimal) : null, odds.oddsDecimal)) {
          await client.query('COMMIT');
          return false;
        }
        await client.query(
          `INSERT INTO odds_snapshots(match_id,provider,provider_match_id,market_type,market_name,line,selection,odds_decimal,captured_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
          [matchId, odds.provider, odds.providerMatchId, odds.marketType, odds.marketName, odds.line,
            odds.selection, odds.oddsDecimal, odds.capturedAt],
        );
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async appendManyAndAnalyze(matchId: string, odds: NormalizedOdds[]): Promise<{ inserted: number; analyzed: boolean }> {
    let inserted = 0;
    for (const item of odds) if (await this.append(matchId, item)) inserted += 1;
    if (!inserted) return { inserted, analyzed: false };
    try {
      await this.analysis.analyzeAndSave(matchId);
      return { inserted, analyzed: true };
    } catch (error) {
      // The collected snapshots remain durable even when secondary analysis fails.
      this.onAnalysisError?.(error);
      return { inserted, analyzed: false };
    }
  }

  async summary(matchId: string) {
    return (await this.pool.query('SELECT * FROM odds_summary WHERE match_id=$1', [matchId])).rows;
  }
}
