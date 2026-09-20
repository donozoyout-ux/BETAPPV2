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

  it('renders a compact historical odds-match view instead of the raw ODDS_V1 card flood', () => {
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
            homeTeam: 'Old Home', awayTeam: 'Old Away', selection: 'HOME',
            openingOdds: 2.08, currentOdds: 1.86, probabilityDeltaPp: 5.9, featureLeadMinutes: 90,
            outcome: 'WIN', homeScore: 2, awayScore: 0, homeCorners: 6, awayCorners: 4 },
          { rank: 2, kickoffAt: '2026-03-02T20:00:00Z', league: 'Premier League',
            homeTeam: 'Past A', awayTeam: 'Past B', selection: 'HOME',
            openingOdds: 2.12, currentOdds: 1.88, probabilityDeltaPp: 5.5, featureLeadMinutes: 90,
            outcome: 'LOSS', homeScore: 0, awayScore: 1, homeCorners: 3, awayCorners: 5 },
        ],
      }],
    });
    expect(html).toContain('Tarihsel Oran Eşleşmeleri');
    expect(html).toContain('En yakın geçmiş oran eşleşmeleri · en fazla 5 maç');
    expect(html).toContain('Arsenal — Chelsea');
    expect(html).toContain('Old Home — Old Away');
    expect(html).toContain('2.08 → 1.86');
    expect(html).toContain('WIN');
    expect(html).not.toContain('Piyasa Olasılığı');
    expect(html).not.toContain('Bookmaker Teyidi');
    expect(html).not.toMatch(/KESİN|GARANTİ|BANKO|%100/);
  });
  it('renders the UI V3 command center and self-audit navigation', () => {
    const html = renderDashboard({
      providers: [{ provider: 'fotmob', status: 'healthy' }, { provider: 'nowgoal', status: 'healthy' }],
      matches: [],
      predictionSelfAudit: { status: 'HEALTHY', guardActive: false },
      predictionSelfAuditSegments: [],
      predictionSelfAuditRootCauses: [],
      predictionAdaptiveRuleProposals: [],
    });
    expect(html).toContain('BETAPP Command Center');
    expect(html).toContain('BETAPP UI V3');
    expect(html).toContain('Maç Merkezi');
    expect(html).toContain('Tahmin Merkezi');
    expect(html).toContain('Self‑Audit Merkezi');
    expect(html).toContain('V4 · Öneriler');
    expect(html).toContain('data-global-search');
    expect(html).toContain('autoApply=false');
  });

  it('groups predictions into official, review, and compact rejected sections without raw reason flood', () => {
    const reviewCandidate = { marketType: 'MATCH_RESULT', marketName: '1X2', line: null, selection: 'HOME',
      referenceOdds: 1.9, openingOdds: 2.05, currentOdds: 1.9, probabilityDeltaPp: 0.8, predictionScore: 58,
      bookmakerCount: 2, agreementRatio: 0.71, completeStateBookmakerCount: 1, minimumCompleteStateCount: 1,
      dataQualityGrade: 'LIMITED', confidenceGrade: 'LIMITED', warnings: [],
      historical: { settledSampleSize: 5, historicalHitRate: 0.6, averageSimilarity: 0.82 } };
    const skipped = Array.from({ length: 15 }, (_, index) => ({ match_id: `m-${index}`,
      kickoff_at: '2026-09-20T18:00:00Z', league: 'League', home_team: `<b>Home ${index}</b>`, away_team: 'Away',
      state: 'PREVIEW', decision: 'SKIP', candidates: index === 0 ? [reviewCandidate] : [],
      skip_reasons: ['ODDS_NOT_ELIGIBLE', 'MOVEMENT_NOT_SUPPORTED'] }));
    const html = renderDashboard({ providers: [], matches: [], predictionPreviews: skipped });
    expect(html).toContain('Resmi Tahminler');
    expect(html).toContain('İnceleme Adayları');
    expect(html).toContain('Elenen Maçlar');
    expect(html).toContain('İNCELEME ADAYI');
    expect(html).toContain('Tüm elenen maçları göster');
    expect(html).toContain('Oran verisi henüz yeterli değil');
    expect(html).not.toContain('ODDS_NOT_ELIGIBLE');
    expect(html).not.toContain('<b>Home');
  });

});
