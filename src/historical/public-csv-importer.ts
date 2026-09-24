import { createHash } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { FootballRepository } from '../db/repository.js';
import type { HistoricalRepository } from '../db/historical-repository.js';
import type { PredictionRepository } from '../predictions/service.js';
import type { Logger } from '../logger.js';
import { parseFootballDataDataset } from './public-csv-parser.js';
import { PublicCsvImportRepository } from './public-csv-repository.js';
import { currentFootballDataSeasonCode, publicCsvDatasets, type PublicCsvDataset } from './public-csv-source.js';

const FAILURE_COOLDOWN_MS = 6 * 60 * 60_000;

export class PublicCsvHistoricalImporter {
  private stopped = false;
  private running = false;
  private wake: (() => void) | undefined;
  private readonly cooldowns = new Map<string, number>();

  constructor(
    private readonly config: AppConfig,
    private readonly football: FootballRepository,
    private readonly historical: HistoricalRepository,
    private readonly imports: PublicCsvImportRepository,
    private readonly predictions: PredictionRepository,
    private readonly logger: Logger,
  ) {}

  enabled() {
    return this.config.PUBLIC_CSV_IMPORT_ENABLED;
  }

  stop() {
    this.stopped = true;
    this.wake?.();
  }

  private datasets() {
    return publicCsvDatasets(
      this.config.PUBLIC_CSV_IMPORT_BASE_URL,
      this.config.PUBLIC_CSV_IMPORT_SEASONS,
      this.config.SUPPORTED_COMPETITIONS,
    );
  }

