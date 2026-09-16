import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import type { AppConfig } from './config.js';
import type { FootballRepository } from './db/repository.js';
import { renderCornerDetail, renderDashboard } from './dashboard.js';
import type { Logger } from './logger.js';

export function buildApp(config: AppConfig, repository: FootballRepository, logger: Logger) {
  const app = Fastify({ loggerInstance: logger });
  void app.register(helmet, { contentSecurityPolicy: false });

  app.get('/health', async (_request, reply) => {
    const [database, operations] = await Promise.all([repository.databaseHealth(), repository.operationalHealth().catch(() => ({
      providers: {}, worker: { lastRun: null, lastSuccess: null }, backfill: { status: 'UNKNOWN' },
    }))]);
    const status = database.status === 'ok' ? 'ok' : 'degraded';
    if (status !== 'ok') logger.error({ database }, 'Health check failed');
    return reply.code(status === 'ok' ? 200 : 503).send({ app: 'UP', status, database, ...operations,
      timestamp: new Date().toISOString() });
  });

  app.get('/api/dashboard', async () => repository.dashboardData('Europe/Istanbul'));
  app.get('/api/backfill/status', async () => repository.backfillStatus());
  app.get('/', async (_request, reply) => {
    const data = await repository.dashboardData('Europe/Istanbul');
    return reply.type('text/html; charset=utf-8').send(renderDashboard(data));
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
