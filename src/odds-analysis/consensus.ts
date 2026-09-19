import type { BookmakerSelectionMovement, ConsensusResult } from './types.js';

export function median(values: readonly number[]): number {
  if (!values.length) throw new RangeError('Median requires at least one value');
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function medianAbsoluteDeviation(values: readonly number[]): number {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

export function calculateConsensus(votes: BookmakerSelectionMovement[]): ConsensusResult {
  const oneVotePerBookmaker = [...new Map(votes.map((vote) => [vote.provider, vote])).values()];
  if (!oneVotePerBookmaker.length) throw new RangeError('Consensus requires at least one bookmaker');
  const deltas = oneVotePerBookmaker.map((vote) => vote.probabilityDeltaPp);
  const medianDelta = median(deltas);
  const direction = Math.sign(medianDelta);
  const agrees = deltas.filter((delta) => direction === 0 ? Math.abs(delta) < 0.01 : Math.sign(delta) === direction).length;
  const currentOdds = oneVotePerBookmaker.map((vote) => vote.currentOdds);
  const oddsCenter = median(currentOdds);
  return {
    bookmakerCount: oneVotePerBookmaker.length, agreeingBookmakerCount: agrees,
    disagreeingBookmakerCount: oneVotePerBookmaker.length - agrees,
    medianOpeningOdds: median(oneVotePerBookmaker.map((vote) => vote.openingOdds)), medianCurrentOdds: oddsCenter,
    highestOdds: Math.max(...oneVotePerBookmaker.map((vote) => vote.highestOdds)),
    lowestOdds: Math.min(...oneVotePerBookmaker.map((vote) => vote.lowestOdds)),
    snapshotCount: oneVotePerBookmaker.reduce((sum, vote) => sum + vote.snapshotCount, 0),
    minimumSelectionSnapshotCount: Math.min(...oneVotePerBookmaker.map((vote) => vote.minimumMarketSelectionSnapshotCount)),
    completeStateBookmakerCount: oneVotePerBookmaker.filter((vote) => vote.hasDistinctCompleteStates).length,
    minimumCompleteStateCount: Math.min(...oneVotePerBookmaker.map((vote) => vote.completeStateCount)),
    medianOpeningFairProbability: median(oneVotePerBookmaker.map((vote) => vote.openingFairProbability)),
    medianCurrentFairProbability: median(oneVotePerBookmaker.map((vote) => vote.currentFairProbability)),
    medianProbabilityDeltaPp: medianDelta,
    probabilityDispersion: medianAbsoluteDeviation(oneVotePerBookmaker.map((vote) => vote.currentFairProbability * 100)),
    oddsDispersion: oddsCenter === 0 ? 0 : (medianAbsoluteDeviation(currentOdds) / oddsCenter) * 100,
    movementAgreementRatio: agrees / oneVotePerBookmaker.length,
    latestCapturedAt: new Date(Math.max(...oneVotePerBookmaker.map((vote) => vote.currentCapturedAt.getTime()))),
  };
}
