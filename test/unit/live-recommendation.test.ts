import { describe, expect, it } from 'vitest';
import { buildLiveRecommendation } from '../../src/live/recommendation.js';

const prediction = {
  market_type: 'MATCH_RESULT', market_name: '1X2', selection: 'HOME',
  home_team: 'Türkiye', away_team: 'France', prediction_score: 81,
  reference_odds: 2.10, locked_at: '2026-09-23T17:00:00Z',
};

function live(overrides: Record<string, unknown> = {}) {
  return {
    match: { matchId: 'm1', status: 'live', homeScore: 1, awayScore: 0 },
    minute: 67, addedTime: null, conflicts: [], sourceVerified: true,
    LIVE_ANALYSIS_V2: { state: 'ACTIVE', pressureSide: 'HOME' },
    LIVE_ANALYSIS_V3: {
      pressureNow: 'HOME', recentEventEdge: 'HOME',
      postScoreMomentum: { eventEdge: 'BALANCED' },
    },
    ...overrides,
  } as never;
}

describe('LIVE_RECOMMENDATION_V1', () => {
  it('supports the pre-match direction only when live signals align', () => {
    expect(buildLiveRecommendation(prediction, live())).toMatchObject({
      recommendation: 'DESTEKLENIYOR', changesPredictionV1: false,
      executionAuthority: false, aiPredictionAuthority: false,
    });
  });

  it('marks the pre-match direction as weakening when live signals oppose it', () => {
    expect(buildLiveRecommendation(prediction, live({
      LIVE_ANALYSIS_V3: { pressureNow: 'AWAY', recentEventEdge: 'AWAY', postScoreMomentum: { eventEdge: 'BALANCED' } },
    }))).toMatchObject({ recommendation: 'ZAYIFLIYOR' });
  });

  it('waits on source conflict instead of inventing a live recommendation', () => {
    expect(buildLiveRecommendation(prediction, live({
      conflicts: [{ type: 'SCORE_CONFLICT' }], LIVE_ANALYSIS_V2: { state: 'SOURCE_CONFLICT', pressureSide: 'HOME' },
    }))).toMatchObject({ state: 'SOURCE_CONFLICT', recommendation: 'BEKLE' });
  });

  it('waits for kickoff and does not rewrite Prediction V1', () => {
    expect(buildLiveRecommendation(prediction, live({
      match: { matchId: 'm1', status: 'scheduled', homeScore: null, awayScore: null },
    }))).toMatchObject({ state: 'WAITING_KICKOFF', recommendation: 'MAÇI_BEKLE', changesPredictionV1: false });
  });

  it('tracks unsupported live markets without directional guessing', () => {
    expect(buildLiveRecommendation({ ...prediction, market_type: 'TOTAL_GOALS', market_name: 'Total Goals', selection: 'OVER' }, live()))
      .toMatchObject({ state: 'ACTIVE', recommendation: 'TAKİP' });
  });
});
