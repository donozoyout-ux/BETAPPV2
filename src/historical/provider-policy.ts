import type { HistoricalProviderId, HistoricalProviderStatus } from './types.js';

export type HistoricalProviderPolicy = {
  id: HistoricalProviderId; automatedCollection: boolean; status: HistoricalProviderStatus;
  reason: string; baseUrl: string; priority: number;
};

export const historicalProviderPolicies: Record<HistoricalProviderId, HistoricalProviderPolicy> = {
  fotmob: { id: 'fotmob', automatedCollection: true, status: 'PRODUCTION_ELIGIBLE', priority: 1,
    baseUrl: 'https://www.fotmob.com', reason: 'Existing bounded collector and historical season flow.' },
  'football-data-csv': { id: 'football-data-csv', automatedCollection: false, status: 'MANUAL_REVIEW_REQUIRED', priority: 2,
    baseUrl: 'https://football-data.co.uk', reason: 'Existing/manual archive only; automated collection disabled by current source usage terms.' },
  openfootball: { id: 'openfootball', automatedCollection: true, status: 'PRODUCTION_ELIGIBLE', priority: 3,
    baseUrl: 'https://github.com/openfootball/football.json', reason: 'CC0/public-domain match results with explicit date and kickoff time.' },
  statbunker: { id: 'statbunker', automatedCollection: false, status: 'MANUAL_REVIEW_REQUIRED', priority: 2,
    baseUrl: 'https://www.statbunker.com', reason: 'Public pages exist but automated-access permission is not established.' },
  soccerstats: { id: 'soccerstats', automatedCollection: false, status: 'MANUAL_REVIEW_REQUIRED', priority: 3,
    baseUrl: 'https://www.soccerstats.com', reason: 'Automated public-page permission requires manual review.' },
  adamchoi: { id: 'adamchoi', automatedCollection: false, status: 'MANUAL_REVIEW_REQUIRED', priority: 4,
    baseUrl: 'https://www.adamchoi.co.uk', reason: 'No production collection without explicit permission.' },
  footystats: { id: 'footystats', automatedCollection: false, status: 'DISABLED_PAID_API', priority: 99,
    baseUrl: 'https://footystats.org', reason: 'HTML automation is prohibited; documented API requires a subscription except examples.' },
};

export const disabledAutomatedSources = Object.freeze({ flashscore: false, cornerprobet: false, stats24: false, footystatsHtml: false });

export function canStartHistoricalCollector(provider: HistoricalProviderId): boolean {
  return historicalProviderPolicies[provider].automatedCollection;
}
