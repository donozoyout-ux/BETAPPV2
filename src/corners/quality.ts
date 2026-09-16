import { clamp } from './statistics.js';

export type QualityInput = {
  homeSample: number; awaySample: number; leagueSample: number; recentHome: number; recentAway: number;
  cornerCompleteness: number; consensusConfidence: number; missingFields: string[];
};

export function calculateDataQuality(input: QualityInput, minimumEligible: number) {
  const sampleScore = Math.min(input.homeSample, 20) / 20 * 15 + Math.min(input.awaySample, 20) / 20 * 15;
  const leagueScore = Math.min(input.leagueSample, 100) / 100 * 15;
  const recentScore = Math.min(input.recentHome, 5) / 5 * 7.5 + Math.min(input.recentAway, 5) / 5 * 7.5;
  const completenessScore = clamp(input.cornerCompleteness, 0, 1) * 25;
  const consensusScore = clamp(input.consensusConfidence, 0, 1) * 10;
  const missingPenalty = Math.min(20, input.missingFields.length * 4);
  const score = Math.round(clamp(sampleScore + leagueScore + recentScore + completenessScore + consensusScore - missingPenalty, 0, 100));
  const status = score >= 85 ? 'EXCELLENT' : score >= 70 ? 'GOOD' : score >= 45 ? 'LIMITED' : 'POOR';
  return { score, status, analysisEligible: score >= minimumEligible && status !== 'POOR', missingFields: input.missingFields } as const;
}

export type ConfidenceInput = {
  homeSample: number; awaySample: number; variance: number; mean: number;
  venueAgreement: number; recentConsistency: number; teamLeagueDeviation: number; distributionSample: number;
};

export function calculateModelConfidence(input: ConfidenceInput): number {
  const sample = Math.min(input.homeSample + input.awaySample, 40) / 40 * 25;
  const varianceStability = (1 - clamp(input.variance / Math.max(input.mean * 3, 1), 0, 1)) * 20;
  const agreement = (1 - clamp(input.venueAgreement / 4, 0, 1)) * 15;
  const consistency = (1 - clamp(input.recentConsistency / 4, 0, 1)) * 15;
  const deviation = (1 - clamp(input.teamLeagueDeviation / 5, 0, 1)) * 15;
  const distribution = Math.min(input.distributionSample, 100) / 100 * 10;
  return Math.round(clamp(sample + varianceStability + agreement + consistency + deviation + distribution, 0, 100));
}
