export type HistoricalOddsCapability = 'SUPPORTED' | 'PARTIAL' | 'UNAVAILABLE' | 'BLOCKED' | 'NOT_VERIFIED';

export type HistoricalOddsEvidence = {
  fixtureCount: number;
  oddsRowCount: number;
  markets: readonly string[];
  /** Source fields that identify an observation time, not the time we fetched it. */
  sourceTimestampFields: readonly string[];
  /** A source statement or documented field meaning that a value is an opening price. */
  openingExplicitlyIdentified: boolean;
  /** A source statement or documented field proving the final value was recorded before kickoff. */
  closingExplicitlyPreKickoff: boolean;
};

export type HistoricalOddsQualification = {
  historicalFixtures: HistoricalOddsCapability;
  historicalSingleOddsState: HistoricalOddsCapability;
  genuineOpeningOdds: HistoricalOddsCapability;
  genuinePrematchClosingOdds: HistoricalOddsCapability;
  fullHistoricalMovement: HistoricalOddsCapability;
  genuineHistoricalTimestamps: HistoricalOddsCapability;
  markets: Record<'1X2' | 'ASIAN_HANDICAP' | 'TOTAL_GOALS' | 'CORNERS', HistoricalOddsCapability>;
};

const available = (present: boolean): HistoricalOddsCapability => present ? 'SUPPORTED' : 'UNAVAILABLE';

/**
 * This deliberately does not use field names such as `FirstUpodds` as evidence
 * of an opening price.  A historic row without an original observation time is
 * never eligible for odds_snapshots or an Odds Route.
 */
export function classifyHistoricalOdds(evidence: HistoricalOddsEvidence): HistoricalOddsQualification {
  const rows = evidence.oddsRowCount > 0;
  const timestamped = rows && evidence.sourceTimestampFields.length > 0;
  const market = (type: string) => available(rows && evidence.markets.includes(type));
  return {
    historicalFixtures: available(evidence.fixtureCount > 0),
    historicalSingleOddsState: rows ? (timestamped ? 'SUPPORTED' : 'PARTIAL') : 'UNAVAILABLE',
    genuineOpeningOdds: evidence.openingExplicitlyIdentified && timestamped ? 'SUPPORTED' : 'UNAVAILABLE',
    genuinePrematchClosingOdds: evidence.closingExplicitlyPreKickoff && timestamped ? 'SUPPORTED' : 'UNAVAILABLE',
    fullHistoricalMovement: timestamped ? 'NOT_VERIFIED' : 'UNAVAILABLE',
    genuineHistoricalTimestamps: available(timestamped),
    markets: {
      '1X2': market('1x2'),
      ASIAN_HANDICAP: market('HDP'),
      TOTAL_GOALS: market('OU'),
      CORNERS: market('CR'),
    },
  };
}
