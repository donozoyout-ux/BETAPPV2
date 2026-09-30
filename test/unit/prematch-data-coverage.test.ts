import { describe, expect, it, vi } from 'vitest';
import { PrematchCoverageService } from '../../src/data/prematch-coverage.js';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';

const runtime = { nowgoalEnabled: true, nowgoalLiveOddsEnabled: true, providerConfigured: true,
  collectorInstantiated: true, collectorStarted: null };

describe('pre-match data coverage diagnostics', () => {
  it('returns only aggregate pipeline evidence and labels unavailable historical telemetry honestly', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('PREMATCH_FIXTURES')) return { rows: [{ total: 23, eligible: 23, with_odds: 8, with_odds_analysis: 4 }] };
      if (sql.includes('PREMATCH_ODDS */')) return { rows: [{ snapshots: 42, fixtures_with_snapshots: 8, fixtures_with_3_plus_bookmakers: 5, fixtures_with_complete_state: 4 }] };
      if (sql.includes('PREMATCH_ANALYSIS')) return { rows: [{ created: 4, failed: 0, missing: 19 }] };
      if (sql.includes('PREMATCH_PREDICTION')) return { rows: [{ candidates: 3, predict_runs: 0, locked_predictions: 0 }] };
      if (sql.includes('PREMATCH_HISTORICAL */')) return { rows: [{ max_sample: 19, avg_sample: '8.5', sample_30_count: 0, sample_20_plus_count: 0 }] };
      if (sql.includes('PREMATCH_DROP_REASONS')) return { rows: [{ reason: 'INSUFFICIENT_HISTORICAL_SAMPLE', count: 3 }] };
      if (sql.includes('PREMATCH_ACTIVITY')) return { rows: [{ selected_fixtures: 7, skipped_fixtures: 2, provider_requests: 7, snapshot_writes: 9, errors: 1 }] };
      if (sql.includes('PREMATCH_HISTORICAL_BY_COMPETITION')) return { rows: [{ competition: 'Test League', season: '2026-2027', finished_matches: 50, eligible_historical_matches: 19, supported_historical_matches: 24 }] };
      if (sql.includes('PREMATCH_CHECKPOINTS')) return { rows: [{ provider: 'nowgoal', scope: 'prematch-odds', collector_started: true }] };
      return { rows: [] };
    });
    const result = await new PrematchCoverageService({ query } as never).get(24, runtime);
    expect(result.fixtures).toEqual({ total: 23, eligible: 23, withOdds: 8, withOddsAnalysis: 4 });
    expect(result.historical).toMatchObject({ maxSample: 19, avgSample: 8.5, sample30Count: 0 });
    expect(result.dropReasons).toContainEqual({ reason: 'NO_ODDS_SNAPSHOT', count: 15 });
    expect(result.last24h).toMatchObject({ selectedFixtures: 7, snapshotWriteCount: 9, errors: 1,
      collectorCycles: null, httpStatusDistribution: null, httpStatusAvailability: 'NOT_PERSISTED_IN_COLLECTOR_STATE' });
    expect(JSON.stringify(result)).not.toMatch(/match_id|provider_match_id|odds_decimal|secret/i);
  });

  it('serves the prematch detail endpoint with a bounded 24-hour window and no HTML payload', async () => {
    const prematchCoverage = vi.fn(async (window: number, seenRuntime: unknown) => ({ version: 'PREMATCH_DATA_COVERAGE_V2', windowHours: window, runtime: seenRuntime, fixtures: { total: 0 } }));
    const repository = { prematchCoverage };
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/test', LOG_LEVEL: 'silent', NOWGOAL_ENABLED: 'false', NOWGOAL_LIVE_ODDS_ENABLED: 'true' });
    const app = buildApp(config, repository as never, createLogger(config));
    try {
      const response = await app.inject('/api/data-coverage?detail=prematch&window=24h');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ version: 'PREMATCH_DATA_COVERAGE_V2', windowHours: 24, runtime: { nowgoalEnabled: false, nowgoalLiveOddsEnabled: true } });
      expect(response.json().html).toBeUndefined();
      expect(prematchCoverage).toHaveBeenCalledWith(24, expect.objectContaining({ collectorInstantiated: false, collectorStarted: null }));
    } finally { await app.close(); }
  });
});
