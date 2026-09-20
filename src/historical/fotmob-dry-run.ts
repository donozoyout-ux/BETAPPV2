import type { AppConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { CircuitBreaker } from '../providers/circuit-breaker.js';
import { FotMobProvider, fotmobCompetitions } from '../providers/fotmob.js';

type FotMobCompetition = (typeof fotmobCompetitions)[number];
type CoverageKey = 'corners' | 'yellowCards' | 'redCards' | 'shots' | 'shotsOnTarget' | 'fouls' | 'offsides' | 'possession' | 'xg' | 'lineups' | 'referees';

export type FotMobDryRunReport = {
  provider: 'fotmob'; competition: string; competitionId: number; season: string; dryRun: true;
  fixturesDiscovered: number; finalResults: number; statisticsSampled: number; errors: number;
  estimatedRequests: number; latencyMs: number; requestDelayMs: number;
  coverage: Record<CoverageKey, number>;
};

const metricKeys: Record<Exclude<CoverageKey, 'lineups' | 'referees'>, string[]> = {
  corners: ['corners', 'corner_kicks'], yellowCards: ['yellow_cards'], redCards: ['red_cards'],
  shots: ['total_shots', 'shots'], shotsOnTarget: ['shots_on_target'], fouls: ['fouls_committed', 'fouls'],
  offsides: ['offsides'], possession: ['ball_possession', 'possession'], xg: ['expected_goals', 'expected_goals_xg', 'xg'],
};

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

function sampleEvenly<T>(values: T[], count: number): T[] {
  if (count >= values.length) return values;
  return Array.from({ length: count }, (_, index) => values[Math.floor(index * values.length / count)]!).filter(Boolean);
}

function hasObject(value: unknown): boolean { return Boolean(value && typeof value === 'object' && Object.keys(value as object).length); }

/**
 * Read-only historical qualification. It deliberately has no repository or pool
 * dependency, so --dry-run cannot write to production PostgreSQL by accident.
 */
export async function runFotMobDryRun(
  config: AppConfig,
  competition: FotMobCompetition,
  season: string,
  sampleSize = 12,
): Promise<FotMobDryRunReport> {
  const started = Date.now();
  const logger = createLogger({ ...config, LOG_LEVEL: 'silent' }, 'betapp-fotmob-dry-run');
  const provider = new FotMobProvider({ ...config, PROVIDER_REQUESTS_PER_SECOND: Math.min(1, config.PROVIDER_REQUESTS_PER_SECOND) }, logger);
  const circuit = new CircuitBreaker(config.PROVIDER_CIRCUIT_FAILURE_THRESHOLD, config.PROVIDER_CIRCUIT_COOLDOWN_MS);
  const fixtures = await provider.getHistoricalFixtures(competition.id, season);
  const sample = sampleEvenly(fixtures, Math.max(1, sampleSize));
  const coverage: Record<CoverageKey, number> = {
    corners: 0, yellowCards: 0, redCards: 0, shots: 0, shotsOnTarget: 0, fouls: 0,
    offsides: 0, possession: 0, xg: 0, lineups: 0, referees: 0,
  };
  let errors = 0;
  for (let index = 0; index < sample.length; index += 1) {
    if (!circuit.canRequest()) { errors += sample.length - index; break; }
    try {
      const statistics = await provider.getMatchStatistics(sample[index]!.providerExternalId);
      const keys = new Set(statistics.statistics.map((item) => item.key));
      for (const [field, candidates] of Object.entries(metricKeys) as Array<[Exclude<CoverageKey, 'lineups' | 'referees'>, string[]]>) {
        if (candidates.some((key) => keys.has(key))) coverage[field] += 1;
      }
      const raw = statistics.raw as { lineup?: unknown; infoBox?: unknown };
      if (hasObject(raw.lineup)) coverage.lineups += 1;
      if (JSON.stringify(raw.infoBox ?? {}).toLowerCase().includes('referee')) coverage.referees += 1;
      circuit.success();
    } catch {
      errors += 1;
      circuit.failure();
    }
    if (index + 1 < sample.length) await sleep(config.HISTORICAL_REQUEST_DELAY_MS);
  }
  return {
    provider: 'fotmob', competition: competition.name, competitionId: competition.id, season, dryRun: true,
    fixturesDiscovered: fixtures.length,
    finalResults: fixtures.filter((fixture) => fixture.homeScore !== null && fixture.awayScore !== null).length,
    statisticsSampled: sample.length - errors, errors, estimatedRequests: 1 + sample.length,
    latencyMs: Date.now() - started, requestDelayMs: config.HISTORICAL_REQUEST_DELAY_MS, coverage,
  };
}
