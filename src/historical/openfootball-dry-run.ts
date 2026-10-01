import type { AppConfig } from '../config.js';
import { parseOpenFootballDataset } from './openfootball-parser.js';
import { openFootballDatasets, openFootballInternationalDatasets, type OpenFootballDataset } from './openfootball-source.js';
import { competitionKey } from '../matching/competition.js';

export type OpenFootballDryRunCompetitionSummary = {
  competition: string;
  configKey: string;
  season: string;
  totalMatches: number;
  finishedResults: number;
  skippedUnfinished: number;
  skippedUnsafeTime: number;
};

export type OpenFootballDryRunReport = {
  provider: 'openfootball';
  dryRun: true;
  totalDatasets: number;
  totalMatchesDiscovered: number;
  eligibleFinishedResults: number;
  skippedUnfinished: number;
  skippedUnsafeTime: number;
  dateMin: string | null;
  dateMax: string | null;
  competitions: OpenFootballDryRunCompetitionSummary[];
};

export async function runOpenFootballDryRun(
  config: AppConfig,
  options: { competition?: string | undefined; season?: string | undefined; fromDate?: string | undefined } = {},
): Promise<OpenFootballDryRunReport> {
  const fromDate = options.fromDate ? new Date(options.fromDate) : new Date('2024-01-01T00:00:00.000Z');
  const seasons = options.season
    ? [options.season.replace('/', '-')]
    : config.OPENFOOTBALL_IMPORT_SEASONS;

  let datasets: OpenFootballDataset[] = [
    ...openFootballDatasets(config.OPENFOOTBALL_BASE_URL, seasons, config.SUPPORTED_COMPETITIONS),
    ...openFootballInternationalDatasets(config.SUPPORTED_COMPETITIONS),
  ];

  if (options.competition) {
    const targetKey = competitionKey(options.competition);
    datasets = datasets.filter((ds) => competitionKey(ds.competition) === targetKey || ds.configKey.toLowerCase() === options.competition?.toLowerCase());
  }

  const summaries: OpenFootballDryRunCompetitionSummary[] = [];
  let totalDiscovered = 0;
  let totalEligible = 0;
  let totalSkippedUnfinished = 0;
  let totalSkippedUnsafeTime = 0;
  let dateMin: string | null = null;
  let dateMax: string | null = null;

  for (const ds of datasets) {
    try {
      const response = await fetch(ds.url, {
        headers: { 'user-agent': 'BETAPPV2/2.0 openfootball-dry-run' },
        signal: AbortSignal.timeout(config.PROVIDER_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const text = await response.text();
      const payload = JSON.parse(text) as unknown;
      const parsed = parseOpenFootballDataset(payload, ds);

      const filteredMatches = parsed.matches.filter((m) => {
        const kickoff = m.match.kickoffAt;
        return kickoff && kickoff >= fromDate;
      });

      totalDiscovered += parsed.totalMatches;
      totalEligible += filteredMatches.length;
      totalSkippedUnfinished += parsed.skippedUnfinished;
      totalSkippedUnsafeTime += parsed.skippedUnsafeTime;

      for (const m of filteredMatches) {
        const iso = m.match.kickoffAt?.toISOString();
        if (iso) {
          if (!dateMin || iso < dateMin) dateMin = iso;
          if (!dateMax || iso > dateMax) dateMax = iso;
        }
      }

      summaries.push({
        competition: ds.competition,
        configKey: ds.configKey,
        season: ds.season,
        totalMatches: parsed.totalMatches,
        finishedResults: filteredMatches.length,
        skippedUnfinished: parsed.skippedUnfinished,
        skippedUnsafeTime: parsed.skippedUnsafeTime,
      });
    } catch {
      // Continue next dataset on fetch failure
    }
  }

  return {
    provider: 'openfootball',
    dryRun: true,
    totalDatasets: datasets.length,
    totalMatchesDiscovered: totalDiscovered,
    eligibleFinishedResults: totalEligible,
    skippedUnfinished: totalSkippedUnfinished,
    skippedUnsafeTime: totalSkippedUnsafeTime,
    dateMin,
    dateMax,
    competitions: summaries,
  };
}