  private async fetchCsv(dataset: PublicCsvDataset) {
    const response = await fetch(dataset.url, {
      headers: { 'user-agent': 'BETAPPV2/2.0 historical-data-import' },
      signal: AbortSignal.timeout(this.config.PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`PUBLIC_CSV_HTTP_${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder('windows-1252').decode(bytes);
    return {
      text,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  private async nextDataset(now = new Date()) {
    const datasets = this.datasets();
    await this.imports.ensureDatasets(datasets);
    const currentSeason = currentFootballDataSeasonCode(now);
    let waitingRetry = false;
    let rollingIdle = false;
    for (const dataset of datasets) {
      const state = await this.imports.state(dataset.sourceKey);
      const cooldownUntil = this.cooldowns.get(dataset.sourceKey) ?? 0;
      if (cooldownUntil > now.getTime()) { waitingRetry = true; continue; }
      if (state?.status === 'COMPLETED') {
        if (dataset.seasonCode !== currentSeason) continue;
        rollingIdle = true;
        const checkedAt = state.updated_at ? new Date(state.updated_at).getTime() : 0;
        if (now.getTime() - checkedAt < this.config.PUBLIC_CSV_CURRENT_REFRESH_MS) continue;
        return { dataset, state, rolling: true };
      }
      return { dataset, state, rolling: false };
    }
    return waitingRetry || rollingIdle
      ? { dataset: null, state: null, waitingRetry, rollingIdle }
      : null;
  }

  async runCycle() {
    if (!this.enabled()) return { state: 'DISABLED' as const };
    if (this.running) return { state: 'IN_PROGRESS' as const };
    this.running = true;
    try {
      const candidate = await this.nextDataset();
      if (!candidate) return { state: 'COMPLETE' as const };
      if (!candidate.dataset) return candidate.waitingRetry
        ? { state: 'WAITING_RETRY' as const }
        : { state: 'IDLE' as const };
      const { dataset } = candidate;

      try {
        const fetchedAt = new Date();
        const fetched = await this.fetchCsv(dataset);
        let state = candidate.state;
        if (state?.status === 'COMPLETED' && state.content_hash === fetched.contentHash) {
          await this.imports.markChecked(dataset.sourceKey);
          this.cooldowns.delete(dataset.sourceKey);
          return { state: 'NO_CHANGE' as const, sourceKey: dataset.sourceKey, season: dataset.seasonLabel };
        }
        if (state?.content_hash && state.content_hash !== fetched.contentHash) {
          await this.imports.resetForChangedContent(dataset.sourceKey);
          state = await this.imports.state(dataset.sourceKey);
        }
        const parsed = parseFootballDataDataset(fetched.text, dataset, fetchedAt);
        await this.imports.markRunning(dataset, fetched.contentHash, Math.max(0, fetched.text.split(/\r?\n/).length - 1), parsed.length);
        state = await this.imports.state(dataset.sourceKey);
        const start = Math.max(0, Number(state?.cursor_row ?? 0));
        if (start >= parsed.length) {
          await this.imports.markCompleted(dataset.sourceKey);
          await this.predictions.refreshHistoricalIncremental().catch((error) =>
            this.logger.warn({ err: error, sourceKey: dataset.sourceKey }, 'Prediction refresh after CSV import failed'));
          return { state: 'DATASET_COMPLETED' as const, sourceKey: dataset.sourceKey, imported: 0 };
        }

        const batch = parsed.slice(start, start + this.config.PUBLIC_CSV_IMPORT_BATCH_SIZE);
        let importedRows = 0;
        let matchesInserted = 0;
        let matchesUpdated = 0;
        let duplicatesPrevented = 0;
        let statisticsRows = 0;
        let oddsRows = 0;

        for (const item of batch) {
          if (this.stopped) break;
          const outcome = { matchesInserted:0,matchesUpdated:0,teamsCreated:0,duplicateMatchesPrevented:0 };
          const matchId = await this.football.upsertMatch('football-data-csv', item.match, outcome);
          await this.football.upsertStatistics('football-data-csv', item.statistics);
          await this.historical.save('football-data-csv', item.match, item.statistics, fetchedAt, item.refereeExternalId, true);
          const archived = await this.imports.saveArchivedOdds(matchId, dataset.sourceKey, item.rowHash, item.odds);
          importedRows += 1;
          matchesInserted += outcome.matchesInserted;
          matchesUpdated += outcome.matchesUpdated;
          duplicatesPrevented += outcome.duplicateMatchesPrevented;
          if (item.statistics.statistics.length) statisticsRows += 1;
          oddsRows += archived;
        }

        const cursorRow = start + importedRows;
        await this.imports.markProgress(dataset.sourceKey, {
          cursorRow, importedRows, matchesInserted, matchesUpdated, duplicatesPrevented, statisticsRows, oddsRows,
        });

        if (cursorRow >= parsed.length) {
          await this.imports.markCompleted(dataset.sourceKey);
          await this.predictions.refreshHistoricalIncremental().catch((error) =>
            this.logger.warn({ err: error, sourceKey: dataset.sourceKey }, 'Prediction refresh after CSV import failed'));
        }

        this.cooldowns.delete(dataset.sourceKey);
        const result = {
          state: cursorRow >= parsed.length ? 'DATASET_COMPLETED' as const : 'BATCH_IMPORTED' as const,
          sourceKey: dataset.sourceKey,
          competition: dataset.competition,
          season: dataset.seasonLabel,
          cursorRow,
          validRows: parsed.length,
          importedRows,
          matchesInserted,
          matchesUpdated,
          duplicatesPrevented,
          statisticsRows,
          oddsRows,
        };
        this.logger.info(result, 'Public CSV historical import cycle completed');
        return result;
      } catch (error) {
        await this.imports.markFailed(dataset.sourceKey, error).catch(() => undefined);
        this.cooldowns.set(dataset.sourceKey, Date.now() + FAILURE_COOLDOWN_MS);
        this.logger.warn({ err:error, sourceKey:dataset.sourceKey, url:dataset.url },
          'Public CSV historical dataset failed; other datasets may continue');
        return { state:'ERROR' as const, sourceKey:dataset.sourceKey,
          error:error instanceof Error ? error.message : String(error) };
      }
    } finally {
      this.running = false;
    }
  }

  private async wait() {
    await new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
      const timer = setTimeout(finish, this.config.PUBLIC_CSV_IMPORT_INTERVAL_MS);
      this.wake = finish;
    });
  }

  async runForever() {
    if (!this.enabled()) return;
    while (!this.stopped) {
      const result = await this.runCycle();
      if (result.state === 'COMPLETE') return;
      if (!this.stopped) await this.wait();
    }
  }
}
