import { dataPoolCard, dataPoolScript } from './data/coverage-view.js';
import { liveResponseV2 } from './live/analysis-v2.js';
import type { ProviderHealth } from './live/types.js';
import { liveCard, livePollScript } from './live/view.js';
import { buildLiveRecommendation } from './live/recommendation.js';
import { liveRecommendationCard, liveRecommendationsPollScript } from './live/recommendation-view.js';
import { controlAuditCard, controlAuditPollScript } from './control-audit-view.js';
import type { ControlAuditService } from './control-audit.js';
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
  oddsAnalysis?: OddsAnalysisRepository, predictions?: PredictionRepository, oddsIntelligence?: OddsIntelligenceRepository,
  controlAudit?: ControlAuditService) {
  const app = Fastify({ loggerInstance: logger });
  void app.register(helmet, { contentSecurityPolicy: false });

  const competitionAllowed = (row: Record<string, unknown>): boolean => {
    const league = row.league ?? row.competition;
    return league == null || isCompetitionConfigured(String(league), config.SUPPORTED_COMPETITIONS);
  };
  const activeRows = <T extends Record<string, unknown>>(rows: T[]): T[] => rows.filter(competitionAllowed);
  const activeIntelligence = (rows: OddsIntelligence[]): OddsIntelligence[] => rows.filter((item) =>
    isCompetitionConfigured(String(item.match.league ?? ''), config.SUPPORTED_COMPETITIONS));
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

  const loadDashboardSourcesUncached = async () => {
    const data = await repository.dashboardData('Europe/Istanbul');

    const [today, previews, reviewCandidates] = await Promise.all([
      predictions ? optionalDashboardSource('predictions.today', () => predictions.today(), []) : [],
      predictions ? optionalDashboardSource('predictions.previews', () => predictions.previews(), []) : [],
      predictions ? optionalDashboardSource('predictions.reviewCandidates', () => predictions.reviewCandidates(), []) : [],
    ]);

    const [history, performance, selfAudit] = await Promise.all([
      predictions ? optionalDashboardSource('predictions.history', () => predictions.history(20), []) : [],
      predictions ? optionalDashboardSource('predictions.performance', () => predictions.performance(), null) : null,
      predictions ? optionalDashboardSource('predictions.latestSelfAudit', () => predictions.latestSelfAudit(), null) : null,
    ]);

    const [segmentAudits, rootCauses, adaptiveProposals] = await Promise.all([
      predictions ? optionalDashboardSource('predictions.latestSegmentSelfAudits', () => predictions.latestSegmentSelfAudits(), []) : [],
      predictions ? optionalDashboardSource('predictions.latestRootCauseAudits', () => predictions.latestRootCauseAudits(), []) : [],
      predictions ? optionalDashboardSource('predictions.latestAdaptiveRuleProposals', () => predictions.latestAdaptiveRuleProposals(), []) : [],
    ]);

    const [oddsSimilarity, predictionDiagnostics, oddsIntelligenceData] = await Promise.all([
      predictions ? optionalDashboardSource('predictions.oddsSimilarityShowcase', () => predictions.oddsSimilarityShowcase(4, 5), []) : [],
      predictions ? optionalDashboardSource('predictions.diagnostics', () => predictions.diagnostics(), null) : null,
      oddsIntelligence ? optionalDashboardSource('oddsIntelligence.upcoming', () => oddsIntelligence.upcoming(4), []) : [],
    ]);

    const apiFootballHealth = repository.liveProviderHealth
      ? await optionalDashboardSource('liveProviderHealth', () => repository.liveProviderHealth(), null)
      : null;
    return { data, today, previews, reviewCandidates, history, performance, selfAudit, segmentAudits,
      rootCauses, adaptiveProposals, oddsSimilarity, predictionDiagnostics, oddsIntelligenceData, apiFootballHealth };
  };

  type DashboardSources = Awaited<ReturnType<typeof loadDashboardSourcesUncached>>;
  let dashboardCache: { value: DashboardSources; loadedAt: number } | null = null;
  let dashboardRefresh: Promise<DashboardSources> | null = null;
  const DASHBOARD_TTL_MS = 60_000;
  const DASHBOARD_STALE_MS = 5 * 60_000;

  const refreshDashboardSnapshot = (): Promise<DashboardSources> => {
    if (dashboardRefresh) return dashboardRefresh;
    dashboardRefresh = loadDashboardSourcesUncached().then((value) => {
      dashboardCache = { value, loadedAt: Date.now() };
      return value;
    }).finally(() => { dashboardRefresh = null; });
    return dashboardRefresh;
  };

  const loadDashboardSources = async (): Promise<DashboardSources> => {
    const now = Date.now();
    if (dashboardCache && now - dashboardCache.loadedAt < DASHBOARD_TTL_MS) return dashboardCache.value;
    if (dashboardCache && now - dashboardCache.loadedAt < DASHBOARD_STALE_MS) {
      void refreshDashboardSnapshot().catch((error) =>
        logger.warn({ err: error }, 'Dashboard background refresh failed; stale snapshot retained'));
      return dashboardCache.value;
    }
    try {
      return await refreshDashboardSnapshot();
    } catch (error) {
      if (dashboardCache) {
        logger.warn({ err: error }, 'Dashboard refresh failed; serving last snapshot');
        return dashboardCache.value;
      }
      throw error;
    }
  };

  const enrichLive = async (row: Record<string, unknown>) => {
    const [sources, health] = await Promise.all([
      repository.liveSources ? repository.liveSources(String(row.id)) : [],
      repository.liveProviderHealth ? repository.liveProviderHealth() : null,
    ]);
    const configured = config.API_FOOTBALL_ENABLED && Boolean(config.API_FOOTBALL_KEY.trim());
    const status: ProviderHealth = configured ? (health?.status as ProviderHealth ?? 'UNAVAILABLE') : 'NOT_CONFIGURED';
    const result = liveResponseV2(row, sources, status);
    const [prediction, gate] = await Promise.all([
      predictions ? predictions.detail(String(row.id)).catch(() => null) : null,
      predictions ? predictions.gates(String(row.id)).catch(() => null) : null,
    ]);
    return { ...result, preMatchContext: { contextualOnly: true, prediction, gate } };
  };
  app.get<{ Params: { matchId: string } }>('/api/live/:matchId/events', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.matchId)) return reply.code(404).send({ error: 'match_not_found' });
    const row = await repository.matchAnalysisDetail(request.params.matchId);
    if (!row || !competitionAllowed(row)) return reply.code(404).send({ error: 'match_not_found' });
    const result = await enrichLive(row);
    return { matchId: request.params.matchId, events: result.events, sourceEvents: result.sourceEvents, conflicts: result.conflicts, sourceHealth: result.sourceHealth };
  });
  app.get('/live-poll.js', async (_request, reply) => reply.type('application/javascript').send(livePollScript));
  app.get('/api/live', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const matches = await Promise.all(activeRows(await repository.liveMatches()).map(enrichLive));
    return { matches, html: matches.map(item => liveCard(item)).join('') || 'Şu anda takip edilen canlı maç yok.' };
  });
  app.get<{ Params: { matchId: string } }>('/api/live/:matchId', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.matchId)) {
      return reply.code(404).send({ error: 'match_not_found' });
    }
    const row = await repository.matchAnalysisDetail(request.params.matchId);
    if (!row || !competitionAllowed(row)) return reply.code(404).send({ error: 'match_not_found' });
    const result = await enrichLive(row);
    return { ...result, html: liveCard(result, true) };
  });

  app.get('/live-recommendations-poll.js', async (_request, reply) =>
    reply.type('application/javascript').send(liveRecommendationsPollScript));
  app.get('/api/live/recommendations', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const today = predictions ? await predictions.today() as Array<Record<string, unknown>> : [];
    const official = today.filter((item) => String(item.decision) === 'PREDICT');
    const health = repository.liveProviderHealth ? await repository.liveProviderHealth().catch(() => null) : null;
    const configured = config.API_FOOTBALL_ENABLED && Boolean(config.API_FOOTBALL_KEY.trim());
    const apiStatus: ProviderHealth = configured ? (health?.status as ProviderHealth ?? 'UNAVAILABLE') : 'NOT_CONFIGURED';
    const items: Array<Record<string, unknown>> = [];
    for (const prediction of official) {
      const matchId = String(prediction.match_id ?? prediction.matchId ?? '');
      if (!matchId) continue;
      const row = await repository.matchAnalysisDetail(matchId);
      if (!row || !competitionAllowed(row)) continue;
      const sources = repository.liveSources ? await repository.liveSources(matchId) : [];
      const live = liveResponseV2(row, sources, apiStatus);
      const recommendation = buildLiveRecommendation(prediction, live);
      items.push({
        prediction: {
          matchId,
          league: prediction.league ?? row.league,
          homeTeam: prediction.home_team ?? row.home_team,
          awayTeam: prediction.away_team ?? row.away_team,
          marketType: prediction.market_type ?? null,
          marketName: prediction.market_name ?? null,
          line: prediction.line ?? null,
          selection: prediction.selection ?? null,
          predictionScore: prediction.prediction_score ?? null,
          referenceOdds: prediction.reference_odds ?? null,
          lockedAt: prediction.locked_at ?? null,
          outcome: prediction.outcome ?? null,
        },
        live,
        recommendation,
      });
    }
    const typedItems = items as unknown as Array<Parameters<typeof liveRecommendationCard>[0]>;
    return {
      version: 'LIVE_RECOMMENDATION_V1',
      items,
      hasLive: items.some((item) => String((item.live as { match?: { status?: unknown } }).match?.status) === 'live'),
      html: typedItems.map(liveRecommendationCard).join('') || '<article class="card"><strong>Bugün resmi öneri yok.</strong><p>Prediction V1 bugün PREDICT kilitlediğinde burada canlı izlemeye alınacak.</p></article>',
      changesPredictionV1: false,
      executionAuthority: false,
      aiPredictionAuthority: false,
    };
  });

  app.get('/control-audit-poll.js', async (_request, reply) =>
    reply.type('application/javascript').send(controlAuditPollScript));
  app.get('/api/control-audit', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const latest = controlAudit ? await controlAudit.latest() : null;
    return { audit: latest, html: controlAuditCard(latest) };
  });
  app.get<{ Querystring: { limit?: string } }>('/api/control-audit/history', async (request) => ({
    version: 'CONTROL_AUDIT_V1',
    history: controlAudit ? await controlAudit.history(Number(request.query.limit ?? 20)) : [],
  }));

  app.get('/data-coverage.js', async (_request, reply) => reply.type('application/javascript').send(dataPoolScript));
  app.get('/api/data-coverage', async (_request, reply) => {
    const data = await repository.dataCoverage(config.SUPPORTED_COMPETITIONS);
    reply.header('Cache-Control', 'private, max-age=300');
    return { ...data, html: dataPoolCard(data) };
  });

  app.get('/health', async (_request, reply) => {
    const [database, operations] = await Promise.all([repository.databaseHealth(), repository.operationalHealth().catch(() => ({
      providers: {}, worker: { lastRun: null, lastSuccess: null }, backfill: { status: 'UNKNOWN' },
    }))]);
    const status = database.status === 'ok' ? 'ok' : 'degraded';
    if (status !== 'ok') logger.error({ database }, 'Health check failed');
    return reply.code(status === 'ok' ? 200 : 503).send({ app: 'UP', status, database, ...operations,
      apiFootball: !config.API_FOOTBALL_ENABLED || !config.API_FOOTBALL_KEY.trim() ? { status: 'NOT_CONFIGURED' }
        : repository.liveProviderHealth ? await repository.liveProviderHealth() : { status: 'UNAVAILABLE' },
      competitionAutoBackfill: {
        enabled: config.BACKFILL_ENABLED && config.COMPETITION_BACKFILL_AUTO_ENABLED && config.FOTMOB_ENABLED,
        seasons: config.COMPETITION_BACKFILL_AUTO_SEASONS,
        scope: 'PRIORITY',
      },
      timestamp: new Date().toISOString() });
  });

  app.get('/api/dashboard', async () => {
    const { data, today, previews, reviewCandidates, history, performance, selfAudit, segmentAudits,
      rootCauses, adaptiveProposals, oddsSimilarity, predictionDiagnostics, oddsIntelligenceData, apiFootballHealth } = await loadDashboardSources();
    const activeOddsIntelligence = activeIntelligence(oddsIntelligenceData);
    return { ...data,
      matches: activeRows(data.matches ?? []), recentFinishedMatches: activeRows(data.recentFinishedMatches ?? []),
      odds: activeRows(data.odds ?? []), oddsAnalyses: activeRows(data.oddsAnalyses ?? []),
      supportedCompetitions: config.SUPPORTED_COMPETITIONS,
      apiFootballHealth,
      predictions: attachOddsEvidence(activeRows(today), activeOddsIntelligence),
      predictionPreviews: attachOddsEvidence(activeRows(previews), activeOddsIntelligence),
      predictionReviewCandidates: attachOddsEvidence(activeRows(reviewCandidates), activeOddsIntelligence), predictionHistory: history,
      predictionPerformance: performance, predictionSelfAudit: selfAudit, predictionSelfAuditSegments: segmentAudits,
      predictionSelfAuditRootCauses: rootCauses, predictionAdaptiveRuleProposals: adaptiveProposals,
      oddsSimilarity: activeSimilarityRows(oddsSimilarity), predictionDiagnostics, oddsIntelligence: activeOddsIntelligence };
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
    const { data, today, previews, reviewCandidates, history, performance, selfAudit, segmentAudits,
      rootCauses, adaptiveProposals, oddsSimilarity, predictionDiagnostics, oddsIntelligenceData, apiFootballHealth } = await loadDashboardSources();
    const activeOddsIntelligence = activeIntelligence(oddsIntelligenceData);
    return reply.type('text/html; charset=utf-8').send(renderDashboard({ ...data,
      matches: activeRows(data.matches ?? []), recentFinishedMatches: activeRows(data.recentFinishedMatches ?? []),
      odds: activeRows(data.odds ?? []), oddsAnalyses: activeRows(data.oddsAnalyses ?? []),
      supportedCompetitions: config.SUPPORTED_COMPETITIONS,
      apiFootballHealth,
      predictions: attachOddsEvidence(activeRows(today), activeOddsIntelligence),
      predictionPreviews: attachOddsEvidence(activeRows(previews), activeOddsIntelligence),
      predictionReviewCandidates: attachOddsEvidence(activeRows(reviewCandidates), activeOddsIntelligence), predictionHistory: history,
      predictionPerformance: performance, predictionSelfAudit: selfAudit, predictionSelfAuditSegments: segmentAudits,
      predictionSelfAuditRootCauses: rootCauses, predictionAdaptiveRuleProposals: adaptiveProposals,
      oddsSimilarity: activeSimilarityRows(oddsSimilarity), predictionDiagnostics, oddsIntelligence: activeOddsIntelligence }));
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
