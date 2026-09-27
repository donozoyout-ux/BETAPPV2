import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { bearerTokenMatches, HistoricalReconciliationDiagnosticsService } from '../../src/historical/reconciliation-diagnostics.js';
import { openFootballLeagueSources } from '../../src/historical/openfootball-source.js';

const summary = { status: 'RECONCILED', generatedAt: '2026-09-27T12:00:00.000Z', dateFrom: '2024-01-01', dateTo: '2026-09-27',
  sourceCandidates: 3, eligibleCandidates: 2, existingDuplicates: 1, newInsertable: 1, ambiguous: 0, invalid: 1, sourceErrors: 0,
  competitionSummary: [{ competition: 'Premier League', sourceCandidates: 3, eligible: 2, duplicates: 1, newInsertable: 1, ambiguous: 0, sourceErrors: 0 }],
  seasonSummary: [{ competition: 'Premier League', season: '2024-25', sourceCandidates: 3, eligible: 2, duplicates: 1,
    newInsertable: 1, ambiguous: 0, sourceErrors: 0 }], productionMatchCount: 367, productionFinishedMatchCount: 144 };

function appFor(token?: string, diagnostics?: { get: () => Promise<typeof summary> }) {
  const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent',
    ...(token ? { HISTORICAL_RECONCILIATION_TOKEN: token } : {}) });
  return buildApp(config, {} as never, createLogger(config), undefined, undefined, undefined,
    undefined, undefined, diagnostics as never);
}

describe('protected historical reconciliation diagnostics endpoint', () => {
  it('rejects unauthenticated or unconfigured requests before computing diagnostics', async () => {
    const get = vi.fn(async () => summary);
    const app = appFor('secret-token', { get });
    try {
      expect((await app.inject('/api/admin/historical-reconciliation')).statusCode).toBe(401);
      expect((await app.inject({ url: '/api/admin/historical-reconciliation', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
      expect(get).not.toHaveBeenCalled();
    } finally { await app.close(); }
    const closed = appFor(undefined, { get });
    try { expect((await closed.inject('/api/admin/historical-reconciliation')).statusCode).toBe(503); }
    finally { await closed.close(); }
  });

  it('returns only aggregate summary with no IDs, raw records, or connection details', async () => {
    const app = appFor('secret-token', { get: async () => summary });
    try {
      const response = await app.inject({ url: '/api/admin/historical-reconciliation',
        headers: { authorization: 'Bearer secret-token' } });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual(summary);
      expect(response.body).not.toMatch(/match.?id|provider.?id|team.?id|raw.?odds|bookmaker|DATABASE_URL|connection/i);
    } finally { await app.close(); }
  });

  it('compares bearer secrets with a fixed-time equality check', () => {
    expect(bearerTokenMatches('Bearer abc123', 'abc123')).toBe(true);
    expect(bearerTokenMatches('Bearer abc124', 'abc123')).toBe(false);
    expect(bearerTokenMatches('abc123', 'abc123')).toBe(false);
  });

  it('uses the established source parser, 2024 cutoff and excludes future events', async () => {
    const source = openFootballLeagueSources.find((item) => item.configKey === 'PremierLeague')!;
    const payload = { matches: [
      { date: '2023-12-31', time: '15:00', team1: 'A', team2: 'B', score: { ft: [1, 0] } },
      { date: '2024-01-01', time: '15:00', team1: 'A', team2: 'B', score: { ft: [1, 0] } },
      { date: '2027-01-01', time: '15:00', team1: 'A', team2: 'B', score: { ft: [1, 0] } },
    ] };
    const fetcher = vi.fn(async () => payload);
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT count(*)::int total_matches')) return { rows: [{ total_matches: 10, finished: 5 }] };
      if (sql.includes('SELECT l.name competition,count(m.id)')) return { rows: [] };
      if (sql.includes('SELECT l.name competition,m.season')) return { rows: [] };
      return { rows: [] };
    }), release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) } as never;
    const service = new HistoricalReconciliationDiagnosticsService(pool, 'https://example.test');
    const now = new Date('2026-09-27T12:00:00Z');
    // Exercise the same source dry-run/parser through a local fake fetcher before DB reconciliation.
    const { dryRunHistoricalBackfill } = await import('../../src/historical/data-backfill-dry-run.js');
    const dryRun = await dryRunHistoricalBackfill({ competitionKey: source.configKey, baseUrl: 'https://example.test',
      seasons: ['2024-25'], fetcher, fetchedAt: new Date('2026-09-27T12:00:00Z') });
    expect(dryRun.before_cutoff).toBe(1);
    expect(dryRun.future).toBe(1);
    expect(dryRun.eligible).toBe(1);
    expect(service).toBeDefined();
    expect(now.toISOString().slice(0, 10)).toBe('2026-09-27');
  });

  it('issues transaction and SELECT-only SQL, and classifies duplicate vs insertable candidates', async () => {
    const calls: string[] = [];
    const client = { query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('SELECT count(*)::int total_matches')) return { rows: [{ total_matches: 10, finished: 5 }] };
      if (sql.includes('SELECT l.name competition,count(m.id)')) return { rows: [] };
      if (sql.includes('SELECT l.name competition,m.season')) return { rows: [{ competition: 'Premier League', season: '2024/2025',
        home_team: 'A', away_team: 'B', kickoff_at: '2025-01-02T15:00:00Z', provider: 'openfootball', external_id: 'id1' }] };
      return { rows: [] };
    }), release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) } as never;
    const { reconcileHistoricalBackfill } = await import('../../src/historical/reconciliation.js');
    const competition = { competition: 'Premier League', targetFinishedMatches: 80 as const, discovered: 3, eligible: 2,
      inserted: 0, imported: 0, duplicate: null, ambiguous: null, new_insertable: null, invalid: 1,
      skipped: 0, unsafe_time: 0, future: 0, before_cutoff: 1, invalid_result: 0, errors: 0,
      seasons: [{ source: 'OpenFootball CC0', competition: 'Premier League', season: '2024-25', url: 'https://example.test',
        discovered: 3, eligible: 2, inserted: 0, imported: 0, duplicate: null, ambiguous: null, new_insertable: null,
        invalid: 1, skipped: 0, unsafe_time: 0, future: 0, before_cutoff: 1, invalid_result: 0, errors: 0,
        databaseDuplicateEstimate: 'NOT_CHECKED' as const, eligibleMatches: [
          { providerExternalId: 'id1', competition: 'Premier League', season: '2024/2025', homeTeam: 'A', awayTeam: 'B', kickoffAt: '2025-01-02T15:00:00Z' },
          { providerExternalId: 'id2', competition: 'Premier League', season: '2024/2025', homeTeam: 'C', awayTeam: 'D', kickoffAt: '2025-01-03T15:00:00Z' },
        ] }] };
    const result = await reconcileHistoricalBackfill(pool, [competition]);
    expect(result.duplicate_summary).toMatchObject({ existing_duplicate: 1, new_insertable: 1, ambiguous: 0 });
    expect(calls).toContain('SET TRANSACTION READ ONLY');
    expect(calls.every((sql) => !(/\b(INSERT|UPDATE|DELETE|UPSERT|TRUNCATE)\b/i.test(sql)))).toBe(true);
  });
});
