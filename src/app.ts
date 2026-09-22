import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import type { AppConfig } from './config.js';
import type { FootballRepository } from './db/repository.js';
import type { OddsAnalysisRepository } from './db/odds-analysis-repository.js';
import { renderCornerDetail, renderDashboard } from './dashboard.js';
import { renderMatchAnalysis } from './match-detail.js';
import type { Logger } from './logger.js';
import type { PredictionRepository } from './predictions/service.js';
import type { OddsIntelligenceRepository } from './odds-neighbors/repository.js';
import type { OddsIntelligence } from './odds-neighbors/types.js';
import { isCompetitionConfigured } from './matching/competition.js';

function oddsEvidence(analysis: OddsIntelligence | undefined): Record<string, unknown> | null {
  if (!analysis) return null;
  return { pastTwinsCount: analysis.pastTwins.length, evidenceStrength: analysis.evidenceStrength,
    oddsRouteStrength: analysis.oddsRoute.strength, oddsRouteDirection: analysis.oddsRoute.direction,
    resultMap: analysis.resultMap.slice(0, 4), explanatoryOnly: true };
}

function attachOddsEvidence(rows: Array<Record<string, unknown>>, analyses: OddsIntelligence[]) {
  const byMatch = new Map(analyses.map((analysis) => [analysis.match.id, analysis]));
  return rows.map((row) => {
    const matchId = String(row.match_id ?? row.matchId ?? '');
    const predictionGate = row.predictionGate;
    if (!predictionGate || typeof predictionGate !== 'object') return row;
    return { ...row, predictionGate: { ...(predictionGate as Record<string, unknown>),
      evidence: oddsEvidence(byMatch.get(matchId)) } };
  });
}

