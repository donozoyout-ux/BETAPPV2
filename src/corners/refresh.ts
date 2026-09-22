import type { AppConfig } from '../config.js';
import type { CornerRepository } from '../db/corner-repository.js';
import type { Logger } from '../logger.js';
import { isCompetitionConfigured } from '../matching/competition.js';
import { configHash, cornerModelConfig } from './config.js';
import { analyzeCorners } from './engine.js';
import { buildLeagueBaseline } from './profiles.js';

export async function refreshUpcomingCornerAnalyses(
  repository: Pick<CornerRepository, 'loadHistory' | 'upcomingRange' | 'saveAnalysis'>,
  config: Pick<AppConfig, 'SUPPORTED_COMPETITIONS' | 'COLLECTOR_FUTURE_DAYS'>,
  logger: Pick<Logger, 'info' | 'error'>,
  now = new Date(),
) {
  const to = new Date(now.getTime() + config.COLLECTOR_FUTURE_DAYS * 86_400_000);
  const [history, upcoming] = await Promise.all([repository.loadHistory(true),
    repository.upcomingRange(now,to,config.SUPPORTED_COMPETITIONS)]);
  const summary = { scheduledTargets: 0, generated: 0, alreadyExisting: 0, insufficientData: 0, failed: 0 };
  const hash = configHash(cornerModelConfig);
  for (const target of upcoming) {
    const kickoffAt = new Date(target.kickoff_at);
    if (target.status !== 'scheduled' || kickoffAt <= now || kickoffAt > to || kickoffAt.getTime() <= Date.now()
      || !isCompetitionConfigured(String(target.competition), config.SUPPORTED_COMPETITIONS)) continue;
    summary.scheduledTargets += 1;
    try {
      const match = { competitionId: String(target.competition_id), season: String(target.season ?? 'unknown'),
        homeTeamId: String(target.home_team_id), awayTeamId: String(target.away_team_id), kickoffAt };
      const eligibleHistory = history.filter((row) => row.kickoffAt < kickoffAt);
      const baseline = buildLeagueBaseline(eligibleHistory,match.competitionId,match.season,kickoffAt);
      const analysis = analyzeCorners({ match, history: eligibleHistory, baseline },cornerModelConfig);
      if (!analysis.dataQuality.analysisEligible) summary.insufficientData += 1;
      if (kickoffAt.getTime() <= Date.now()) continue;
      const inserted = await repository.saveAnalysis(String(target.id),analysis,cornerModelConfig,hash);
      if (inserted) summary.generated += 1;
      else summary.alreadyExisting += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error({ err: error, matchId: target.id }, 'Corner target refresh failed; continuing');
    }
  }
  logger.info(summary, 'Upcoming corner refresh completed');
  return summary;
}
