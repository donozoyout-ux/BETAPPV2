import { describe, expect, it } from 'vitest';
import { historicalDataQuality, historicalFieldPresence } from '../../src/historical/quality.js';
import { canStartHistoricalCollector, disabledAutomatedSources, historicalProviderPolicies } from '../../src/historical/provider-policy.js';
import { shouldReplaceHistoricalStats } from '../../src/historical/precedence.js';
import { normalizeTeamAlias } from '../../src/matching/team-alias.js';
import type { MatchStatistics } from '../../src/domain/types.js';

const complete: MatchStatistics = { matchProviderExternalId: 'fixture', sourceUpdatedAt: new Date(), raw: {}, statistics: [
  'corners','yellow_cards','total_shots','shots_on_target','fouls_committed','ball_possession','offsides','expected_goals',
].map((key) => ({ key, label: key, period: 'ALL', homeValue: 1, awayValue: 1 })) };

describe('free historical data architecture', () => {
  it('classifies canonical data quality and never invents missing fields', () => {
    expect(historicalDataQuality(1, 0, complete)).toBe('COMPLETE');
    expect(historicalDataQuality(1, 0, { ...complete, statistics: [] })).toBe('LIMITED');
    expect(historicalDataQuality(null, 0, complete)).toBe('POOR');
    expect(historicalFieldPresence({ ...complete, statistics: [] }).xg).toBe(false);
  });

  it('keeps FotMob precedence and preserves a stronger provider record', () => {
    expect(shouldReplaceHistoricalStats('fotmob', 'COMPLETE', 'statbunker', 'COMPLETE')).toBe(false);
    expect(shouldReplaceHistoricalStats('statbunker', 'LIMITED', 'fotmob', 'PARTIAL')).toBe(true);
    expect(shouldReplaceHistoricalStats(null, null, 'fotmob', 'LIMITED')).toBe(true);
  });

  it('keeps unqualified and paid sources from starting collectors', () => {
    expect(canStartHistoricalCollector('fotmob')).toBe(true);
    expect(canStartHistoricalCollector('openfootball')).toBe(true);
    expect(canStartHistoricalCollector('football-data-csv')).toBe(false);
    expect(historicalProviderPolicies.openfootball.status).toBe('PRODUCTION_ELIGIBLE');
    expect(canStartHistoricalCollector('statbunker')).toBe(false);
    expect(canStartHistoricalCollector('soccerstats')).toBe(false);
    expect(canStartHistoricalCollector('adamchoi')).toBe(false);
    expect(historicalProviderPolicies.footystats.status).toBe('DISABLED_PAID_API');
    expect(disabledAutomatedSources).toEqual({ flashscore: false, cornerprobet: false, stats24: false, footystatsHtml: false });
  });

  it('normalizes cross-provider team aliases deterministically', () => {
    expect(normalizeTeamAlias('Fenerbahçe')).toBe(normalizeTeamAlias('Fenerbahce'));
    expect(normalizeTeamAlias('Paris Saint-Germain')).toBe(normalizeTeamAlias('PSG'));
    expect(normalizeTeamAlias('Manchester Utd')).toBe(normalizeTeamAlias('Manchester United'));
  });
});