export function buildApp(config: AppConfig, repository: FootballRepository, logger: Logger,
  oddsAnalysis?: OddsAnalysisRepository, predictions?: PredictionRepository, oddsIntelligence?: OddsIntelligenceRepository) {
  const app = Fastify({ loggerInstance: logger });
  void app.register(helmet, { contentSecurityPolicy: false });

  const competitionAllowed = (row: Record<string, unknown>): boolean => {
    const league = row.league ?? row.competition;
    return league == null || isCompetitionConfigured(String(league), config.SUPPORTED_COMPETITIONS);
  };
  const activeRows = <T extends Record<string, unknown>>(rows: T[]): T[] => rows.filter(competitionAllowed);
  const intelligenceRows = (value: unknown): OddsIntelligence[] =>
    Array.isArray(value) ? value.filter((item): item is OddsIntelligence =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      && Boolean((item as OddsIntelligence).match)) : [];
  const activeIntelligence = (rows: OddsIntelligence[]): OddsIntelligence[] => rows.filter((item) =>
    isCompetitionConfigured(String(item.match?.league ?? ''), config.SUPPORTED_COMPETITIONS));
  const activeSimilarityRows = (rows: Array<Record<string, unknown>>) => rows.filter((item) => {
    const current = item.current;
    const league = current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>).league : null;
    return league == null || isCompetitionConfigured(String(league), config.SUPPORTED_COMPETITIONS);
  });

  const optionalDashboardSource = async <T>(source: string, task: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await task();
    } catch (error) {
      logger.warn({ err: error, source }, 'Optional dashboard source failed');
      return fallback;
    }
  };
  const emptyDashboardData = () => ({
    matches: [] as Array<Record<string, unknown>>,
    recentFinishedMatches: [] as Array<Record<string, unknown>>,
    archiveSummary: null as Record<string, unknown> | null,
    providers: [] as Array<Record<string, unknown>>,
    qualification: [] as Array<Record<string, unknown>>,
    cornerAnalyses: [] as Array<Record<string, unknown>>,
    oddsAnalyses: [] as Array<Record<string, unknown>>,
    datasetAudit: null as Record<string, unknown> | null,
    validation: null as Record<string, unknown> | null,
    backfill: [] as Array<Record<string, unknown>>,
    odds: [] as Array<Record<string, unknown>>,
  });
  const recordRows = (value: unknown): Array<Record<string, unknown>> =>
    Array.isArray(value) ? value.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];

  app.get('/health', async (_request, reply) => {
    const [database, operations] = await Promise.all([repository.databaseHealth(), repository.operationalHealth().catch(() => ({
      providers: {}, worker: { lastRun: null, lastSuccess: null }, backfill: { status: 'UNKNOWN' },
    }))]);
    const status = database.status === 'ok' ? 'ok' : 'degraded';
    if (status !== 'ok') logger.error({ database }, 'Health check failed');
    return reply.code(status === 'ok' ? 200 : 503).send({ app: 'UP', status, database, ...operations,
      timestamp: new Date().toISOString() });
  });

  app.get('/api/dashboard', async () => {
    const [data, today, previews, reviewCandidates, history, performance, selfAudit, segmentAudits, rootCauses, adaptiveProposals, oddsSimilarity, predictionDiagnostics, oddsIntelligenceData] = await Promise.all([
      optionalDashboardSource('repository.dashboardData', () => repository.dashboardData('Europe/Istanbul'), emptyDashboardData()),
      predictions ? optionalDashboardSource('predictions.today', () => predictions.today(), []) : [],
      predictions ? optionalDashboardSource('predictions.previews', () => predictions.previews(), []) : [],
      predictions ? optionalDashboardSource('predictions.reviewCandidates', () => predictions.reviewCandidates(), []) : [],
      predictions ? optionalDashboardSource('predictions.history', () => predictions.history(20), []) : [],
      predictions ? optionalDashboardSource('predictions.performance', () => predictions.performance(), null) : null,
      predictions ? optionalDashboardSource('predictions.latestSelfAudit', () => predictions.latestSelfAudit(), null) : null,
      predictions ? optionalDashboardSource('predictions.latestSegmentSelfAudits', () => predictions.latestSegmentSelfAudits(), []) : [],
      predictions ? optionalDashboardSource('predictions.latestRootCauseAudits', () => predictions.latestRootCauseAudits(), []) : [],
      predictions ? optionalDashboardSource('predictions.latestAdaptiveRuleProposals', () => predictions.latestAdaptiveRuleProposals(), []) : [],
      predictions ? optionalDashboardSource('predictions.oddsSimilarityShowcase', () => predictions.oddsSimilarityShowcase(4, 5), []) : [],
      predictions ? optionalDashboardSource('predictions.diagnostics', () => predictions.diagnostics(), null) : null,
      oddsIntelligence ? optionalDashboardSource('oddsIntelligence.upcoming', () => oddsIntelligence.upcoming(4), []) : [],
    ]);
    const activeOddsIntelligence = activeIntelligence(intelligenceRows(oddsIntelligenceData));
    return { ...data,
      matches: activeRows(recordRows(data.matches)), recentFinishedMatches: activeRows(recordRows(data.recentFinishedMatches)),
      odds: activeRows(recordRows(data.odds)), oddsAnalyses: activeRows(recordRows(data.oddsAnalyses)),
      supportedCompetitions: config.SUPPORTED_COMPETITIONS,
      predictions: attachOddsEvidence(activeRows(recordRows(today)), activeOddsIntelligence),
      predictionPreviews: attachOddsEvidence(activeRows(recordRows(previews)), activeOddsIntelligence),
      predictionReviewCandidates: attachOddsEvidence(activeRows(recordRows(reviewCandidates)), activeOddsIntelligence), predictionHistory: history,
      predictionPerformance: performance, predictionSelfAudit: selfAudit, predictionSelfAuditSegments: segmentAudits,
      predictionSelfAuditRootCauses: rootCauses, predictionAdaptiveRuleProposals: adaptiveProposals,
      oddsSimilarity: activeSimilarityRows(recordRows(oddsSimilarity)), predictionDiagnostics, oddsIntelligence: activeOddsIntelligence };
  });
  app.get('/api/odds/upcoming', async () => ({ odds: await repository.upcomingOdds(1000) }));
  app.get('/api/backfill/status', async () => repository.backfillStatus());
  app.get('/api/odds-analysis/upcoming', async () => ({ modelVersion: 'ODDS_V1',
    analyses: oddsAnalysis ? await oddsAnalysis.upcoming() : [] }));
  app.get('/api/odds-analysis/similarity', async () => ({
    modelVersion: 'PREDICTION_V1', maxCurrentMatches: 4, maxHistoricalMatchesPerCurrent: 5,
    matches: predictions ? await predictions.oddsSimilarityShowcase(4, 5) : [],
  }));
  app.get<{ Querystring: { mode?: 'CLOSEST_NEIGHBORS' | 'ODDS_BAND' } }>('/api/odds-intelligence/upcoming', async (request) => ({
    engineVersion: 'ODDS_NEIGHBOR_V2', executionAuthority: false, aiPredictionAuthority: false,
    analyses: oddsIntelligence ? await oddsIntelligence.upcoming(20, new Date(), request.query.mode === 'ODDS_BAND' ? 'ODDS_BAND' : 'CLOSEST_NEIGHBORS') : [],
  }));
  app.get<{ Querystring: { limit?: string } }>('/api/odds-intelligence/audit/history', async (request) => {
    const requested = Number(request.query.limit ?? 5000);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.trunc(requested) : 5000;
    return oddsIntelligence ? oddsIntelligence.historyAudit(limit) : {
      generatedAt: new Date(), scanLimit: limit, scannedMatches: 0, truncated: false,
      archive: { totalFinishedMatches: 0, matchesWithPreKickoffOdds: 0, finishedMatchOddsCoverage: 0,
        preKickoffSnapshots: 0, excludedPostKickoffSnapshots: 0, providers: [], earliestKickoff: null, latestKickoff: null },
      routeReadiness: { matchesWithRoute: 0, matchesWithMovementReadyRoute: 0, routes: 0, movementReadyRoutes: 0,
        scannedMatchRouteCoverage: 0, scannedMatchMovementCoverage: 0 },
      markets: [], competitionSeasons: [],
    };
  });
  app.get<{ Params: { matchId: string } }>('/api/odds-intelligence/:matchId', async (request) => {
    const analysis = oddsIntelligence ? await oddsIntelligence.byMatch(request.params.matchId) : null;
    return analysis ?? { matchId: request.params.matchId, status: 'NOT_GENERATED', analysis: null, executionAuthority: false, aiPredictionAuthority: false };
  });
  app.get<{ Params: { matchId: string } }>('/api/odds-analysis/:matchId', async (request) => {
    const analysis = oddsAnalysis ? await oddsAnalysis.byMatch(request.params.matchId) : null;
    return analysis ?? { matchId: request.params.matchId, status: 'NOT_GENERATED', analysis: null };
  });
  app.get('/api/predictions/today', async () => ({ predictions: predictions ? await predictions.today() : [] }));
  app.get('/api/predictions/previews', async () => ({ previews: predictions ? await predictions.previews() : [] }));
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/predictions/history', async (request) => ({
    history: predictions ? await predictions.history(Number(request.query.limit ?? 50), Number(request.query.offset ?? 0)) : [],
  }));
  app.get('/api/predictions/performance', async () => predictions ? predictions.performance() : {
    totalOfficialDecisions: 0, predictCount: 0, skipCount: 0, pending: 0, settled: 0,
  });
  app.get('/api/predictions/diagnostics', async () => predictions ? predictions.diagnostics() : {
    modelVersion: 'PREDICTION_V1', historical: { total: 0, eligible: 0, byMarket: [] },
    current: { targets: 0, withOddsAnalysis: 0, predictionRuns: 0, predictRuns: 0, skipRuns: 0,
      runsWithHistoricalEvidence: 0, maximumHistoricalSettledSample: 0, topSkipReasons: [], sampleRuns: [] },
  });
  app.get('/api/predictions/self-audit', async () => predictions ? (await predictions.latestSelfAudit() ?? {
    status: 'NOT_AVAILABLE', reasons: ['SELF_AUDIT_NOT_RUN'],
  }) : { status: 'NOT_AVAILABLE', reasons: ['SELF_AUDIT_NOT_CONFIGURED'] });
  app.get('/api/predictions/self-audit/segments', async () => ({
    version: 'SELF_AUDIT_V2', segments: predictions ? await predictions.latestSegmentSelfAudits() : [],
  }));
  app.get('/api/predictions/self-audit/root-causes', async () => ({
    version: 'SELF_AUDIT_V3', diagnosticOnly: true,
    factors: predictions ? await predictions.latestRootCauseAudits() : [],
  }));
  app.get('/api/predictions/self-audit/proposals', async () => ({
    version: 'SELF_AUDIT_V4', autoApply: false, executionAuthority: false,
    proposals: predictions ? await predictions.latestAdaptiveRuleProposals() : [],
  }));
  app.get<{ Params: { matchId: string } }>('/api/predictions/:matchId/gates', async (request, reply) => {
    const [result, intelligence] = await Promise.all([predictions ? predictions.gates(request.params.matchId) : null,
      oddsIntelligence ? oddsIntelligence.byMatch(request.params.matchId) : null]);
    if (!result) return reply.code(404).send({ error: 'match_not_found' });
    return { ...result, evidence: oddsEvidence(intelligence ?? undefined) };
  });
  app.get<{ Params: { matchId: string } }>('/api/predictions/:matchId', async (request) => predictions
    ? predictions.detail(request.params.matchId) : { matchId: request.params.matchId, state: 'NOT_GENERATED', journal: null, runs: [] });
  app.get('/', async (_request, reply) => {
    const [data, today, previews, reviewCandidates, history, performance, selfAudit, segmentAudits, rootCauses, adaptiveProposals, oddsSimilarity, predictionDiagnostics, oddsIntelligenceData] = await Promise.all([
      optionalDashboardSource('repository.dashboardData', () => repository.dashboardData('Europe/Istanbul'), emptyDashboardData()),
      predictions ? optionalDashboardSource('predictions.today', () => predictions.today(), []) : [],
      predictions ? optionalDashboardSource('predictions.previews', () => predictions.previews(), []) : [],
      predictions ? optionalDashboardSource('predictions.reviewCandidates', () => predictions.reviewCandidates(), []) : [],
      predictions ? optionalDashboardSource('predictions.history', () => predictions.history(20), []) : [],
      predictions ? optionalDashboardSource('predictions.performance', () => predictions.performance(), null) : null,
      predictions ? optionalDashboardSource('predictions.latestSelfAudit', () => predictions.latestSelfAudit(), null) : null,
      predictions ? optionalDashboardSource('predictions.latestSegmentSelfAudits', () => predictions.latestSegmentSelfAudits(), []) : [],
      predictions ? optionalDashboardSource('predictions.latestRootCauseAudits', () => predictions.latestRootCauseAudits(), []) : [],
      predictions ? optionalDashboardSource('predictions.latestAdaptiveRuleProposals', () => predictions.latestAdaptiveRuleProposals(), []) : [],
      predictions ? optionalDashboardSource('predictions.oddsSimilarityShowcase', () => predictions.oddsSimilarityShowcase(4, 5), []) : [],
      predictions ? optionalDashboardSource('predictions.diagnostics', () => predictions.diagnostics(), null) : null,
      oddsIntelligence ? optionalDashboardSource('oddsIntelligence.upcoming', () => oddsIntelligence.upcoming(4), []) : [],
    ]);
    const activeOddsIntelligence = activeIntelligence(intelligenceRows(oddsIntelligenceData));
    const dashboardPayload = { ...data,
      matches: activeRows(recordRows(data.matches)), recentFinishedMatches: activeRows(recordRows(data.recentFinishedMatches)),
      odds: activeRows(recordRows(data.odds)), oddsAnalyses: activeRows(recordRows(data.oddsAnalyses)),
      supportedCompetitions: config.SUPPORTED_COMPETITIONS,
      predictions: attachOddsEvidence(activeRows(recordRows(today)), activeOddsIntelligence),
      predictionPreviews: attachOddsEvidence(activeRows(recordRows(previews)), activeOddsIntelligence),
      predictionReviewCandidates: attachOddsEvidence(activeRows(recordRows(reviewCandidates)), activeOddsIntelligence), predictionHistory: history, predictionPerformance: performance,
      predictionSelfAudit: selfAudit, predictionSelfAuditSegments: segmentAudits,
      predictionSelfAuditRootCauses: rootCauses, predictionAdaptiveRuleProposals: adaptiveProposals,
      oddsSimilarity: activeSimilarityRows(recordRows(oddsSimilarity)), predictionDiagnostics, oddsIntelligence: activeOddsIntelligence };
    try {
      return reply.type('text/html; charset=utf-8').send(renderDashboard(dashboardPayload));
    } catch (error) {
      logger.error({ err: error }, 'Dashboard renderer failed; serving degraded shell');
      return reply.type('text/html; charset=utf-8').send(renderDashboard({
        ...emptyDashboardData(), supportedCompetitions: config.SUPPORTED_COMPETITIONS,
      }));
    }
  });
  app.get<{ Params: { matchId: string } }>('/matches/:matchId', async (request, reply) => {
    const matchId = request.params.matchId;
    const match = await repository.matchAnalysisDetail(matchId);
    if (!match) return reply.code(404).send({ error: 'match_not_found' });
    const [predictionGate, predictionDetail, oddsAnalysisDetail, oddsIntelligenceDetail, cornerAnalysis] = await Promise.all([
      predictions ? predictions.gates(matchId).catch(() => null) : null,
      predictions ? predictions.detail(matchId).catch(() => null) : null,
      oddsAnalysis ? oddsAnalysis.byMatch(matchId).catch(() => null) : null,
      oddsIntelligence ? oddsIntelligence.byMatch(matchId).catch(() => null) : null,
      repository.cornerAnalysisDetail(matchId).catch(() => null),
    ]);
    return reply.type('text/html; charset=utf-8').send(renderMatchAnalysis({ match,
      predictionGate: predictionGate as Record<string, unknown> | null,
      predictionDetail: predictionDetail as Record<string, unknown> | null,
      oddsAnalysis: oddsAnalysisDetail as Record<string, unknown> | null,
      oddsIntelligence: oddsIntelligenceDetail as unknown as Record<string, unknown> | null,
      cornerAnalysis: cornerAnalysis as Record<string, unknown> | null }));
  });
  app.get<{ Params: { matchId: string } }>('/matches/:matchId/corners', async (request, reply) => {
    const detail = await repository.cornerAnalysisDetail(request.params.matchId);
    if (!detail) return reply.code(404).send({ error: 'corner_analysis_not_found' });
    return reply.type('text/html; charset=utf-8').send(renderCornerDetail(detail));
  });

  app.setErrorHandler((error, _request, reply) => {
    logger.error({ err: error }, 'Request failed');
    void reply.code(500).send({ error: 'internal_server_error' });
  });
  return app;
}
