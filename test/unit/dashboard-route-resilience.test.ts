import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';

const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent' });

describe('dashboard route resilience', () => {
  it('loads optional dashboard sources in bounded batches after core data', async () => {
    let concurrent = 0;
    let maximumConcurrent = 0;
    const core = async () => {
      expect(concurrent).toBe(0);
      return { providers: [], matches: [] };
    };
    const source = async () => {
      concurrent += 1;
      maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
      return [];
    };
    const repository = { dashboardData: core };
    const predictions = {
      today: source, previews: source, reviewCandidates: source, history: source,
      performance: async () => { await source(); return null; },
      latestSelfAudit: async () => { await source(); return null; },
      latestSegmentSelfAudits: source, latestRootCauseAudits: source, latestAdaptiveRuleProposals: source,
      oddsSimilarityShowcase: source, diagnostics: async () => { await source(); return null; },
    };
    const oddsIntelligence = { upcoming: source };
    const app = buildApp(config, repository as never, createLogger(config), undefined,
      predictions as never, oddsIntelligence as never);
    try {
      const response = await app.inject('/');
      expect(response.statusCode).toBe(200);
      expect(maximumConcurrent).toBeLessThanOrEqual(3);
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
