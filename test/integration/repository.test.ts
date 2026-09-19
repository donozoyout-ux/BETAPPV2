import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationStatus, runMigrations } from '../../src/db/migrator.js';
import { createPool, type DatabasePool } from '../../src/db/pool.js';
import { compactPayloadForStorage, FootballRepository } from '../../src/db/repository.js';
import { OddsRepository } from '../../src/db/odds-repository.js';
import { OddsAnalysisRepository } from '../../src/db/odds-analysis-repository.js';
import { CornerRepository } from '../../src/db/corner-repository.js';
import { configHash, cornerModelConfig } from '../../src/corners/config.js';
import { buildAllTeamProfiles } from '../../src/corners/profiles.js';
import { runBacktest } from '../../src/corners/backtest.js';
import { predictionConfig } from '../../src/predictions/config.js';
import { evaluatePrediction } from '../../src/predictions/engine.js';
import { PredictionRepository } from '../../src/predictions/service.js';
import type { AnalysisItem } from '../../src/odds-analysis/types.js';

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
    const openingAt = new Date('2026-09-16T12:10:00Z');
    const currentAt = new Date('2026-09-16T12:20:00Z');
    const oneXTwo = ['HOME','DRAW','AWAY'].flatMap((selection, index) => [{ provider: 'nowgoal:pinnacle',
      providerMatchId: 'ng-1', marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection,
      oddsDecimal: [2.1,3.3,3.6][index]!, capturedAt: openingAt }, { provider: 'nowgoal:pinnacle',
      providerMatchId: 'ng-1', marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection,
      oddsDecimal: [1.85,3.5,4.2][index]!, capturedAt: currentAt }]);
    const automatic = await odds.appendManyAndAnalyze(sofaId, oneXTwo);
    expect(automatic).toMatchObject({ inserted: 6, analysisGenerated: true, analysisFailed: false });
    const unchanged = await odds.appendManyAndAnalyze(sofaId, oneXTwo.filter((item) => item.capturedAt === currentAt));
    expect(unchanged).toMatchObject({ inserted: 0, analysisGenerated: false, analysisFailed: false });
    const oddsAnalysis = new OddsAnalysisRepository(pool);
    const repeated = await oddsAnalysis.analyzeAndSave(sofaId, new Date('2026-09-19T00:00:00Z'));
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
    expect(migrations.schemaVersion).toBe('009_prediction_self_audit_v3.sql');
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

  it('persists an immutable prediction journal and idempotently settles it', async () => {
    const observedAt = new Date('2026-09-12T14:00:00Z');
    const historicalKickoff = new Date('2026-09-12T18:00:00Z');
    const targetKickoff = new Date('2099-09-20T18:00:00Z');
    const raw = {};
    const fixture = (externalId: string, kickoffAt: Date, status: 'scheduled' | 'finished', homeScore: number | null, awayScore: number | null) => ({
      providerExternalId: externalId,
      league: { providerExternalId: '17', name: 'Premier League', country: 'England', logoUrl: null, sourceUpdatedAt: observedAt, raw },
      homeTeam: { providerExternalId: `${externalId}-home`, name: `${externalId} Home`, shortName: null, country: 'Test', logoUrl: null, sourceUpdatedAt: observedAt, raw },
      awayTeam: { providerExternalId: `${externalId}-away`, name: `${externalId} Away`, shortName: null, country: 'Test', logoUrl: null, sourceUpdatedAt: observedAt, raw },
      kickoffAt, status, round: null, season: '2099', homeScore, awayScore, sourceUpdatedAt: observedAt, raw,
    });
    const historicalId = await repository.upsertMatch('prediction-source', fixture('prediction-historical', historicalKickoff, 'finished', 2, 0));
    const targetId = await repository.upsertMatch('prediction-source', fixture('prediction-target', targetKickoff, 'scheduled', null, null));
    const odds = new OddsRepository(pool);
    const selections = ['HOME', 'DRAW', 'AWAY'];
    for (const provider of ['nowgoal:one', 'nowgoal:two', 'nowgoal:three']) {
      for (const [index, selection] of selections.entries()) {
        await odds.append(historicalId, { provider, providerMatchId: `${provider}-history`, marketType: 'MATCH_RESULT', marketName: '1X2',
          line: null, selection, oddsDecimal: [2.1, 3.3, 3.6][index]!, capturedAt: observedAt });
        await odds.append(historicalId, { provider, providerMatchId: `${provider}-history`, marketType: 'MATCH_RESULT', marketName: '1X2',
          line: null, selection, oddsDecimal: [1.8, 3.5, 4.2][index]!, capturedAt: new Date(observedAt.getTime() + 60_000) });
      }
    }
    // A single-bookmaker total market is otherwise valid-looking but cannot
    // satisfy ODDS_V1's historical eligibility gate.
    for (const [selection, opening, current] of [['OVER', 2, 1.8], ['UNDER', 1.9, 2.1]] as const) {
      await odds.append(historicalId, { provider: 'nowgoal:thin', providerMatchId: 'thin-history', marketType: 'TOTAL_GOALS',
        marketName: 'Total Goals', line: 2.5, selection, oddsDecimal: opening, capturedAt: observedAt });
      await odds.append(historicalId, { provider: 'nowgoal:thin', providerMatchId: 'thin-history', marketType: 'TOTAL_GOALS',
        marketName: 'Total Goals', line: 2.5, selection, oddsDecimal: current, capturedAt: new Date(observedAt.getTime() + 60_000) });
    }
    const targetOpening = new Date(targetKickoff.getTime() - 100 * 60_000);
    const targetCurrent = new Date(targetKickoff.getTime() - 95 * 60_000);
    for (const provider of ['nowgoal:one', 'nowgoal:two', 'nowgoal:three']) {
      for (const [index, selection] of selections.entries()) {
        await odds.append(targetId, { provider, providerMatchId: `${provider}-target`, marketType: 'MATCH_RESULT', marketName: '1X2',
          line: null, selection, oddsDecimal: [2.1, 3.3, 3.6][index]!, capturedAt: targetOpening });
        await odds.append(targetId, { provider, providerMatchId: `${provider}-target`, marketType: 'MATCH_RESULT', marketName: '1X2',
          line: null, selection, oddsDecimal: [1.8, 3.5, 4.2][index]!, capturedAt: targetCurrent });
      }
    }
    const predictionRepository = new PredictionRepository(pool);
    const config = { ...predictionConfig, minimumHistoricalSample: 1, targetHistoricalSample: 1,
      minimumPredictionScore: 0, minimumDataQualityScore: 0, minimumConfidenceScore: 0,
      minimumBookmakerCount: 1, minimumCompleteStateCount: 1 };
    const backfill = await predictionRepository.refreshHistoricalIncremental(config);
    expect(backfill.insertedExamples).toBeGreaterThan(0);
    expect(backfill.rejectedIneligible).toBeGreaterThan(0);
    expect((await predictionRepository.refreshHistoricalIncremental(config)).insertedExamples).toBe(0);
    const historical = await predictionRepository.loadHistoricalExamples(targetKickoff);
    const historicalHome = historical.find((item) =>
      item.marketType === 'MATCH_RESULT' && item.marketName === '1X2' && item.selection === 'HOME');
    expect(historicalHome).toBeDefined();
    const league = await pool.query<{ league_id: string }>('SELECT league_id FROM matches WHERE id=$1', [targetId]);
    const targetItem: AnalysisItem = { marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'HOME',
      openingOdds: historicalHome!.openingOdds, currentOdds: historicalHome!.currentOdds,
      highestOdds: Math.max(historicalHome!.openingOdds, historicalHome!.currentOdds),
      lowestOdds: Math.min(historicalHome!.openingOdds, historicalHome!.currentOdds), snapshotCount: 6,
      openingFairProbability: historicalHome!.openingFairProbability,
      currentFairProbability: historicalHome!.currentFairProbability,
      probabilityDeltaPp: historicalHome!.probabilityDeltaPp,
      rawOddsMovementPercent: ((historicalHome!.currentOdds - historicalHome!.openingOdds) / historicalHome!.openingOdds) * 100,
      bookmakerCount: historicalHome!.bookmakerCount,
      completeStateBookmakerCount: historicalHome!.completeStateBookmakerCount,
      minimumCompleteStateCount: historicalHome!.minimumCompleteStateCount,
      agreeingBookmakerCount: historicalHome!.bookmakerCount, disagreeingBookmakerCount: 0,
      movementAgreementRatio: historicalHome!.movementAgreementRatio, probabilityDispersion: 0, oddsDispersion: 0,
      movementClass: historicalHome!.movementClass, score: historicalHome!.oddsAnalysisScore,
      scoreComponents: { movement: 30, agreement: 20, coverage: 20, freshness: 15, stability: 15 },
      dataQuality: { score: historicalHome!.dataQualityScore, grade: historicalHome!.dataQualityGrade,
        analysisEligible: true, warnings: [] },
      modelConfidence: { score: historicalHome!.confidenceScore, grade: historicalHome!.confidenceGrade },
      analysisEligible: true, reasons: [], warnings: [], modelMarketGapPp: null };
    const evaluation = evaluatePrediction({ matchId: targetId, competitionId: league.rows[0]!.league_id, kickoffAt: targetKickoff,
      oddsInputHash: 'prediction-integration-input', oddsItems: [targetItem] }, historical, new Date('2099-09-20T17:30:00Z'), config);
    expect(evaluation.decision).toBe('PREDICT');
    const runId = await predictionRepository.saveRun(evaluation, config);
    expect(await predictionRepository.lock(evaluation, runId, new Date('2099-09-20T16:00:00Z'), 120, config)).toBe(false);
    expect(await predictionRepository.lock(evaluation, runId, new Date('2099-09-20T18:00:00Z'), 0, config)).toBe(false);
    expect(await predictionRepository.lock(evaluation, runId, new Date('2099-09-20T17:30:00Z'), 30, config)).toBe(true);
    expect(await predictionRepository.lock(evaluation, runId, new Date('2099-09-20T17:31:00Z'), 29, config)).toBe(false);
    await expect(pool.query('UPDATE prediction_journal SET locked_at=now() WHERE match_id=$1', [targetId])).rejects.toThrow(/immutable/);
    await repository.upsertMatch('prediction-source', fixture('prediction-target', targetKickoff, 'finished', 2, 0));
    expect((await predictionRepository.settlePending()).settled).toBe(1);
    expect((await predictionRepository.settlePending()).settled).toBe(0);
    expect((await predictionRepository.refreshHistoricalIncremental(config)).insertedExamples).toBeGreaterThan(0);
    const settlement = await pool.query<{ id: string }>('SELECT id FROM prediction_settlements WHERE prediction_journal_id=(SELECT id FROM prediction_journal WHERE match_id=$1)', [targetId]);
    await expect(pool.query('UPDATE prediction_settlements SET outcome=\'LOSS\' WHERE id=$1', [settlement.rows[0]!.id])).rejects.toThrow(/immutable/);
    const performance = await predictionRepository.performance();
    expect(performance).toMatchObject({ predictCount: 1, settled: 1, win: 1 });
    const selfAudit = await predictionRepository.runSelfAudit(config);
    expect(selfAudit).toMatchObject({ status: 'INSUFFICIENT_DATA', settledSampleSize: 1, binarySampleSize: 1 });
    expect((await predictionRepository.latestSelfAudit(config))?.status).toBe('INSUFFICIENT_DATA');
    await predictionRepository.runSelfAudit(config);
    const auditCount = await pool.query('SELECT count(*)::integer count FROM prediction_self_audits');
    expect(auditCount.rows[0].count).toBe(1);
    const segments = await predictionRepository.runSegmentSelfAudit(config);
    expect(segments).toHaveLength(3);
    expect(segments.every((item) => item.status === 'INSUFFICIENT_DATA')).toBe(true);
    expect(new Set(segments.map((item) => item.scopeType))).toEqual(new Set(['MARKET','LEAGUE','LEAGUE_MARKET']));
    await predictionRepository.runSegmentSelfAudit(config);
    const segmentCount = await pool.query('SELECT count(*)::integer count FROM prediction_self_audit_segments');
    expect(segmentCount.rows[0].count).toBe(3);
    const rootCauses = await predictionRepository.runRootCauseAudit(config);
    expect(rootCauses).toHaveLength(7);
    expect(rootCauses.every((item) => item.status === 'INSUFFICIENT_DATA')).toBe(true);
    await predictionRepository.runRootCauseAudit(config);
    const factorCount = await pool.query('SELECT count(*)::integer count FROM prediction_self_audit_factors');
    expect(factorCount.rows[0].count).toBe(7);
  });

  it('stores compacted source payloads below the PostgreSQL jsonb size constraint', async () => {
    const raw = {
      h2h: {
        matches: Array.from({ length: 700 }, (_, i) => ({
          id: i,
          home: { id: `home-${i}`, name: `Bayern München ${i}` },
          away: { id: `away-${i}`, name: `Borussia Mönchengladbach ${i}` },
          stats: { possession: [61, 39], shots: [18, 9], corners: [8, 4], note: '"'.repeat(20) },
        })),
      },
    };
    const compact = compactPayloadForStorage(raw);
    await pool.query(
      `INSERT INTO source_payloads(provider,entity_type,external_id,payload_hash,payload,source_updated_at,content_type,parser_version)
       VALUES('fotmob','statistics','large-payload-regression','large-payload-regression',$1::jsonb,now(),'application/json','2')`,
      [JSON.stringify(compact)],
    );
    const result = await pool.query<{ bytes: number }>(
      `SELECT octet_length(payload::text)::integer bytes FROM source_payloads
       WHERE provider='fotmob' AND entity_type='statistics' AND external_id='large-payload-regression'`,
    );
    expect(result.rows[0]!.bytes).toBeLessThanOrEqual(65_536);
  });

});
