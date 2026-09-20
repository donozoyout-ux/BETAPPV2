import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';

describe('odds intelligence API', () => {
  it('exposes a separate, non-authoritative route without Prediction V1 dependency', async () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent' });
    const intelligence = { upcoming: async () => [{ match: { id: 'm1' }, executionAuthority: false, aiPredictionAuthority: false }],
      byMatch: async (id: string) => id === 'm1' ? { match: { id }, executionAuthority: false, aiPredictionAuthority: false } : null };
    const app = buildApp(config, {} as never, createLogger(config), undefined, undefined, intelligence as never);
    try {
      const upcoming = await app.inject('/api/odds-intelligence/upcoming');
      expect(upcoming.statusCode).toBe(200);
      expect(upcoming.json()).toMatchObject({ engineVersion: 'ODDS_NEIGHBOR_V2', executionAuthority: false, analyses: [{ match: { id: 'm1' } }] });
      const detail = await app.inject('/api/odds-intelligence/missing');
      expect(detail.json()).toMatchObject({ status: 'NOT_GENERATED', executionAuthority: false, aiPredictionAuthority: false });
    } finally { await app.close(); }
  });
});
