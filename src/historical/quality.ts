import type { MatchStatistics } from '../domain/types.js';
import type { HistoricalDataQuality } from './types.js';

const major = ['corners', 'yellow_cards', 'total_shots', 'shots_on_target', 'fouls_committed', 'ball_possession'];

export function historicalDataQuality(homeScore: number | null, awayScore: number | null, statistics: MatchStatistics): HistoricalDataQuality {
  if (homeScore == null || awayScore == null) return 'POOR';
  const available = new Set(statistics.statistics.filter((item) => item.period === 'ALL'
    && item.homeValue != null && item.awayValue != null).map((item) => item.key));
  const count = major.filter((key) => available.has(key) || (key === 'fouls_committed' && available.has('fouls'))).length;
  if (count === major.length) return 'COMPLETE';
  if (count >= 2) return 'PARTIAL';
  return 'LIMITED';
}

export function historicalFieldPresence(statistics: MatchStatistics) {
  const available = new Set(statistics.statistics.filter((item) => item.period === 'ALL'
    && item.homeValue != null && item.awayValue != null).map((item) => item.key));
  const has = (...keys: string[]) => keys.some((key) => available.has(key));
  return { corners: has('corners', 'corner_kicks'), cards: has('yellow_cards', 'red_cards'), shots: has('total_shots'),
    shotsOnTarget: has('shots_on_target'), fouls: has('fouls_committed', 'fouls'), offsides: has('offsides'),
    possession: has('ball_possession'), xg: has('expected_goals', 'expected_goals_xg') };
}
