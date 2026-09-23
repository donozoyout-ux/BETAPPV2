import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';

describe('live recommendation route', () => {
  it('tracks only today official PREDICT rows and ignores SKIP rows', async () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent' });
    const match = { id: '12345678-1234-1234-1234-123456789012', league: 'UEFA Nations League A',
      home_team: 'Türkiye', away_team: 'France', status: 'live', home_score: 1, away_score: 0,
      kickoff_at: new Date(), source_updated_at: new Date(), statistics: [] };
    const repository = {
      matchAnalysisDetail: async () => match,
      liveSources: async () => [],
      liveProviderHealth: async () => null,
    };
    const predictions = {
      today: async () => [
        { match_id: match.id, decision: 'PREDICT', market_type: 'MATCH_RESULT', market_name: '1X2',
          selection: 'HOME', home_team: 'Türkiye', away_team: 'France', prediction_score: 80 },
        { match_id: 'skip-id', decision: 'SKIP' },
      ],
    };
    const app = buildApp(config, repository as never, createLogger(config), undefined, predictions as never);
    try {
      const response = await app.inject('/api/live/recommendations');
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.version).toBe('LIVE_RECOMMENDATION_V1');
      expect(body.items).toHaveLength(1);
      expect(body.items[0].prediction.matchId).toBe(match.id);
      expect(body.changesPredictionV1).toBe(false);
      expect(body.executionAuthority).toBe(false);
    } finally { await app.close(); }
  });
});
