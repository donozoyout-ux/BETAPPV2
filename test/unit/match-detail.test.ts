import { describe, expect, it } from 'vitest';
import { renderMatchAnalysis, type MatchAnalysisPageData } from '../../src/match-detail.js';

const match = {
  id: 'match-1', kickoff_at: '2026-09-21T18:00:00Z', status: 'scheduled', league: 'Süper Lig',
  home_team: 'Ev Takımı', away_team: 'Deplasman Takımı', home_score: null, away_score: null,
  odds: [
    { provider: 'nowgoal:pinnacle', market_type: 'MATCH_RESULT', market_name: '1X2', selection: 'HOME', current_odds: 1.91, movement_percent: -2.1 },
    { provider: 'nowgoal:pinnacle', market_type: 'MATCH_RESULT', market_name: '1X2', selection: 'DRAW', current_odds: 3.4 },
    { provider: 'nowgoal:pinnacle', market_type: 'MATCH_RESULT', market_name: '1X2', selection: 'AWAY', current_odds: 4.2 },
  ],
  statistics: [],
};

const candidate = { marketType: 'TOTAL_GOALS', line: 2.5, selection: 'OVER', currentOdds: 1.91,
  openingOdds: 2.08, predictionScore: 76, movementClass: 'SUPPORT', bookmakerCount: 7,
  dataQualityGrade: 'GOOD', confidenceGrade: 'GOOD', historical: { settledSampleSize: 42, historicalHitRate: 0.64 } };

const gates = [
  { key: 'BOOKMAKERS', label: 'Bahis şirketi', current: 7, required: 3, passed: true, reason: null, reasonCode: null },
  { key: 'HISTORICAL_SAMPLE', label: 'Geçmiş benzer maç', current: 42, required: 30, passed: false,
    reason: 'Geçmiş benzer maç sayısı yetersiz.', reasonCode: 'INSUFFICIENT_HISTORICAL_SAMPLE' },
];

const page = (overallStatus: string, overrides: Partial<MatchAnalysisPageData> = {}): MatchAnalysisPageData => ({
  match, predictionGate: { overallStatus, summary: 'İnsan tarafından okunabilir gate özeti.', candidate, gates },
  predictionDetail: { state: 'PREVIEW', runs: [{}], journal: null }, ...overrides,
});

