import type { AppConfig } from '../config.js';
import type { DatabasePool } from '../db/pool.js';
import { FootballRepository } from '../db/repository.js';
import { HistoricalRepository } from '../db/historical-repository.js';
import { CornerRepository } from '../db/corner-repository.js';
import { PredictionRepository } from '../predictions/service.js';
import { buildAllLeagueBaselines, buildAllTeamProfiles } from '../corners/profiles.js';
import { auditDataset } from '../data/audit.js';
import { FotMobProvider, fotmobCompetitions } from '../providers/fotmob.js';
import { runCompetitionBackfill } from './competition-backfill.js';
import type { ExpansionReport } from './competition-scope.js';
import type { Logger } from '../logger.js';

export const priorityAutoBackfillKeys = [
  'Eredivisie','BelgianProLeague','DanishSuperliga','Allsvenskan','GreekSuperLeague',
  'WorldCup','EURO','EUROQualification','UefaNationsLeagueA','WorldCupQualificationUEFA','InternationalFriendlies',
] as const;

export function autoBackfillTargets(config: AppConfig) {
  const allowed = new Set(config.SUPPORTED_COMPETITIONS);
  const wanted = new Set(priorityAutoBackfillKeys);
  return fotmobCompetitions.filter((competition) => allowed.has(competition.key) && wanted.has(competition.key as typeof priorityAutoBackfillKeys[number]));
}

function reportNeedsRun(report: ExpansionReport | null) {
  if (!report) return true;
  if (report.phase !== 'COMPLETE') return true;
  if (report.status === 'FAILED') return true;
  if (report.status === 'PARTIAL' && report.failures.length > 0) return true;
  return false;
}

export class CompetitionAutoBackfill {
  private readonly football: FootballRepository;
  private readonly historical: HistoricalRepository;
  private readonly corners: CornerRepository;
  private readonly predictions: PredictionRepository;
  private readonly attempted = new Set<number>();

  constructor(private readonly pool: DatabasePool, private readonly config: AppConfig,
    private readonly provider: FotMobProvider, private readonly logger: Logger) {
    this.football = new FootballRepository(pool);
    this.historical = new HistoricalRepository(pool);
    this.corners = new CornerRepository(pool);
    this.predictions = new PredictionRepository(pool, config.SUPPORTED_COMPETITIONS);
  }

  enabled() {
    return this.config.BACKFILL_ENABLED && this.config.COMPETITION_BACKFILL_AUTO_ENABLED && this.config.FOTMOB_ENABLED;
  }

  async runNext() {
    if (!this.enabled()) return { state: 'DISABLED' as const };
    for (const competition of autoBackfillTargets(this.config)) {
      if (this.attempted.has(competition.id)) continue;
      const previous = await this.historical.expansionReport(competition.id);
      if (!reportNeedsRun(previous)) {
        this.attempted.add(competition.id);
        continue;
      }

      this.attempted.add(competition.id);
      const lock = await this.pool.connect();
      try {
        const acquired = Boolean((await lock.query(
          "SELECT pg_try_advisory_lock(hashtext('competition-expansion-v1')) locked",
        )).rows[0]?.locked);
        if (!acquired) {
          this.logger.info({ competition: competition.key }, 'Competition auto backfill skipped; advisory lock busy');
          return { state: 'LOCK_BUSY' as const, competition: competition.key };
        }
        try {
          const report = await runCompetitionBackfill(competition, {
            seasons: this.config.COMPETITION_BACKFILL_AUTO_SEASONS,
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
            fixturesPersisted: report.fixturesPersisted,
            statisticsSucceeded: report.statisticsSucceeded,
            statisticsUnavailable: report.statisticsUnavailable,
            statisticsFailed: report.statisticsFailed,
          }, 'Competition auto backfill completed');
          return { state: 'RAN' as const, competition: competition.key, report };
        } finally {
          await lock.query("SELECT pg_advisory_unlock(hashtext('competition-expansion-v1'))").catch(() => undefined);
        }
      } finally {
        lock.release();
      }
    }
    return { state: 'COMPLETE' as const };
  }
}
