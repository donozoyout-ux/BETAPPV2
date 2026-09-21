import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';

const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent' });

describe('match detail routes', () => {
  it('renders an existing match even when every optional analysis layer is unavailable', async () => {
    const repository = { matchAnalysisDetail: async (id: string) => id === 'known' ? {
      id, kickoff_at: '2026-09-21T18:00:00Z', status: 'scheduled', league: 'Lig', home_team: 'Ev', away_team: 'Dep',
      home_score: null, away_score: null, statistics: [], odds: [],
    } : null, cornerAnalysisDetail: async () => null };
    const failingPredictions = { gates: async () => { throw new Error('unavailable'); },
      detail: async () => { throw new Error('unavailable'); } };
    const app = buildApp(config, repository as never, createLogger(config), undefined, failingPredictions as never, undefined);
    try {
      const response = await app.inject('/matches/known');
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('Ev');
      expect(response.body).toContain('Prediction V1 değerlendirmesi henüz oluşmadı.');
    } finally { await app.close(); }
  });

  it('returns 404 only when the match itself does not exist', async () => {
    const repository = { matchAnalysisDetail: async () => null, cornerAnalysisDetail: async () => null };
    const app = buildApp(config, repository as never, createLogger(config));
    try {
      const response = await app.inject('/matches/unknown');
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'match_not_found' });
    } finally { await app.close(); }
  });

  it('keeps the existing corner detail route working', async () => {
    const repository = { cornerAnalysisDetail: async () => ({ match_id: 'known', home_team: 'Ev', away_team: 'Dep',
      competition: 'Lig', kickoff_at: '2026-09-21T18:00:00Z', probabilities: {}, data_quality_status: 'GOOD' }) };
    const app = buildApp(config, repository as never, createLogger(config));
    try {
      const response = await app.inject('/matches/known/corners');
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('Korner Analizi');
    } finally { await app.close(); }
  });
});
