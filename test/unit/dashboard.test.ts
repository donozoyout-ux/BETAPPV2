import { describe, expect, it } from 'vitest';
import { renderDashboard } from '../../src/dashboard.js';

describe('renderDashboard', () => {
  it('escapes provider and match values', () => {
    const html = renderDashboard({
      providers: [{ provider: '<script>', status: 'healthy', last_checked_at: 'now' }],
      matches: [{ kickoff_at: '2026-09-16T10:00:00Z', league: 'League', home_team: '<b>A</b>', away_team: 'B', status: 'scheduled', available_statistics: [] }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;A&lt;/b&gt;');
  });

  it('renders explainable ODDS_V1 cards without outcome claims', () => {
    const html = renderDashboard({ providers: [], matches: [], oddsAnalyses: [{ home_team: 'A', away_team: 'B',
      league: 'Lig', kickoff_at: '2026-09-20T18:00:00Z', items: [{ market_type: '1X2', line: null,
        selection: 'HOME', opening_odds: 2.1, current_odds: 1.85, opening_fair_probability: 0.42,
        current_fair_probability: 0.49, probability_delta_pp: 7, movement_class: 'STRONG_SUPPORT', score: 81,
        agreeing_bookmaker_count: 4, bookmaker_count: 5, data_quality_score: 85, data_quality_grade: 'GOOD',
        confidence_score: 80, confidence_grade: 'GOOD', analysis_eligible: true,
        reasons: ['4/5 bookmakers agree'], warnings: [] }] }],
    });
    expect(html).toContain('ORAN ANALİZİ V1');
    expect(html).toContain('Piyasa Olasılığı');
    expect(html).toContain('Bookmaker Teyidi');
    expect(html).not.toMatch(/KESİN|GARANTİ|BANKO|%100/);
  });
});
