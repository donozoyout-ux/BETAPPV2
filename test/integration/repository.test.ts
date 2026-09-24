import { runCompetitionBackfill } from '../../src/historical/competition-backfill.js';
import { DataCoverageService } from '../../src/data/coverage.js';
import type { NormalizedMatch, MatchStatistics } from '../../src/domain/types.js';
import { LiveRepository } from '../../src/live/repository.js';
import type { SourceData } from '../../src/live/types.js';
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
import { HistoricalRepository } from '../../src/db/historical-repository.js';
import { OddsIntelligenceRepository } from '../../src/odds-neighbors/repository.js';

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
    await repository.upsertMatch('sofascore', { ...match, status: 'live', homeScore: 0, awayScore: 0 });
    expect(await repository.matchAnalysisDetail(firstId)).toMatchObject({ status: 'live', home_score: 0 });
    await repository.upsertMatch('sofascore', { ...match, status: 'live', homeScore: 1, awayScore: 0 });
    expect(await repository.matchAnalysisDetail(firstId)).toMatchObject({ status: 'live', home_score: 1 });
    const finished = { ...match, status: 'finished' as const, homeScore: 2, awayScore: 1 };
    const secondId = await repository.upsertMatch('sofascore', finished);
    expect(secondId).toBe(firstId);
    await repository.upsertMatch('sofascore', { ...match, status: 'live', homeScore: 0, awayScore: 0 });
    await repository.upsertMatch('sofascore', match);
    expect(await repository.matchAnalysisDetail(firstId)).toMatchObject({ status: 'finished', home_score: 2, away_score: 1 });
    const statistics = { matchProviderExternalId: 'm-1', sourceUpdatedAt: observedAt, raw: {},
      statistics: [{ key: 'corners', label: 'Corners', period: 'ALL', homeValue: 6, awayValue: 4 }] };
    await repository.upsertStatistics('sofascore', statistics);
    await new CornerRepository(pool).saveHistorical('sofascore', finished, statistics);
    const detail = await repository.matchAnalysisDetail(firstId);
    expect(detail).toMatchObject({ id: firstId, league: 'Premier League', home_team: 'Home', away_team: 'Away',
      status: 'finished', home_score: 2, away_score: 1 });
    expect(detail?.statistics).toEqual([expect.objectContaining({ stat_key: 'corners', label: 'Corners', provider: 'sofascore' })]);
    expect(detail?.odds).toEqual([]);
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

  it('preserves historical provenance, precedence, coverage and resumable job state', async () => {
    const observedAt = new Date('2026-09-17T12:00:00Z');
    const fixture = { providerExternalId: 'history-fm-1',
      league: { providerExternalId: '47', name: 'Premier League', country: 'England', logoUrl: null, sourceUpdatedAt: observedAt, raw: {} },
      homeTeam: { providerExternalId: 'history-home', name: 'Fenerbahçe', shortName: null, country: 'Türkiye', logoUrl: null, sourceUpdatedAt: observedAt, raw: {} },
      awayTeam: { providerExternalId: 'history-away', name: 'PSG', shortName: null, country: 'France', logoUrl: null, sourceUpdatedAt: observedAt, raw: {} },
      kickoffAt: new Date('2026-09-17T18:00:00Z'), status: 'finished' as const, round: null, season: '2025/26',
      homeScore: 2, awayScore: 1, sourceUpdatedAt: observedAt, raw: {} };
    await repository.upsertMatch('fotmob', fixture);
    const statistics = { matchProviderExternalId: fixture.providerExternalId, sourceUpdatedAt: observedAt, raw: { source: 'fotmob' }, statistics:
      ['corners','yellow_cards','total_shots','shots_on_target','fouls_committed','ball_possession','offsides','expected_goals']
        .map((key) => ({ key, label: key, period: 'ALL', homeValue: 4, awayValue: 3 })) };
    const historical = new HistoricalRepository(pool);
    expect((await historical.save('fotmob', fixture, statistics, observedAt, 'ref-1')).action).toBe('inserted');
    expect((await historical.save('fotmob', fixture, statistics, observedAt, 'ref-1')).action).toBe('updated');
    const provenance = await pool.query('SELECT count(*) FROM historical_stat_provenance WHERE provider=\'fotmob\'');
    expect(Number(provenance.rows[0]!.count)).toBe(1);
    const job = await historical.startJob('fotmob', '47', '2025/26', 1);
    await historical.updateJob(job.id, { requested: 1, received: 1, inserted: 1, updated: 0, duplicates: 0, errors: 0, cursor: { index: 1 } }, 'COMPLETED');
    const resumed = await historical.startJob('fotmob', '47', '2025/26', 1);
    expect(resumed.cursor).toMatchObject({ index: 1 });
    expect((await historical.coverageAudit()).find((row) => row.season === '2025/26')).toMatchObject({ results: 1, corners: 1, cards: 1, offsides: 1, referee: 1 });
  });

  it('validates migrations, checkpoint, profiles, replay, rollback and advisory locks', async () => {
    const migrations = await migrationStatus(pool);
    expect(migrations.pendingMigrations).toEqual([]);
    expect(migrations.schemaVersion).toBe('018_openfootball_import_v1.sql');
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
    const targetAnalysis = await new OddsAnalysisRepository(pool).analyzeAndSave(targetId, targetCurrent);
    expect(targetAnalysis?.inserted).toBe(true);
    const analysisOnlyGate = await predictionRepository.gates(targetId, new Date('2099-09-20T17:00:00Z'));
    expect(analysisOnlyGate).toMatchObject({ overallStatus: 'WAITING' });
    expect(analysisOnlyGate!.gates.find((gate) => gate.key === 'ODDS_ANALYSIS')).toMatchObject({ passed: true });
    expect(analysisOnlyGate!.blockers).toContain('PREDICTION_NOT_GENERATED');
    expect(analysisOnlyGate!.blockers).not.toContain('NO_ODDS_ANALYSIS');
    const noOddsId = await repository.upsertMatch('prediction-source',
      fixture('prediction-no-odds', new Date('2099-09-20T20:00:00Z'), 'scheduled', null, null));
    const noOddsGate = await predictionRepository.gates(noOddsId, new Date('2099-09-20T18:30:00Z'));
    expect(noOddsGate).toMatchObject({ overallStatus: 'WAITING' });
    expect(noOddsGate!.gates.find((gate) => gate.key === 'ODDS_ANALYSIS'))
      .toMatchObject({ passed: false, reasonCode: 'NO_ODDS_ANALYSIS' });
    expect(noOddsGate!.blockers).toContain('NO_ODDS_ANALYSIS');
    const loadedTargets = await predictionRepository.loadTargets('m.id=$1', [targetId]);
    expect(loadedTargets).toHaveLength(1);
    expect(loadedTargets[0]).toMatchObject({ matchId: targetId });
    expect(loadedTargets[0]!.oddsInputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(loadedTargets[0]!.oddsItems.length).toBeGreaterThan(0);
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
    const gateInspector = await predictionRepository.gates(targetId, new Date('2099-09-20T17:30:00Z'));
    expect(gateInspector).not.toBeNull();
    expect(gateInspector!.state).toBe('LOCKED_PREDICTION');
    expect(gateInspector!.thresholds).toMatchObject({ minimumHistoricalSample: 30, minimumPredictionScore: 70,
      minimumBookmakerCount: 3, minimumCompleteStateCount: 2, officialWindowStartMinutes: 90 });
    expect(gateInspector!.gates.map((gate) => gate.key)).toEqual(expect.arrayContaining([
      'ODDS_ANALYSIS','BOOKMAKERS','COMPLETE_STATES','MOVEMENT','HISTORICAL_SAMPLE','PREDICTION_SCORE',
      'OFFICIAL_WINDOW','SELF_AUDIT_GLOBAL','SELF_AUDIT_SEGMENT',
    ]));
    const similarityShowcase = await predictionRepository.oddsSimilarityShowcase(
      4, 5, new Date('2099-09-20T17:00:00Z'));
    expect(similarityShowcase).toHaveLength(1);
    expect(similarityShowcase[0]!.current).toMatchObject({
      matchId: targetId, homeTeam: 'prediction-target Home', awayTeam: 'prediction-target Away',
      marketType: 'MATCH_RESULT', marketName: '1X2', selection: 'HOME',
      state: 'LOCKED_PREDICTION', historicalSettledSampleSize: 1,
    });
    expect(similarityShowcase[0]!.matches).toHaveLength(1);
    expect(similarityShowcase[0]!.matches[0]).toMatchObject({
      matchId: historicalId, homeTeam: 'prediction-historical Home', awayTeam: 'prediction-historical Away',
      outcome: 'WIN', homeScore: 2, awayScore: 0, featureLeadMinutes: config.officialWindowStartMinutes,
    });
    expect(similarityShowcase[0]!.evidenceGap).toMatchObject({
      similarRate: 1, baselineRate: 1, gapPp: 0, baselineSampleSize: 1,
      baselineScope: 'GLOBAL_SUPPORTED_COMPETITIONS',
    });
    expect(similarityShowcase[0]!.resultMap).toEqual([]);

    // Similarity must not depend on passing the official prediction gate.
    // This second target has historical evidence, but the production N>=30 gate forces SKIP.
    const skipTargetKickoff = new Date('2099-09-20T19:00:00Z');
    const skipTargetId = await repository.upsertMatch('prediction-source',
      fixture('prediction-skip-target', skipTargetKickoff, 'scheduled', null, null));
    const skipLeague = await pool.query<{ league_id: string }>('SELECT league_id FROM matches WHERE id=$1', [skipTargetId]);
    const skipEvaluation = evaluatePrediction({
      matchId: skipTargetId, competitionId: skipLeague.rows[0]!.league_id, kickoffAt: skipTargetKickoff,
      oddsInputHash: 'prediction-skip-input', oddsItems: [targetItem],
    }, historical, new Date('2099-09-20T17:00:00Z'), predictionConfig);
    expect(skipEvaluation.decision).toBe('SKIP');
    expect(skipEvaluation.skipReasons).toContain('INSUFFICIENT_HISTORICAL_SAMPLE');
    await predictionRepository.saveRun(skipEvaluation, predictionConfig);
    const showcaseWithSkip = await predictionRepository.oddsSimilarityShowcase(
      4, 5, new Date('2099-09-20T17:00:00Z'));
    const skipSimilarity = showcaseWithSkip.find((item) => item.current.matchId === skipTargetId);
    expect(skipSimilarity?.current).toMatchObject({
      state: 'MATCH_ONLY', predictionDecision: 'SKIP', marketType: 'MATCH_RESULT',
      selection: 'HOME', historicalSettledSampleSize: 1,
    });
    expect(skipSimilarity?.current.skipReasons).toContain('INSUFFICIENT_HISTORICAL_SAMPLE');
    expect(skipSimilarity?.matches[0]).toMatchObject({ matchId: historicalId, outcome: 'WIN' });
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

    expect(await predictionRepository.runAdaptiveRuleProposals(config)).toEqual([]);
    expect(await predictionRepository.runAdaptiveRuleProposals(config)).toEqual([]);
    const adaptiveRuns = await pool.query<{ id: string; model_version: string; prediction_config_hash: string; config_hash: string }>(
      'SELECT id,model_version,prediction_config_hash,config_hash FROM prediction_adaptive_rule_runs');
    expect(adaptiveRuns.rows).toHaveLength(1);
    expect(Number((await pool.query('SELECT count(*) FROM prediction_adaptive_rule_proposals')).rows[0].count)).toBe(0);

    const adaptiveRun = adaptiveRuns.rows[0]!;
    await expect(pool.query('UPDATE prediction_adaptive_rule_runs SET proposal_count=99 WHERE id=$1', [adaptiveRun.id]))
      .rejects.toThrow(/immutable/);
    const olderRun = await pool.query<{ id: string }>(`INSERT INTO prediction_adaptive_rule_runs(
      audit_version,model_version,prediction_config_hash,config_hash,input_hash,evaluated_at,proposal_count)
      VALUES('SELF_AUDIT_V4',$1,$2,$3,'synthetic-older-run',now()-interval '1 day',1) RETURNING id`,
    [adaptiveRun.model_version,adaptiveRun.prediction_config_hash,adaptiveRun.config_hash]);
    const syntheticProposal = await pool.query<{ id: string }>(`INSERT INTO prediction_adaptive_rule_proposals(
      run_id,audit_version,model_version,prediction_config_hash,config_hash,input_hash,proposal_key,proposal_type,severity,
      title,conditions,suggested_change,evaluated_at,binary_sample_size,positive_rate,reference_paper_roi,
      baseline_binary_sample_size,baseline_positive_rate,baseline_reference_paper_roi,positive_rate_gap,
      reference_paper_roi_gap,interaction_positive_rate_gap,interaction_reference_paper_roi_gap,evidence_strength,
      proposal_score,reasons)
      VALUES($1,'SELF_AUDIT_V4',$2,$3,$4,'synthetic-input','PREDICTION_SCORE=70-74&BOOKMAKER_COUNT=3',
      'COMBINATION_GUARD','HIGH_RISK','Synthetic integration proposal',
      '[{"dimension":"PREDICTION_SCORE","bucketKey":"70-74","bucketLabel":"Prediction Score: 70-74"}]'::jsonb,
      '{"kind":"ADD_SKIP_RULE","operator":"ALL","autoApply":false,"executionAuthority":false}'::jsonb,
      now()-interval '1 day',15,0.20,-0.50,40,0.60,0.10,-0.40,-0.60,-0.10,-0.20,0.50,80,
      '["ADAPTIVE_COMBINATION_UNDERPERFORMANCE"]'::jsonb) RETURNING id`,
    [olderRun.rows[0]!.id,adaptiveRun.model_version,adaptiveRun.prediction_config_hash,adaptiveRun.config_hash]);
    const proposalId = syntheticProposal.rows[0]!.id;
    expect(await predictionRepository.latestAdaptiveRuleProposals(config)).toEqual([]);
    await expect(pool.query('UPDATE prediction_adaptive_rule_proposals SET title=\'mutated\' WHERE id=$1', [proposalId]))
      .rejects.toThrow(/immutable/);
    expect(await predictionRepository.decideAdaptiveRuleProposal(proposalId, 'APPROVED', 'integration approval'))
      .toMatchObject({ proposalId, decision: 'APPROVED', autoApply: false, executionAuthority: false });
    await expect(predictionRepository.decideAdaptiveRuleProposal(proposalId, 'REJECTED', null))
      .rejects.toThrow(/already decided/);
    const decisionId = (await pool.query<{ id: string }>(
      'SELECT id FROM prediction_adaptive_rule_decisions WHERE proposal_id=$1', [proposalId])).rows[0]!.id;
    await expect(pool.query('UPDATE prediction_adaptive_rule_decisions SET decision=\'REJECTED\' WHERE id=$1', [decisionId]))
      .rejects.toThrow(/immutable/);
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

  it('builds odds routes and result maps from real snapshot rows without Prediction V1 writes', async () => {
    const observedAt = new Date('2097-01-01T10:00:00Z');
    const historicalKickoff = new Date('2098-01-02T18:00:00Z'); const targetKickoff = new Date('2099-01-02T18:00:00Z');
    const fixture = (externalId: string, kickoffAt: Date, status: 'scheduled' | 'finished', homeScore: number | null, awayScore: number | null) => ({
      providerExternalId: externalId,
      league: { providerExternalId: '47', name: 'Premier League', country: 'England', logoUrl: null, sourceUpdatedAt: observedAt, raw: {} },
      homeTeam: { providerExternalId: `${externalId}-home`, name: `${externalId} Home`, shortName: null, country: 'Test', logoUrl: null, sourceUpdatedAt: observedAt, raw: {} },
      awayTeam: { providerExternalId: `${externalId}-away`, name: `${externalId} Away`, shortName: null, country: 'Test', logoUrl: null, sourceUpdatedAt: observedAt, raw: {} },
      kickoffAt, status, round: null, season: '2098/99', homeScore, awayScore, sourceUpdatedAt: observedAt, raw: {},
    });
    const historyFixture = fixture('neighbor-history', historicalKickoff, 'finished', 2, 1);
    const targetFixture = fixture('neighbor-target', targetKickoff, 'scheduled', null, null);
    const historyId = await repository.upsertMatch('fotmob', historyFixture); const targetId = await repository.upsertMatch('fotmob', targetFixture);
    await new HistoricalRepository(pool).save('fotmob', historyFixture, { matchProviderExternalId: historyFixture.providerExternalId, sourceUpdatedAt: observedAt,
      raw: {}, statistics: ['corners','yellow_cards','red_cards'].map((key) => ({ key, label: key, period: 'ALL', homeValue: 5, awayValue: 4 })) });
    const odds = new OddsRepository(pool);
    const appendMarket = async (matchId: string, providerMatchId: string, start: Date) => {
      for (const provider of ['nowgoal:neighbor-a','nowgoal:neighbor-b']) for (const [selection, opening, latest] of [['OVER',2.05,1.91],['UNDER',1.80,1.95]] as const) {
        await odds.append(matchId, { provider, providerMatchId, marketType: 'TOTAL_GOALS', marketName: 'Total Goals', line: 2.5, selection, oddsDecimal: opening, capturedAt: start });
        await odds.append(matchId, { provider, providerMatchId, marketType: 'TOTAL_GOALS', marketName: 'Total Goals', line: 2.5, selection, oddsDecimal: latest, capturedAt: new Date(start.getTime() + 60 * 60_000) });
      }
    };
    await appendMarket(historyId, 'neighbor-history', new Date('2098-01-01T10:00:00Z'));
    await appendMarket(targetId, 'neighbor-target', new Date('2099-01-01T10:00:00Z'));
    await odds.append(historyId, {
      provider: 'nowgoal:neighbor-a', providerMatchId: 'neighbor-history', marketType: 'TOTAL_GOALS',
      marketName: 'Total Goals', line: 2.5, selection: 'OVER', oddsDecimal: 1.70,
      capturedAt: new Date('2098-01-03T10:00:00Z'),
    });
    const oddsIntelligenceRepository = new OddsIntelligenceRepository(pool);
    const audit = await oddsIntelligenceRepository.historyAudit(1000);
    expect(audit.archive.matchesWithPreKickoffOdds).toBeGreaterThanOrEqual(1);
    expect(audit.archive.excludedPostKickoffSnapshots).toBeGreaterThanOrEqual(1);
    expect(audit.routeReadiness.matchesWithMovementReadyRoute).toBeGreaterThanOrEqual(1);
    expect(audit.markets.find((item) => item.marketType === 'TOTAL_GOALS' && item.line === 2.5 && item.selection === 'OVER'))
      .toMatchObject({ movementReadyRoutes: expect.any(Number) });
    const beforeJournal = Number((await pool.query('SELECT count(*) FROM prediction_journal')).rows[0]!.count);
    const intelligence = await oddsIntelligenceRepository.byMatch(targetId, new Date('2099-01-01T14:00:00Z'));
    expect(intelligence?.primaryMarket).toMatchObject({ marketType: 'TOTAL_GOALS', line: 2.5 });
    expect(intelligence?.oddsRoute.snapshots).toHaveLength(2);
    expect(intelligence?.pastTwins.map((item) => item.matchId)).toContain(historyId);
    expect(intelligence?.resultMap.find((item) => item.market === 'TOTAL_CORNERS' && item.line === 8.5 && item.selection === 'OVER'))
      .toMatchObject({ sampleSize: 1, positiveCount: 1 });
    expect(intelligence?.historicalNeighbors).toMatchObject({status:'INSUFFICIENT_DATA',sampleSize:1,sameLeagueCount:1,crossLeagueCount:0});
    expect(intelligence?.historicalNeighbors.neighbors[0]).toMatchObject({matchId:historyId,quality:'HIGH',sameLeague:true});
    expect(intelligence?.executionAuthority).toBe(false);
    expect(Number((await pool.query('SELECT count(*) FROM prediction_journal')).rows[0]!.count)).toBe(beforeJournal);
  });

  it('persists and deduplicates live events, freezes fresh conflicts and keeps finished terminal', async () => {
    const now = new Date();
    const team = (name: string) => ({ providerExternalId: `v2-${name}`, name, shortName: null, country: null, logoUrl: null, sourceUpdatedAt: now, raw: {} });
    const match = { providerExternalId: 'v2-live-fixture',
      league: { providerExternalId: '9806', name: 'UEFA Nations League A', country: null, logoUrl: null, sourceUpdatedAt: now, raw: {} },
      homeTeam: team('V2 Home'), awayTeam: team('V2 Away'), kickoffAt: now, status: 'live' as const,
      round: null, season: null, homeScore: 1, awayScore: 0, sourceUpdatedAt: now, raw: {} };
    const id = await repository.upsertMatch('fotmob', match);
    const live = new LiveRepository(pool);
    const data: SourceData = { snapshot: { provider: 'api-football', externalId: 'v2-secondary', status: 'live',
      phase: 'SECOND_HALF', homeScore: 2, awayScore: 0, minute: 67, addedTime: null, observedAt: now.toISOString() },
      events: [{ provider: 'api-football', providerEventId: null, matchId: id, type: 'GOAL', minute: 67, addedTime: null,
        teamSide: 'HOME', teamName: 'V2 Home', playerName: 'Scorer', assistName: null, detail: 'Normal Goal',
        scoreAfter: null, occurredAt: null, observedAt: now.toISOString(), raw: {} }], statistics: null, odds: null, detailsAt: now.toISOString() };
    await live.save(id, data); await live.save(id, data);
    expect(Number((await pool.query('SELECT count(*) FROM live_match_events WHERE match_id=$1', [id])).rows[0].count)).toBe(1);
    expect((await repository.matchAnalysisDetail(id))?.home_score).toBe(1);
    await repository.upsertMatch('fotmob', { ...match, homeScore: 3, sourceUpdatedAt: new Date(now.getTime()+1000) });
    expect((await repository.matchAnalysisDetail(id))?.home_score).toBe(1);
    // Both sources now agree on final state; then a new secondary live observation cannot regress it.
    await live.save(id, { ...data, snapshot: { ...data.snapshot, status: 'finished', homeScore: 3, observedAt: new Date(now.getTime()+2000).toISOString() } });
    await repository.upsertMatch('fotmob', { ...match, status: 'finished', homeScore: 3, sourceUpdatedAt: new Date(now.getTime()+3000) });
    await live.save(id, { ...data, snapshot: { ...data.snapshot, observedAt: new Date(now.getTime()+4000).toISOString() } });
    expect(await repository.matchAnalysisDetail(id)).toMatchObject({ status: 'finished', home_score: 3 });
    expect((await live.read(id))).toHaveLength(2);
  });

  it('backfills fixtures first, resumes failed details and reports real coverage without manufacturing odds', async () => {
    const observed = new Date('2026-09-24T00:00:00Z');
    const fixture = (externalId: string, day: number): NormalizedMatch => ({
      providerExternalId: externalId,
      league: { providerExternalId: '57', name: 'Eredivisie', country: 'Netherlands', logoUrl: null, sourceUpdatedAt: observed, raw: {} },
      homeTeam: { providerExternalId: 'expansion-home', name: 'Expansion Home', shortName: null, country: null, logoUrl: null, sourceUpdatedAt: observed, raw: {} },
      awayTeam: { providerExternalId: 'expansion-away', name: 'Expansion Away', shortName: null, country: null, logoUrl: null, sourceUpdatedAt: observed, raw: {} },
      kickoffAt: new Date(`2025-01-0${day}T18:00:00Z`), status: 'finished', season: '2025', round: null,
      homeScore: 2, awayScore: 1, sourceUpdatedAt: observed, raw: {},
    });
    const fixtures = [fixture('expansion-one',1), fixture('expansion-two',2), fixture('expansion-empty',3)];
    const historical = new HistoricalRepository(pool); const corners = new CornerRepository(pool);
    let failOnce = true; const requested: string[] = [];
    const provider = { getAvailableSeasons: async () => ['2025'], getSeasonFixtures: async () => fixtures,
      getMatchStatistics: async (id: string): Promise<MatchStatistics> => {
        // No match detail is requested until all three finished fixtures exist.
        expect(Number((await pool.query("SELECT count(*) FROM provider_entities WHERE provider='fotmob' AND entity_type='match' AND external_id LIKE 'expansion-%'")).rows[0].count)).toBe(3);
        requested.push(id);
        if (id === 'expansion-two' && failOnce) { failOnce = false; throw new Error('temporary detail failure'); }
        return { matchProviderExternalId:id, sourceUpdatedAt:observed, raw:{}, statistics: id === 'expansion-empty' ? [] : [
          { key:'corners', label:'Corners', period:'ALL', homeValue:5, awayValue:0 },
          { key:'total_shots', label:'Shots', period:'ALL', homeValue:10, awayValue:4 },
        ] };
      } };
    const deps = { provider, historical, corners, football:repository, pause:async () => undefined,
      refreshPipeline:async () => { await new PredictionRepository(pool,['Eredivisie']).refreshHistoricalIncremental(); } };
    const comp = { id:57, key:'Eredivisie', name:'Eredivisie' };
    const first = await runCompetitionBackfill(comp,{seasons:1,resume:false,dryRun:false},deps);
    expect(first).toMatchObject({status:'PARTIAL',matchesInserted:3,statisticsFailed:1,statisticsUnavailable:1,historicalExamplesGenerated:0});
    const resumed = await runCompetitionBackfill(comp,{seasons:1,resume:true,dryRun:false},deps);
    expect(resumed).toMatchObject({matchesInserted:3,statisticsFailed:0,statisticsSucceeded:2,oddsCoveredMatches:0,cornerStatsCoveredMatches:2});
    expect(requested).toEqual(['expansion-one','expansion-two','expansion-empty','expansion-two']);
    const report = await historical.expansionReport(57);
    expect(report?.completedAt).toBeTruthy();
    const coverage = await new DataCoverageService(pool,['Eredivisie','Allsvenskan']).get();
    expect(coverage.competitions[0]).toMatchObject({matches:3,finishedMatches:3,matchesWithStats:2,matchesWithCorners:2,matchesWithOdds:0,predictionHistoricalExamples:0});
    expect(coverage.competitions[1]).toMatchObject({matches:0,matchesWithStats:0});
    const empty = await pool.query("SELECT h.* FROM historical_match_stats h JOIN provider_entities p ON p.internal_id=h.match_id AND p.entity_type='match' WHERE p.external_id='expansion-empty'");
    expect(empty.rows[0]).toMatchObject({home_corners:null,away_corners:null,home_shots:null,home_xg:null});
    // A later sparse response cannot erase genuine existing evidence.
    const sparse: MatchStatistics = {matchProviderExternalId:'expansion-one',sourceUpdatedAt:observed,raw:{},statistics:[]};
    await corners.saveHistorical('fotmob',fixtures[0]!,sparse,true);
    await historical.save('fotmob',fixtures[0]!,sparse,new Date(),null,true);
    const preserved = (await pool.query("SELECT h.home_corners,h.away_corners FROM historical_match_stats h JOIN provider_entities p ON p.internal_id=h.match_id AND p.entity_type='match' WHERE p.external_id='expansion-one'")).rows[0];
    expect(Number(preserved.home_corners)).toBe(5); expect(Number(preserved.away_corners)).toBe(0);
    const repeated = await runCompetitionBackfill(comp,{seasons:1,resume:false,dryRun:false},deps);
    expect(repeated).toMatchObject({matchesInserted:0,duplicateMatchesPrevented:3,detailsSkipped:3});
  });


  it('lets OpenFootball map an existing historical match without overwriting core score or kickoff', async () => {
    const sourceAt=new Date('2026-09-24T12:00:00Z');
    const base:NormalizedMatch={
      providerExternalId:'core-protected-fotmob',
      league:{providerExternalId:'57',name:'Eredivisie',country:'Netherlands',logoUrl:null,sourceUpdatedAt:sourceAt,raw:{}},
      homeTeam:{providerExternalId:'core-home',name:'Core Home',shortName:null,country:'Netherlands',logoUrl:null,sourceUpdatedAt:sourceAt,raw:{}},
      awayTeam:{providerExternalId:'core-away',name:'Core Away',shortName:null,country:'Netherlands',logoUrl:null,sourceUpdatedAt:sourceAt,raw:{}},
      kickoffAt:new Date('2026-08-20T18:00:00Z'),status:'finished',season:'2026/2027',round:'1',
      homeScore:2,awayScore:1,sourceUpdatedAt:sourceAt,raw:{},
    };
    const id=await repository.upsertMatch('fotmob',base);
    const openFootball={...base,providerExternalId:'of-core-protected',
      league:{...base.league,providerExternalId:'openfootball:nl.1.json'},
      homeTeam:{...base.homeTeam,providerExternalId:'openfootball:nl:core-home'},
      awayTeam:{...base.awayTeam,providerExternalId:'openfootball:nl:core-away'},
      kickoffAt:new Date('2026-08-20T18:05:00Z'),homeScore:9,awayScore:9,sourceUpdatedAt:new Date('2026-09-25T12:00:00Z')};
    const mapped=await repository.upsertMatch('openfootball',openFootball,undefined,{preserveExistingCore:true});
    expect(mapped).toBe(id);
    expect(await repository.matchAnalysisDetail(id)).toMatchObject({
      kickoff_at:new Date('2026-08-20T18:00:00Z'),home_score:2,away_score:1,status:'finished',
    });
    const mapping=await pool.query("SELECT internal_id FROM provider_entities WHERE provider='openfootball' AND entity_type='match' AND external_id='of-core-protected'");
    expect(mapping.rows[0]?.internal_id).toBe(id);
  });

  it('matches senior national aliases across providers without merging a same-name club', async () => {
    const now = new Date();
    const team = (id: string,name: string) => ({providerExternalId:id,name,shortName:null,country:null,logoUrl:null,sourceUpdatedAt:now,raw:{}});
    const base: NormalizedMatch = {providerExternalId:'expansion-national',
      league:{providerExternalId:'77',name:'FIFA World Cup',country:null,logoUrl:null,sourceUpdatedAt:now,raw:{}},
      homeTeam:team('expansion-turkey','Turkey'),awayTeam:team('expansion-korea','Korea Republic'),
      kickoffAt:new Date('2025-08-01'),status:'finished',season:'2025',round:null,homeScore:1,awayScore:0,sourceUpdatedAt:now,raw:{}};
    const first = await repository.upsertMatch('fotmob',base);
    const second = await repository.upsertMatch('national-test',{...base,providerExternalId:'other-national',
      homeTeam:team('other-turkey','Türkiye'),awayTeam:team('other-korea','South Korea')});
    expect(second).toBe(first);
    const club = await repository.upsertMatch('fotmob',{...base,providerExternalId:'expansion-country-club',
      league:{...base.league,providerExternalId:'40',name:'Belgian Pro League'},homeTeam:team('country-club','Turkey FC')});
    const ids = await pool.query('SELECT id,home_team_id FROM matches WHERE id=ANY($1::uuid[])',[[first,club]]);
    expect(ids.rows[0].home_team_id).not.toBe(ids.rows[1].home_team_id);
  });

});
