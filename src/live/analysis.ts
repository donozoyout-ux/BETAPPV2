type Pair = Readonly<{ home: number | null; away: number | null; updatedAt: unknown }>;
const metrics = {
  possession: ['ball_possession'], shots: ['total_shots'], shotsOnTarget: ['shots_on_target'],
  corners: ['corners'], yellowCards: ['yellow_cards'], redCards: ['red_cards'],
  fouls: ['fouls_committed', 'fouls'], xg: ['expected_goals_xg', 'expected_goals'],
} as const;
function numeric(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(String(value).replace(/%$/, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function liveMatchState(row: Record<string, unknown>) {
  const rows = (Array.isArray(row.statistics) ? row.statistics : []) as Record<string, unknown>[];
  const statistics = Object.fromEntries(Object.entries(metrics).map(([name, aliases]) => {
    const stat = rows.filter(s => s.provider === 'fotmob' && s.period === 'ALL'
      && (aliases as readonly string[]).includes(String(s.stat_key)))
      .sort((a, b) => String(b.source_updated_at).localeCompare(String(a.source_updated_at)))[0];
    return [name, { home: numeric(stat?.home_value), away: numeric(stat?.away_value), updatedAt: stat?.source_updated_at ?? null }];
  })) as Record<keyof typeof metrics, Pair>;
  return { matchId: String(row.id), kickoffAt: row.kickoff_at, league: row.league,
    homeTeam: row.home_team, awayTeam: row.away_team, status: row.status,
    minute: null, homeScore: numeric(row.home_score), awayScore: numeric(row.away_score),
    statistics, odds: null, liveOddsAvailable: false as const, updatedAt: row.source_updated_at ?? null };
}
export type LiveMatchState = Readonly<ReturnType<typeof liveMatchState>>;
function pressure(pair: Pair) {
  if (pair.home == null || pair.away == null) return 'UNKNOWN' as const;
  return pair.home === pair.away ? 'BALANCED' as const : pair.home > pair.away ? 'HOME' as const : 'AWAY' as const;
}
export function analyzeLive(match: LiveMatchState, generatedAt = new Date()) {
  const s = match.statistics;
  const available = Object.values(s).filter(p => p.home != null && p.away != null).length;
  const directions = [s.shots, s.shotsOnTarget, s.corners, s.xg].map(pressure).filter(p => p !== 'UNKNOWN');
  const balance = directions.reduce((sum, p) => sum + (p === 'HOME' ? 1 : p === 'AWAY' ? -1 : 0), 0);
  return { version: 'LIVE_ANALYSIS_V1', state: match.status !== 'live' ? 'NOT_AVAILABLE' : available < 3 ? 'LOW_DATA' : 'ACTIVE',
    scoreContext: match.homeScore == null || match.awayScore == null ? null : `${match.homeScore} - ${match.awayScore}`,
    pressureSide: !directions.length ? 'UNKNOWN' : balance === 0 ? 'BALANCED' : balance > 0 ? 'HOME' : 'AWAY',
    shotPressure: pressure(s.shots), cornerPressure: pressure(s.corners),
    cardPressure: { yellow: pressure(s.yellowCards), red: pressure(s.redCards) }, xgPressure: pressure(s.xg),
    oddsMovement: null, dataCompleteness: available / Object.keys(metrics).length,
    reasons: [available ? `${available}/8 istatistik çifti mevcut.` : 'Canlı istatistik mevcut değil.',
      'Baskı, şut/isabetli şut/korner/xG karşılaştırmalarının eşit ağırlıklı özetidir.',
      'Kart karşılaştırması kart sayısını gösterir; hücum baskısı değildir.',
      'Gerçek canlı oran mevcut değil.'],
    generatedAt, executionAuthority: false, aiPredictionAuthority: false };
}
export function liveResponse(row: Record<string, unknown>) {
  const match = liveMatchState(row);
  return { match, statistics: match.statistics, LIVE_ANALYSIS_V1: analyzeLive(match), liveOdds: null, liveOddsAvailable: false };
}
