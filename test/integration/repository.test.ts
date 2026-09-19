import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationStatus, runMigrations } from '../../src/db/migrator.js';
import { createPool, type DatabasePool } from '../../src/db/pool.js';
import { FootballRepository } from '../../src/db/repository.js';
import { OddsRepository } from '../../src/db/odds-repository.js';
import { OddsAnalysisRepository } from '../../src/db/odds-analysis-repository.js';
import { CornerRepository } from '../../src/db/corner-repository.js';
import { configHash, cornerModelConfig } from '../../src/corners/config.js';
import { buildAllTeamProfiles } from '../../src/corners/profiles.js';
import { runBacktest } from '../../src/corners/backtest.js';

describe('FootballRepository integration', () => {
  let container: Awaited<ReturnType<PostgreSqlContainer['start']>> | undefined;
  let pool: DatabasePool;
  let repository: FootballRepository;
  let externalSchema: string | undefined;
  let basePool: DatabasePool | undefined;

  beforeAll(async () => {
    const dedicatedUrl = process.env.DB_TEST_DATABASE_URL;
    const schemaUrl = process.env.DB_TEST_SCHEMA ? process.env.DATABASE_URL : undefined;
    const externalUrl = dedicatedUrl ?? schemaUrl;
    if (externalUrl) {
      const databaseName = new URL(externalUrl).pathname.slice(1).toLowerCase();
      if (dedicatedUrl && !databaseName.includes('test')) throw new Error('DB_TEST_DATABASE_URL database name must contain "test"');
      externalSchema = process.env.DB_TEST_SCHEMA ?? 'betapp_test_integration';
      if (!/^betapp_test_[a-z0-9_]+$/.test(externalSchema)) {
        throw new Error('External integration tests require DB_TEST_SCHEMA starting with betapp_test_');
      }
      basePool = createPool({ DATABASE_URL: externalUrl, DATABASE_SSL: process.env.DATABASE_SSL === 'true' });
      await basePool.query(`CREATE SCHEMA IF NOT EXISTS "${externalSchema}"`);
      const url = new URL(externalUrl);
      url.searchParams.set('options', `-c search_path=${externalSchema}`);
      pool = createPool({ DATABASE_URL: url.toString(), DATABASE_SSL: process.env.DATABASE_SSL === 'true' });
    } else {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
      pool = createPool({ DATABASE_URL: container.getConnectionUri(), DATABASE_SSL: false });
    }
    await runMigrations(pool);
    repository = new FootballRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
    if (externalSchema && basePool) {
      await basePool.query(`DROP SCHEMA "${externalSchema}" CASCADE`);
      await basePool.end();
    }
    await container?.stop();
  });

  it('is idempotent and retains provider-independent IDs', async () => {
    const observedAt = new Date('2026-09-16T12:00:00Z');
    const raw = { source: 'fixture' };
    const match = {
      providerExternalId: 'm-1',
      league: { providerExternalId: 'l-17', name: 'Premier League', country: 'England', logoUrl: null, sourceUpdatedAt: observedAt, raw },
      homeTeam: { providerExternalId: 't-1', name: 'Home', shortName: null, country: 'England', logoUrl: null, sourceUpdatedAt: observedAt, raw },
      awayTeam: { providerExternalId: 't-2', name: 'Away', shortName: null, country: 'England', logoUrl: null, sourceUpdatedAt: observedAt, raw },
      kickoffAt: new Date('2026-09-16T18:00:00Z'),
      status: 'scheduled' as const,
      round: '1', season: '2026/27', homeScore: null, awayScore: null, sourceUpdatedAt: observedAt, raw,
    };
    const firstId = await repository.upsertMatch('sofascore', match);
    const finished = { ...match, status: 'finished' as const, homeScore: 2, awayScore: 1 };
    const secondId = await repository.upsertMatch('sofascore', finished);
    expect(secondId).toBe(firstId);
    const statistics = { matchProviderExternalId: 'm-1', sourceUpdatedAt: observedAt, raw: {},
      statistics: [{ key: 'corners', label: 'Corners', period: 'ALL', homeValue: 6, awayValue: 4 }] };
    await repository.upsertStatistics('sofascore', statistics);
    await new CornerRepository(pool).saveHistorical('sofascore', finished, statistics);
    const counts = await pool.query('SELECT (SELECT count(*) FROM matches) matches, (SELECT count(*) FROM teams) teams');
    expect(Number(counts.rows[0].matches)).toBe(1);
    expect(Number(counts.rows[0].teams)).toBe(2);
  });

  it('matches aliases across providers and retains changed odds snapshots', async () => {
    const observedAt = new Date('2026-09-16T12:00:00Z');
    const base = {
      league: { providerExternalId: '47', name: 'Premier League', country: 'England', logoUrl: null, sourceUpdatedAt: observedAt, raw: {} },
      kickoffAt: new Date('2026-09-18T19:00:00Z'), status: 'scheduled' as const, round: null, season: '2026/27',
      homeScore: null, awayScore: null, sourceUpdatedAt: observedAt, raw: {},
    };
    const sofaId = await repository.upsertMatch('sofascore', { ...base, providerExternalId: 'sofa-2',
      homeTeam: { providerExternalId: 'sofa-mu', name: 'Manchester United', shortName: null, country: 'England', logoUrl: null, sourceUpdatedAt: observedAt, raw: {} },
      awayTeam: { providerExternalId: 'sofa-che', name: 'Chelsea', shortName: null, country: 'England', logoUrl: null, sourceUpdatedAt: observedAt, raw: {} } });
    const fotmobId = await repository.upsertMatch('fotmob', { ...base, providerExternalId: 'fm-2',
      league: { ...base.league, providerExternalId: '47' },
      homeTeam: { providerExternalId: 'fm-mu', name: 'Man Utd FC', shortName: null, country: 'England', logoUrl: null, sourceUpdatedAt: observedAt, raw: {} },
      awayTeam: { providerExternalId: 'fm-che', name: 'Chelsea FC', shortName: null, country: 'England', logoUrl: null, sourceUpdatedAt: observedAt, raw: {} } });
    expect(fotmobId).toBe(sofaId);

    const odds = new OddsRepository(pool);
    const common = { provider: 'iddaa', providerMatchId: 'i-1', marketType: 'TOTAL_GOALS', marketName: '2.5 Alt/Üst',
      line: 2.5, selection: 'OVER', capturedAt: observedAt };
    expect(await odds.append(sofaId, { ...common, oddsDecimal: 1.94 })).toBe(true);
    expect(await odds.append(sofaId, { ...common, oddsDecimal: 1.94, capturedAt: new Date(observedAt.getTime() + 1000) })).toBe(false);
    expect(await odds.append(sofaId, { ...common, oddsDecimal: 1.84, capturedAt: new Date(observedAt.getTime() + 2000) })).toBe(true);
    const summary = await odds.summary(sofaId);
    expect(summary[0]).toMatchObject({ snapshot_count: '2' });
    expect(Number(summary[0].opening_odds)).toBe(1.94);
    expect(Number(summary[0].current_odds)).toBe(1.84);
    const oddsAnalysis = new OddsAnalysisRepository(pool);
    const firstAnalysis = await oddsAnalysis.analyzeAndSave(sofaId, new Date('2026-09-19T00:00:00Z'));
    const repeated = await oddsAnalysis.analyzeAndSave(sofaId, new Date('2026-09-19T00:00:00Z'));
    expect(firstAnalysis?.inserted).toBe(true);
    expect(repeated?.inserted).toBe(false);
    const analysisRuns = await pool.query('SELECT count(DISTINCT input_hash) inputs,count(*) runs FROM odds_analysis_runs WHERE match_id=$1', [sofaId]);
    expect(Number(analysisRuns.rows[0].inputs)).toBe(Number(analysisRuns.rows[0].runs));

    const cornerRepository = new CornerRepository(pool);
    const analysis = {
      expectedHomeCorners: 5.1, expectedAwayCorners: 4.2, expectedTotalCorners: 9.3,
      probabilities: { '8.5': { over: 0.58, under: 0.42 } }, distribution: 'POISSON' as const,
      dataQuality: { score: 80, status: 'GOOD' as const, analysisEligible: true, missingFields: [] },
      modelConfidence: 72, sample: { home: 10, away: 10, league: 100, h2h: 2 }, calculationDetails: {},
    };
    const hash = configHash(cornerModelConfig);
    await cornerRepository.saveAnalysis(sofaId, analysis, cornerModelConfig, hash);
    await cornerRepository.saveAnalysis(sofaId, analysis, cornerModelConfig, hash);
    const count = await pool.query('SELECT count(*) FROM corner_analyses WHERE match_id=$1', [sofaId]);
    expect(Number(count.rows[0].count)).toBe(1);
  });

  it('validates migrations, checkpoint, profiles, replay, rollback and advisory locks', async () => {
    const migrations = await migrationStatus(pool);
    expect(migrations.pendingMigrations).toEqual([]);
    expect(migrations.schemaVersion).toBe('005_odds_analysis_v1.sql');
    const health = await repository.databaseHealth();
    expect(health.status).toBe('ok');
    await repository.markStarted('fotmob', 'integration-checkpoint', { index: 0 });
    await repository.markSucceeded('fotmob', 'integration-checkpoint', { index: 7 });
    expect(await repository.getCheckpoint('fotmob', 'integration-checkpoint')).toMatchObject({ index: 7 });

    const rows = await pool.query(`SELECT h.*,l.name competition_name,ht.name home_team_name,at.name away_team_name
      FROM historical_match_stats h JOIN leagues l ON l.id=h.competition_id
      JOIN teams ht ON ht.id=h.home_team_id JOIN teams at ON at.id=h.away_team_id`);
    const history = rows.rows.map((row) => ({ matchId: row.match_id, competitionId: row.competition_id, season: row.season,
      kickoffAt: new Date(row.kickoff_at), homeTeamId: row.home_team_id, awayTeamId: row.away_team_id,
      homeGoals: Number(row.home_goals), awayGoals: Number(row.away_goals), homeCorners: Number(row.home_corners),
      awayCorners: Number(row.away_corners), firstHalfHomeCorners: null, firstHalfAwayCorners: null, homeXg: null, awayXg: null,
      homeShots: null, awayShots: null, homeShotsOnTarget: null, awayShotsOnTarget: null, homePossession: null, awayPossession: null,
      homeFouls: null, awayFouls: null, homeYellowCards: null, awayYellowCards: null, homeRedCards: null, awayRedCards: null,
      provider: row.provider, sourceTimestamp: new Date(row.source_timestamp), competitionName: row.competition_name,
      homeTeamName: row.home_team_name, awayTeamName: row.away_team_name }));
    const cornerRepository = new CornerRepository(pool);
    await cornerRepository.saveProfiles(buildAllTeamProfiles(history));
    expect(runBacktest(history, cornerModelConfig).chronologicalViolations).toBe(0);

    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query("INSERT INTO teams(name) VALUES('rollback-sentinel')");
    await client.query('ROLLBACK');
    client.release();
    expect(Number((await pool.query("SELECT count(*) FROM teams WHERE name='rollback-sentinel'")).rows[0].count)).toBe(0);
    const lock = await pool.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext('betapp-integration-lock')) locked");
    expect(lock.rows[0]?.locked).toBe(true);
    await pool.query("SELECT pg_advisory_unlock(hashtext('betapp-integration-lock'))");
  });
});
