import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';

const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent' });

describe('dashboard route resilience', () => {
  it('renders a degraded dashboard instead of 500 when the core dashboard query fails', async () => {
    const repository = {
      dashboardData: async () => { throw new Error('production dashboard SQL failure'); },
    };
    const app = buildApp(config, repository as never, createLogger(config));
    try {
      const response = await app.inject('/');
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('BETAPP Futbol Analiz Terminali');
      expect(response.body).not.toContain('internal_server_error');

      const apiResponse = await app.inject('/api/dashboard');
      expect(apiResponse.statusCode).toBe(200);
      const payload = apiResponse.json();
      expect(payload.matches).toEqual([]);
      expect(payload.providers).toEqual([]);
      expect(payload.odds).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('renders the dashboard when optional prediction and odds-intelligence sources fail', async () => {
    const repository = {
      dashboardData: async () => ({ providers: [], matches: [] }),
    };
    const fail = async () => { throw new Error('legacy production payload failure'); };
    const predictions = {
      today: fail,
      previews: fail,
      reviewCandidates: fail,
      history: fail,
      performance: fail,
      latestSelfAudit: fail,
      latestSegmentSelfAudits: fail,
      latestRootCauseAudits: fail,
      latestAdaptiveRuleProposals: fail,
      oddsSimilarityShowcase: fail,
      diagnostics: fail,
    };
    const oddsIntelligence = { upcoming: fail };
    const app = buildApp(config, repository as never, createLogger(config), undefined,
      predictions as never, oddsIntelligence as never);
    try {
      const response = await app.inject('/');
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('BETAPP Futbol Analiz Terminali');
      expect(response.body).not.toContain('internal_server_error');
    } finally {
      await app.close();
    }
  });
});
