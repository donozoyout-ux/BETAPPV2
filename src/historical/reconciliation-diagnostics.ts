import { timingSafeEqual } from 'node:crypto';
import type { DatabasePool } from '../db/pool.js';
import { dryRunHistoricalBackfill, initialBackfillCompetitions } from './data-backfill-dry-run.js';
import { reconcileHistoricalBackfill } from './reconciliation.js';

const SEASONS = ['2024-25', '2025-26', '2026-27'] as const;
const CACHE_MS = 10 * 60_000;
const SOURCE_TIMEOUT_MS = 8_000;

export type HistoricalReconciliationSummary = {
  status: string;
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  sourceCandidates: number;
  eligibleCandidates: number;
  existingDuplicates: number;
  newInsertable: number;
  ambiguous: number;
  invalid: number;
  sourceErrors: number;
  competitionSummary: Array<{ competition: string; sourceCandidates: number; eligible: number;
    duplicates: number; newInsertable: number; ambiguous: number; sourceErrors: number }>;
  seasonSummary: Array<{ competition: string; season: string; sourceCandidates: number; eligible: number;
    duplicates: number; newInsertable: number; ambiguous: number; sourceErrors: number }>;
  productionMatchCount: number;
  productionFinishedMatchCount: number;
};

export function bearerTokenMatches(header: string | undefined, expected: string | undefined): boolean {
  if (!header || !expected?.trim()) return false;
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  if (!match) return false;
  const provided = Buffer.from(match[1]!);
  const configured = Buffer.from(expected.trim());
  return provided.length === configured.length && timingSafeEqual(provided, configured);
}

export class HistoricalReconciliationDiagnosticsService {
  private cached: { expiresAt: number; value: HistoricalReconciliationSummary } | null = null;
  private inFlight: Promise<HistoricalReconciliationSummary> | null = null;

  constructor(private readonly pool: DatabasePool, private readonly baseUrl =
    'https://raw.githubusercontent.com/openfootball/football.json/master') {}

  get(now = new Date()): Promise<HistoricalReconciliationSummary> {
    if (this.cached && this.cached.expiresAt > Date.now()) return Promise.resolve(this.cached.value);
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.compute(now).then((value) => {
      this.cached = { expiresAt: Date.now() + CACHE_MS, value };
      return value;
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async compute(now: Date): Promise<HistoricalReconciliationSummary> {
    const dateFrom = '2024-01-01';
    const dateTo = now.toISOString().slice(0, 10);
    const fetcher = async (url: string): Promise<unknown> => {
      const response = await fetch(url, { headers: { 'user-agent': 'BETAPPV2/2.0 reconciliation-diagnostic' },
        signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`OPENFOOTBALL_HTTP_${response.status}`);
      return response.json() as Promise<unknown>;
    };
    const competitions = await Promise.all(initialBackfillCompetitions.map(({ configKey }) =>
      dryRunHistoricalBackfill({ competitionKey: configKey, baseUrl: this.baseUrl, seasons: SEASONS,
        fetcher, fetchedAt: now })));
    const reconciliation = await reconcileHistoricalBackfill(this.pool, competitions);
    const competitionSummary = reconciliation.competition_summary.map((row) => ({ competition: row.competition,
      sourceCandidates: row.source_candidates, eligible: row.eligible, duplicates: row.existing_duplicate,
      newInsertable: row.new_insertable, ambiguous: row.ambiguous,
      sourceErrors: row.seasons.reduce((sum, season) => sum + season.errors, 0) }));
    const seasonSummary = reconciliation.competition_summary.flatMap((row) => row.seasons.map((season) => ({
      competition: season.competition, season: season.season, sourceCandidates: season.source_candidates,
      eligible: season.eligible, duplicates: season.existing_duplicate, newInsertable: season.new_insertable,
      ambiguous: season.ambiguous, sourceErrors: season.errors,
    })));
    const sourceErrors = reconciliation.competition_summary.reduce((sum, row) =>
      sum + row.seasons.reduce((seasonSum, season) => seasonSum + season.errors, 0), 0);
    return { status: sourceErrors > 0 ? 'PARTIAL' : reconciliation.status, generatedAt: now.toISOString(), dateFrom, dateTo,
      sourceCandidates: reconciliation.source_summary.source_candidates,
      eligibleCandidates: reconciliation.source_summary.eligible,
      existingDuplicates: reconciliation.duplicate_summary.existing_duplicate,
      newInsertable: reconciliation.duplicate_summary.new_insertable,
      ambiguous: reconciliation.duplicate_summary.ambiguous,
      invalid: reconciliation.source_summary.invalid, sourceErrors, competitionSummary, seasonSummary,
      productionMatchCount: reconciliation.production_before.total_matches,
      productionFinishedMatchCount: reconciliation.production_before.finished };
  }
}