describe('match analysis detail renderer', () => {
  it('renders the OFFICIAL state, real 1X2 odds and gate values without raw reason codes', () => {
    const html = renderMatchAnalysis(page('OFFICIAL'));
    expect(html).toContain('RESMİ TAHMİN');
    expect(html).toContain('Resmi tahmin oluştu.');
    expect(html).toContain('nowgoal:pinnacle');
    expect(html).toContain('1.91');
    expect(html).toContain('3.40');
    expect(html).toContain('4.20');
    expect(html).toContain('Geçmiş benzer maç sayısı yetersiz.');
    expect(html).not.toContain('INSUFFICIENT_HISTORICAL_SAMPLE');
  });

  it('keeps a preview WAITING and never promotes it to an official badge', () => {
    const html = renderMatchAnalysis(page('WAITING'));
    expect(html).toContain('VERİ BEKLENİYOR');
    expect(html).toContain('Veri bekleniyor.');
    expect(html).not.toContain('<span class="badge ok">RESMİ TAHMİN</span>');
  });

  it('shows the required REVIEW warning prominently', () => {
    const html = renderMatchAnalysis(page('REVIEW'));
    expect(html).toContain('İNCELEME');
    expect(html).toContain('Resmi tahmin değildir.');
  });

  it('omits invented defaults when no prediction candidate exists', () => {
    const html = renderMatchAnalysis(page('WAITING', { predictionGate: {
      overallStatus: 'WAITING', summary: 'Prediction V1 değerlendirmesi bekleniyor.', candidate: null, gates: [],
    } }));
    expect(html).toContain('Henüz resmi aday hesaplanmadı');
    expect(html).not.toContain('0 / 100');
    expect(html).not.toContain('1.00');
    expect(html).not.toContain('0 geçmiş');
  });

  it('renders unavailable layers and missing statistics as clean empty states', () => {
    const html = renderMatchAnalysis(page('WAITING', { oddsIntelligence: null, oddsAnalysis: null, cornerAnalysis: null }));
    expect(html).toContain('Oran rotası henüz oluşmadı');
    expect(html).toContain('Oran analizi henüz oluşmadı');
    expect(html).toContain('Korner analizi mevcut değil');
    expect(html).toContain('Bu maç için takım istatistikleri henüz mevcut değil.');
  });

  it('escapes real statistics and historical twin values', () => {
    const html = renderMatchAnalysis(page('REVIEW', {
      match: { ...match, home_team: '<img src=x>', statistics: [{ period: 'ALL', label: '<script>Şut</script>',
        home_value: '7<8', away_value: '3>2', provider: '<b>fotmob</b>' }] },
      oddsIntelligence: { evidenceStrength: 'MEDIUM', oddsRoute: null,
        pastTwins: [{ homeTeam: '<svg>', awayTeam: 'Rakip & Co', league: '<i>Lig</i>', kickoffAt: '2026-01-01T12:00:00Z',
          openingOdds: 2.08, decisionOdds: 1.91, similarity: 92, homeScore: 2, awayScore: 1,
          homeCorners: 6, awayCorners: 4, outcome: { home: 2, away: 1 } }], resultMap: [], conflictCheck: [] },
    }));
    expect(html).toContain('&lt;script&gt;Şut&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;fotmob&lt;/b&gt;');
    expect(html).toContain('&lt;svg&gt;');
    expect(html).toContain('%92.0');
    expect(html).toContain('Örnek yetersiz');
    expect(html).toContain('Farklı lig');
    expect(html).not.toContain('%9200.0');
    expect(html).toContain('2 — 1');
    expect(html).not.toContain('<span class="badge neutral">2</span>');
    expect(html).not.toContain('<script>Şut</script>');
    expect(html).not.toContain('<svg>');
  });

  it('filters HistoricalTwin similarity below 70 and keeps 0–100 display semantics', () => {
    const twin = (similarity: number, name: string) => ({ homeTeam: name, awayTeam: 'Rakip', league: 'Lig',
      kickoffAt: '2026-01-01T12:00:00Z', openingOdds: 2.08, decisionOdds: 1.91, similarity,
      homeScore: 0, awayScore: 0, outcome: { home: 0, away: 0 } });
    const html = renderMatchAnalysis(page('REVIEW', { oddsIntelligence: { evidenceStrength: 'LOW', oddsRoute: null,
      pastTwins: [twin(69, 'Eşik altı'), twin(70, 'Alt kabul'), twin(100, 'Üst sınır')],
      resultMap: [], conflictCheck: [] } }));
    expect(html).not.toContain('Eşik altı');
    expect(html).toContain('%70.0');
    expect(html).toContain('%100.0');
    expect(html).not.toContain('%10000.0');
  });

  it('renders the real result-map sample and rate plus safety disclaimers', () => {
    const html = renderMatchAnalysis(page('REVIEW', { oddsIntelligence: {
      evidenceStrength: 'HIGH', oddsRoute: null, pastTwins: [], conflictCheck: [{ source: 'ODDS_ROUTE', state: 'SUPPORT' }],
      resultMap: [{ market: 'TOTAL_GOALS', line: 2.5, selection: 'OVER', positiveCount: 8, sampleSize: 10, positiveRate: 0.8 }],
    } }));
    expect(html).toContain('8 / 10');
    expect(html).toContain('%80.0');
    expect(html).toContain('Geçmiş dağılım garantili gelecek sonucu ifade etmez.');
    expect(html).toContain('ODDS_ROUTE');
    expect(html).toContain('SUPPORT');
  });

  it('suppresses result-map success percentages below five samples', () => {
    const html = renderMatchAnalysis(page('REVIEW', { oddsIntelligence: {
      evidenceStrength: 'VERY_LOW', oddsRoute: null, pastTwins: [], conflictCheck: [],
      resultMap: [{ market: 'TOTAL_GOALS', line: 2.5, selection: 'OVER', positiveCount: 1, sampleSize: 1, positiveRate: 1 }],
    } }));
    expect(html).toContain('1 / 1');
    expect(html).toContain('Örnek yetersiz');
    expect(html).not.toContain('%100.0');
  });

  it('does not emit prohibited fake product or venue fields', () => {
    const html = renderMatchAnalysis(page('WAITING'));
    expect(html).not.toMatch(/Opta Sync|Engine V1\.4|referee|stadium/i);
  });
});
