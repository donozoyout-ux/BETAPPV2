// Synthetic UI fixtures. Never imported by the production server or collector.
export function dashboardFixture() {
  const kickoff = new Date();
  const teams = [['Armenia', 'Latvia'], ['Georgia', 'Northern Ireland'], ['Poland', 'Bosnia and Herzegovina'], ['Manchester United', 'Brighton & Hove Albion'], ['Fenerbahçe', 'İstanbul Başakşehir'], ['Australia', 'Brazil']];
  const matches = teams.map(([home_team, away_team], i) => ({ id: `ui-${i}`, home_team, away_team, league: i < 3 ? 'UEFA Nations League' : 'Premier League', kickoff_at: kickoff.toISOString(), status: 'scheduled', odds: [], statistics: [] }));
  const candidate = { marketType: 'TOTAL_GOALS', line: 2.5, selection: 'UNDER', currentOdds: 1.92, openingOdds: 2.02, predictionScore: 58.3, bookmakerCount: 3, agreementRatio: 0.67, dataQualityGrade: 'GOOD', confidenceGrade: 'LIMITED', historical: { settledSampleSize: 8, historicalHitRate: null } };
  const gates = [{ key: 'HISTORICAL_SAMPLE', label: 'Geçmiş benzer maç', current: 8, required: 30, passed: false, reason: 'Benzer geçmiş maç sayısı yetersiz.', reasonCode: 'INSUFFICIENT_HISTORICAL_SAMPLE' }];
  const previews = matches.slice(0, 4).map((m, i) => ({ ...m, match_id: m.id, state: 'PREVIEW', predictionGate: { overallStatus: i % 2 ? 'WAITING' : 'REJECTED', summary: i % 2 ? 'Resmi tahmin penceresi henüz açılmadı.' : 'Benzer geçmiş maç sayısı yetersiz.', gates, candidate } }));
  const review = { matchId: matches[4]!.id, homeTeam: matches[4]!.home_team, awayTeam: matches[4]!.away_team, league: matches[4]!.league, kickoffAt: kickoff.toISOString(), candidate, predictionGate: { overallStatus: 'REVIEW', gates, candidate, summary: 'Benzer geçmiş maç sayısı yetersiz.' }, skipReasons: ['INSUFFICIENT_HISTORICAL_SAMPLE'] };
  return { matches, providers: [{ provider: 'Test fixture', status: 'healthy' }], predictionPreviews: previews, predictionReviewCandidates: [review], odds: [], oddsAnalyses: [], predictions: [], recentFinishedMatches: [] };
}
