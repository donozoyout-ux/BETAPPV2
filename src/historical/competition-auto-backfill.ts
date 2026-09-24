import type { AppConfig } from '../config.js';
import type { DatabasePool } from '../db/pool.js';
import { FootballRepository } from '../db/repository.js';
import { HistoricalRepository } from '../db/historical-repository.js';
import { CornerRepository } from '../db/corner-repository.js';
import { PredictionRepository } from '../predictions/service.js';
import { buildAllLeagueBaselines, buildAllTeamProfiles } from '../corners/profiles.js';
import { auditDataset } from '../data/audit.js';
import { DataCoverageService } from '../data/coverage.js';
import { DATA_TARGET_V1, coverageTarget } from '../data/coverage-target.js';
import { FotMobProvider, fotmobCompetitions } from '../providers/fotmob.js';
import { runCompetitionBackfill } from './competition-backfill.js';
import { selectedCycleCount, type ExpansionReport } from './competition-scope.js';
import type { Logger } from '../logger.js';

const FAILURE_RETRY_COOLDOWN_MS = 6 * 60 * 60_000;

export function autoBackfillTargets(config: AppConfig) {
  const allowed = new Set(config.SUPPORTED_COMPETITIONS);
  return fotmobCompetitions.filter((competition) => allowed.has(competition.key));
}

function recentFailure(report: ExpansionReport | null, now = Date.now()) {
  if (!report?.completedAt || !report.failures.length) return false;
  return now - new Date(report.completedAt).getTime() < FAILURE_RETRY_COOLDOWN_MS;
}

export class CompetitionAutoBackfill {
  private readonly football: FootballRepository;
  private readonly historical: HistoricalRepository;
  private readonly corners: CornerRepository;
  private readonly predictions: PredictionRepository;
  private readonly coverage: DataCoverageService;
  private stopped = false;
  private wakeSleep: (() => void) | undefined;
  private running = false;

  constructor(private readonly pool: DatabasePool, private readonly config: AppConfig,
    private readonly provider: FotMobProvider, private readonly logger: Logger) {
    this.football = new FootballRepository(pool);
    this.historical = new HistoricalRepository(pool);
    this.corners = new CornerRepository(pool);
    this.predictions = new PredictionRepository(pool, config.SUPPORTED_COMPETITIONS);
    this.coverage = new DataCoverageService(pool, config.SUPPORTED_COMPETITIONS);
  }

  enabled() {
    return this.config.BACKFILL_ENABLED && this.config.COMPETITION_BACKFILL_AUTO_ENABLED && this.config.FOTMOB_ENABLED;
  }

  stop() {
    this.stopped = true;
    this.wakeSleep?.();
  }

  private async wait(): Promise<void> {
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.wakeSleep = undefined;
        resolve();
      };
      const timer = setTimeout(finish, this.config.COMPETITION_BACKFILL_AUTO_INTERVAL_MS);
      this.wakeSleep = finish;
    });
  }

  private async rankedCandidates() {
    const coverage = await this.coverage.get();
    const rows = new Map(coverage.competitions.map((row) => [row.providerId, row]));
    const candidates = [];
    for (const competition of autoBackfillTargets(this.config)) {
      const row = rows.get(competition.id);
      if (!row) continue;
      const target = coverageTarget(row);
      if (!target.needsBackfill) continue;
      const previous = await this.historical.expansionReport(competition.id);
      const cycles = selectedCycleCount(competition.name, previous?.selectedSeasons ?? []);
      const completed = previous?.phase === 'COMPLETE' && previous.failures.length === 0;
      if (completed && cycles >= DATA_TARGET_V1.maxSeasonCycles) continue;
      if (recentFailure(previous)) continue;
      const desiredCycles = Math.min(DATA_TARGET_V1.maxSeasonCycles, Math.max(1, cycles + 1));
      candidates.push({
        competition,
        row,
        target,
        previous,
        cycles,
        desiredCycles,
        score: target.deficitScore + (row.finishedMatches === 0 ? 10 : 0),
      });
    }
    return candidates.sort((a, b) => b.score - a.score
      || a.row.finishedMatches - b.row.finishedMatches
      || a.competition.id - b.competition.id);
  }

  async runNext() {
    if (!this.enabled()) return { state: 'DISABLED' as const };
    if (this.running) return { state: 'IN_PROGRESS' as const };
    this.running = true;
    try {
      const candidate = (await this.rankedCandidates())[0];
      if (!candidate) return { state: 'TARGETS_MET_OR_CAPPED' as const, targetVersion: DATA_TARGET_V1 };

      const { competition, target, cycles, desiredCycles } = candidate;
      const lock = await this.pool.connect();
      try {
        const acquired = Boolean((await lock.query(
          "SELECT pg_try_advisory_lock(hashtext('competition-expansion-v1')) locked",
        )).rows[0]?.locked);
        if (!acquired) {
          this.logger.info({ competition: competition.key }, 'Competition target backfill skipped; advisory lock busy');
          return { state: 'LOCK_BUSY' as const, competition: competition.key };
        }
        try {
          const report = await runCompetitionBackfill(competition, {
            seasons: desiredCycles,
            resume: true,
            dryRun: false,
          }, {
            provider: this.provider,
            football: this.football,
            historical: this.historical,
            corners: this.corners,
            pause: () => new Promise<void>((resolve) => setTimeout(resolve,
              Math.max(this.config.HISTORICAL_REQUEST_DELAY_MS, 1_500))),
            refreshPipeline: async () => {
              const history = await this.corners.loadHistory();
              await this.corners.saveProfiles(buildAllTeamProfiles(history));
              await this.corners.saveBaselines(buildAllLeagueBaselines(history));
              await this.corners.saveDatasetAudit(auditDataset(history, await this.corners.auditIntegrity()));
              await this.predictions.refreshHistoricalIncremental();
            },
          });
          this.logger.info({
            competition: competition.key,
            status: report.status,
            targetBefore: target,
            cyclesBefore: cycles,
            requestedCycles: desiredCycles,
            fixturesPersisted: report.fixturesPersisted,
            statisticsSucceeded: report.statisticsSucceeded,
            statisticsUnavailable: report.statisticsUnavailable,
            statisticsFailed: report.statisticsFailed,
          }, 'Coverage-priority competition backfill completed');
          return {
            state: 'RAN' as const,
            competition: competition.key,
            targetBefore: target,
            cyclesBefore: cycles,
            requestedCycles: desiredCycles,
            report,
          };
        } finally {
          await lock.query("SELECT pg_advisory_unlock(hashtext('competition-expansion-v1'))").catch(() => undefined);
        }
      } finally {
        lock.release();
      }
    } finally {
      this.running = false;
    }
  }

  async runForever() {
    if (!this.enabled()) return;
    while (!this.stopped) {
      try {
        const result = await this.runNext();
        this.logger.info({ result }, 'Competition target backfill background cycle completed');
        if (result.state === 'TARGETS_MET_OR_CAPPED') return;
      } catch (error) {
        this.logger.error({ err: error }, 'Competition target backfill background cycle failed');
      }
      if (!this.stopped) await this.wait();
    }
  }
}
