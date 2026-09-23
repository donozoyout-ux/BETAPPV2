import { describe, expect, it } from 'vitest';
import { liveResponse } from '../../src/live/analysis.js';
import { liveCard, livePollScript, liveSection } from '../../src/live/view.js';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
const id = '12345678-1234-1234-1234-123456789012';
const row = { id, status: 'live', league: 'UEFA Nations League A', home_team: '<img src=x onerror=alert(1)>',
  away_team: 'Türkiye', home_score: 1, away_score: 0, statistics: [], odds: [{ current_odds: 2 }] };
describe('LIVE_ANALYSIS_V1', () => {
  it('keeps absent stats/minute/odds unavailable and never mutates its input', () => {
    const before = structuredClone(row);
    const result = liveResponse(row);
    expect(result.match.minute).toBeNull();
    expect(result.statistics.shots.home).toBeNull();
    expect(result.LIVE_ANALYSIS_V1.state).toBe('LOW_DATA');
    expect(result.liveOddsAvailable).toBe(false);
    expect(result.liveOdds).toBeNull();
    expect(row).toEqual(before);
    expect(result.LIVE_ANALYSIS_V1).toMatchObject({ executionAuthority: false, aiPredictionAuthority: false });
  });
  it('uses real full-time FotMob pairs only, retaining zero and rejecting blanks', () => {
    const result = liveResponse({ ...row, statistics: [
      { provider: 'fotmob', period: 'ALL', stat_key: 'total_shots', home_value: 0, away_value: 3 },
      { provider: 'fotmob', period: 'ALL', stat_key: 'corners', home_value: '', away_value: null },
      { provider: 'other', period: 'ALL', stat_key: 'expected_goals', home_value: 8, away_value: 0 },
    ] });
    expect(result.statistics.shots).toMatchObject({ home: 0, away: 3 });
    expect(result.statistics.corners.home).toBeNull();
    expect(result.statistics.xg.home).toBeNull();
    expect(result.LIVE_ANALYSIS_V1.pressureSide).toBe('AWAY');
  });
  it('renders escaped dashboard/detail cards with conservative polling', () => {
    const html = liveCard(liveResponse(row));
    expect(html).toContain('CANLI');
    expect(html).toContain('Canlı Analizi Aç');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).toContain('—');
    expect(liveSection(row)).toContain('CANLI MAÇ ANALİZİ');
    expect(liveSection()).toContain('CANLI MAÇLAR');
    expect(livePollScript).toContain('30000');
    expect(livePollScript).toContain('60000');
    expect(livePollScript).not.toContain('location.reload');
  });
  it('serves national-team live fixtures and contextual predictions read-only', async () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent' });
    const prediction = { journal: { decision: 'SKIP' } };
    const app = buildApp(config, { liveMatches: async () => [row, { ...row, league: 'Unsupported' }],
      matchAnalysisDetail: async () => row } as never, createLogger(config), undefined,
    { detail: async () => prediction, gates: async () => ({}) } as never);
    try {
      const response = await app.inject('/api/live');
      expect(response.statusCode).toBe(200);
      expect(response.json().matches).toHaveLength(1);
      const detail = await app.inject(`/api/live/${id}`);
      expect(detail.statusCode).toBe(200);
      expect(detail.json().preMatchContext.prediction).toEqual(prediction);
      expect(detail.json().liveOddsAvailable).toBe(false);
      expect((await app.inject('/api/live/invalid')).statusCode).toBe(404);
    } finally { await app.close(); }
  });
});
