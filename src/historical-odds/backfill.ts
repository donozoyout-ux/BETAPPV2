import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { NowgoalProvider } from '../providers/nowgoal.js';
import type { HistoricalArchivedOddsRepository } from './repository.js';
import type { ArchivedOddsBackfillProgress } from './types.js';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export type ArchivedOddsBackfillOptions = {
  from: string;
  to: string;
  write: boolean;
  resume: boolean;
  companyIds?: readonly number[];
};

export class HistoricalArchivedOddsBackfill {
  constructor(
    private readonly provider: NowgoalProvider,
    private readonly repository: HistoricalArchivedOddsRepository,
    private readonly config: Pick<AppConfig, 'HISTORICAL_REQUEST_DELAY_MS'>,
    private readonly logger: Logger,
  ) {}

  async run(options: ArchivedOddsBackfillOptions) {
    const from = parseDate(options.from);
    const to = parseDate(options.to);
    if (from > to) throw new Error('Historical odds backfill from date must be <= to date');
    const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > 180) throw new Error('Historical odds backfill is bounded to 180 days per job');

    const progress: ArchivedOddsBackfillProgress = {
      datesRequested: 0,
      fixturesSeen: 0,
      finishedFixtures: 0,
      matched: 0,
      unmatched: 0,
      ambiguous: 0,
      statesSeen: 0,
      inserted: 0,
      duplicates: 0,
      errors: 0,
      cursorDate: null,
    };

    let job: { id: string; cursor_date: string | null } | null = null;
    if (options.write) job = await this.repository.startJob('nowgoal', options.from, options.to);
    const resumeAfter = options.write && options.resume && job?.cursor_date ? String(job.cursor_date).slice(0, 10) : null;

    for (let cursor = new Date(from); cursor <= to; cursor = addDays(cursor, 1)) {
      const sourceDate = isoDate(cursor);
      if (resumeAfter && sourceDate <= resumeAfter) continue;
      progress.datesRequested += 1;

      try {
        const diary = await this.provider.getHistoricalArchivedOddsForDate(cursor, options.companyIds ?? [2, 22]);
        progress.fixturesSeen += diary.fixtures.length;
        const finished = diary.fixtures.filter((fixture) => fixture.finished);
        progress.finishedFixtures += finished.length;

        const statesByMatch = new Map<string, typeof diary.states>();
        for (const state of diary.states) {
          statesByMatch.set(state.providerMatchId, [...(statesByMatch.get(state.providerMatchId) ?? []), state]);
        }

        for (const fixture of finished) {
          const states = statesByMatch.get(fixture.providerMatchId) ?? [];
          if (!states.length) continue;
          progress.statesSeen += states.length;
          const resolution = await this.repository.resolveHistoricalMatch(fixture);
          if (resolution.status === 'UNMATCHED') {
            progress.unmatched += 1;
            continue;
          }
          if (resolution.status === 'AMBIGUOUS') {
            progress.ambiguous += 1;
            continue;
          }
          progress.matched += 1;
          if (options.write) {
            const stored = await this.repository.saveStates(
              resolution.matchId,
              fixture,
              states,
              sourceDate,
              new Date(),
            );
            progress.inserted += stored.inserted;
            progress.duplicates += stored.duplicates;
          }
        }

        progress.cursorDate = sourceDate;
        if (job) await this.repository.updateJob(job.id, progress, 'RUNNING');
        this.logger.info({
          sourceDate,
          write: options.write,
          matched: progress.matched,
          unmatched: progress.unmatched,
          ambiguous: progress.ambiguous,
          statesSeen: progress.statesSeen,
          inserted: progress.inserted,
        }, 'Historical archived odds date processed');
      } catch (error) {
        progress.errors += 1;
        progress.cursorDate = sourceDate;
        if (job) {
          await this.repository.updateJob(
            job.id,
            progress,
            'FAILED',
            error instanceof Error ? error.message : String(error),
          );
        }
        throw error;
      }

      if (cursor < to && this.config.HISTORICAL_REQUEST_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.config.HISTORICAL_REQUEST_DELAY_MS));
      }
    }

    if (job) await this.repository.updateJob(job.id, progress, 'COMPLETED');
    return {
      ...progress,
      mode: options.write ? 'WRITE' : 'DRY_RUN',
      semantics: 'ARCHIVED_ODDS_LEVEL_ONLY',
      routeEligible: false,
      openingClosingKnown: false,
      source: 'nowgoal',
      from: options.from,
      to: options.to,
    };
  }
}
