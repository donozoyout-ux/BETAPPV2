import { describe, expect, it } from 'vitest';
import { renderDashboard } from '../../src/dashboard.js';

describe('renderDashboard', () => {
  it('escapes provider and match values', () => {
    const html = renderDashboard({
      providers: [{ provider: '<script>alert(1)</script>', status: 'healthy', last_checked_at: 'now' }],
      matches: [{ kickoff_at: '2026-09-16T10:00:00Z', league: 'League', home_team: '<b>A</b>', away_team: 'B', status: 'scheduled', available_statistics: [] }],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;A&lt;/b&gt;');
  });

  it('renders historical odds matches in plain Turkish', () => {
    const html = renderDashboard({ providers: [], matches: [],
      oddsAnalyses: Array.from({ length: 20 }, (_, index) => ({ id: index })),
      oddsSimilarity: [{
        current: { matchId: 'current-1', kickoffAt: '2026-09-20T18:00:00Z', league: 'Premier League',
          homeTeam: 'Arsenal', awayTeam: 'Chelsea', state: 'PREVIEW', marketType: 'MATCH_RESULT',
          marketName: '1X2', line: null, selection: 'HOME', openingOdds: 2.10, currentOdds: 1.85,
          probabilityDeltaPp: 6.2, predictionScore: 82, historicalSettledSampleSize: 44,
          historicalHitRate: 0.61, averageSimilarity: 0.91, scope: 'SAME_COMPETITION' },
        matches: [
          { rank: 1, kickoffAt: '2026-04-11T15:00:00Z', league: 'Premier League',
            homeTeam: 'Old Home', awayTeam: 'Old Away', marketType: 'MATCH_RESULT', selection: 'HOME',
            openingOdds: 2.08, currentOdds: 1.86, probabilityDeltaPp: 5.9, featureLeadMinutes: 90,
            outcome: 'WIN', homeScore: 2, awayScore: 0, homeCorners: 6, awayCorners: 4 },
        ],
      }],
    });
    expect(html).toContain('Oran Eşleşmeleri');
    expect(html).toContain('En çok benzeyen geçmiş maçlar');
    expect(html).toContain('Arsenal — Chelsea');
    expect(html).toContain('Old Home — Old Away');
    expect(html).toContain('2.08 → 1.86');
    expect(html).toContain('Kazandı');
    expect(html).toContain('Benzer geçmiş maç: 44');
    expect(html).not.toContain('Historical N=');
    expect(html).not.toContain('+6.20 pp');
    expect(html).not.toMatch(/KESİN|GARANTİ|BANKO|%100/);
  });

  it('separates official predictions, review candidates and rejected matches', () => {
    const html = renderDashboard({
      providers: [{ provider: 'fotmob', status: 'healthy' }, { provider: 'nowgoal', status: 'healthy' }],
      matches: [],
      predictions: [
        { match_id: 'official-1', decision: 'PREDICT', state: 'LOCKED_PREDICTION', home_team: 'Takım A', away_team: 'Takım B',
          league: 'Süper Lig', kickoff_at: '2026-09-20T18:00:00Z', market_type: 'TOTAL_GOALS', line: 2.5, selection: 'OVER',
          prediction_score: 81, historical_settled_sample_size: 34, historical_hit_rate: 0.62, reference_odds: 1.88 },
        { match_id: 'reject-1', decision: 'SKIP', state: 'LOCKED_SKIP', home_team: 'Takım C', away_team: 'Takım D',
          league: 'Süper Lig', kickoff_at: '2026-09-20T19:00:00Z',
          skip_reasons: ['ODDS_NOT_ELIGIBLE','MOVEMENT_NOT_SUPPORTED'] },
      ],
      predictionReviewCandidates: [{
        matchId: 'review-1', homeTeam: 'Fenerbahçe', awayTeam: 'Eyüpspor', league: 'Süper Lig',
        kickoffAt: '2026-09-20T17:00:00Z', skipReasons: ['INSUFFICIENT_HISTORICAL_SAMPLE','MOVEMENT_NOT_SUPPORTED'],
        candidate: { marketType: 'TOTAL_GOALS', line: 2.5, selection: 'OVER', openingOdds: 2.05, currentOdds: 1.88,
          probabilityDeltaPp: 0.8, predictionScore: 68, bookmakerCount: 4, agreementRatio: 0.75,
          dataQualityGrade: 'GOOD', confidenceGrade: 'LIMITED',
          historical: { settledSampleSize: 13, historicalHitRate: 0.58 } },
      }],
      predictionDiagnostics: {
        thresholds: { minimumHistoricalSample: 30 },
        historical: { total: 116, eligible: 116 },
        current: { targets: 24, withOddsAnalysis: 15, predictRuns: 1, skipRuns: 14,
          maximumHistoricalSettledSample: 13,
          topSkipReasons: [
            { reason: 'ODDS_NOT_ELIGIBLE', count: 14 },
            { reason: 'MOVEMENT_NOT_SUPPORTED', count: 14 },
          ] },
      },
    });
    expect(html).toContain('Resmi Tahminler');
    expect(html).toContain('İnceleme Adayları');
    expect(html).toContain('Tahmin Oluşturulmayan Maçlar');
    expect(html).toContain('Fenerbahçe — Eyüpspor');
    expect(html).toContain('Benzer geçmiş maç: 13 / gereken 30');
    expect(html).toContain('Oran verisi henüz yeterli değil');
    expect(html).toContain('Oran hareketi yeterince güçlü değil');
    expect(html).not.toContain('ODDS_NOT_ELIGIBLE');
    expect(html).not.toContain('MOVEMENT_NOT_SUPPORTED');
    expect(html).not.toContain('INSUFFICIENT_HISTORICAL_SAMPLE');
  });

  it('renders the main navigation and system status in plain Turkish', () => {
    const html = renderDashboard({
      providers: [{ provider: 'fotmob', status: 'healthy' }, { provider: 'nowgoal', status: 'healthy' }],
      matches: [],
      predictionSelfAudit: { status: 'HEALTHY', guardActive: false },
      predictionSelfAuditSegments: [],
      predictionSelfAuditRootCauses: [],
      predictionAdaptiveRuleProposals: [],
    });
    expect(html).toContain('Futbol Analiz Sistemi');
    expect(html).toContain('Ana Sayfa');
    expect(html).toContain('Bugünün Maçları');
    expect(html).toContain('Tahminler');
    expect(html).toContain('Oran Eşleşmeleri');
    expect(html).toContain('Geçmiş Tahminler');
    expect(html).toContain('Sistem Kontrolü');
    expect(html).toContain('Çalışıyor');
    expect(html).toContain('Sağlıklı');
    expect(html).not.toContain('BETAPP Command Center');
    expect(html).not.toContain('SELF-AUDIT V1');
  });
});
