import type { OddsFixture, NormalizedOdds } from '../domain/odds.js';
import { normalizeTeamAlias } from '../matching/team-alias.js';
import { normalizeOddsTeamAlias, safeOddsTokenMatch } from '../matching/odds-team.js';
import { isCompetitionConfigured } from '../matching/competition.js';
import { OddsAnalysisRepository } from './odds-analysis-repository.js';
import type { DatabasePool } from './pool.js';

export function oddsChanged(previous: number | null, current: number): boolean {
  return previous === null || previous !== current;
}

export type OddsMatchResolution = {
  matchId: string | null;
  status: 'EXACT' | 'ALIAS' | 'TOKEN_UNIQUE' | 'UNMATCHED' | 'AMBIGUOUS' | 'INACTIVE_COMPETITION';
  kickoffDifferenceMinutes: number | null;
  kickoffAt?: Date;
  reason: string;
  nearestCandidates: Array<{ homeTeam: string; awayTeam: string; league: string; kickoffDifferenceMinutes: number }>;
};

export class OddsRepository {
  private readonly analysis: Pick<OddsAnalysisRepository, 'analyzeAndSave'>;

  constructor(
    private readonly pool: DatabasePool,
    private readonly onAnalysisError?: (error: unknown, matchId: string) => void,
    analysis?: Pick<OddsAnalysisRepository, 'analyzeAndSave'>,
    private readonly supportedCompetitions?: readonly string[],
  ) {
    this.analysis = analysis ?? new OddsAnalysisRepository(pool);
  }

  async resolveMatch(fixture: OddsFixture): Promise<string | null> {
    return (await this.resolveMatchDetailed(fixture)).matchId;
  }

  async resolveMatchDetailed(fixture: OddsFixture): Promise<OddsMatchResolution> {
    const candidates = await this.pool.query<{ id: string; kickoff_at: Date; home_team: string; away_team: string; league: string }>(
      `SELECT m.id,m.kickoff_at,home.name home_team,away.name away_team,l.name league
       FROM matches m JOIN teams home ON home.id=m.home_team_id JOIN teams away ON away.id=m.away_team_id
       JOIN leagues l ON l.id=m.league_id
       WHERE m.kickoff_at BETWEEN $1::timestamptz - interval '2 hours' AND $1::timestamptz + interval '2 hours'
       AND m.status='scheduled' AND m.kickoff_at>now()`, [fixture.kickoffAt],
    );
    const difference = (row: typeof candidates.rows[number]) => Math.abs(new Date(row.kickoff_at).getTime() - fixture.kickoffAt.getTime()) / 60_000;
    const nearestCandidates = [...candidates.rows].sort((a,b) => difference(a)-difference(b)).slice(0,3)
      .map((row) => ({ homeTeam: row.home_team, awayTeam: row.away_team, league: row.league, kickoffDifferenceMinutes: difference(row) }));
    const result = (status: OddsMatchResolution['status'], reason: string): OddsMatchResolution => ({
      matchId: null, status, reason, kickoffDifferenceMinutes: null, nearestCandidates });
    const active = candidates.rows.filter((row) => this.supportedCompetitions === undefined
      || isCompetitionConfigured(row.league, this.supportedCompetitions));
    const tiers = [
      ['EXACT', (a: string,b: string) => normalizeTeamAlias(a) !== '' && normalizeTeamAlias(a) === normalizeTeamAlias(b)],
      ['ALIAS', (a: string,b: string) => normalizeOddsTeamAlias(a) !== '' && normalizeOddsTeamAlias(a) === normalizeOddsTeamAlias(b)],
      ['TOKEN_UNIQUE', safeOddsTokenMatch],
    ] as const;
    for (const [status, matches] of tiers) {
      const compatible = active.filter((row) => matches(row.home_team,fixture.homeTeam) && matches(row.away_team,fixture.awayTeam));
      const eligible = compatible.filter((row) => difference(row) <= 30);
      if (eligible.length > 1) return result('AMBIGUOUS','AMBIGUOUS');
      const row = eligible[0];
      if (row) return { ...result(status,status), matchId: row.id, kickoffAt: new Date(row.kickoff_at), kickoffDifferenceMinutes: difference(row) };
      if (compatible.length) return result('UNMATCHED','KICKOFF_MISMATCH');
    }
    if (candidates.rows.some((row) => !active.includes(row) && safeOddsTokenMatch(row.home_team,fixture.homeTeam)
      && safeOddsTokenMatch(row.away_team,fixture.awayTeam))) return result('INACTIVE_COMPETITION','INACTIVE_COMPETITION');
    return result('UNMATCHED', candidates.rows.length ? 'TEAM_MISMATCH' : 'NO_INTERNAL_CANDIDATE');
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
