// Local visual verification only. Uses synthetic repositories; no database or provider connection.
// Run: npx tsx scripts/ui-preview.ts
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { DataCoverageService } from '../src/data/coverage.js';
import { dashboardFixture } from '../test/fixtures/dashboard-ui.js';

const data = dashboardFixture();
const config = loadConfig({ DATABASE_URL: 'postgresql://unused/ui_fixture', LOG_LEVEL: 'silent' });
const coverage = new DataCoverageService({ query: async () => ({ rows: [] }) } as never, config.SUPPORTED_COMPETITIONS);
const rows = async () => [];
const absent = async () => null;
const repository = {
  databaseHealth: async () => ({status:'ok'}), operationalHealth: async () => ({providers:{},worker:{lastRun:null,lastSuccess:null},backfill:{status:'NOT_STARTED'}}),
  dashboardData: async () => data, liveMatches: rows, liveProviderHealth: absent,
  matchAnalysisDetail: async (id: string) => data.matches.find(m => m.id === id) ?? null,
  cornerAnalysisDetail: absent, dataCoverage: () => coverage.get(),
};
const predictions = {
  today: rows, previews: async () => data.predictionPreviews, reviewCandidates: async () => data.predictionReviewCandidates,
  history: rows, performance: absent, latestSelfAudit: absent, latestSegmentSelfAudits: rows,
  latestRootCauseAudits: rows, latestAdaptiveRuleProposals: rows, oddsSimilarityShowcase: rows, diagnostics: absent,
  gates: async (id: string) => data.predictionPreviews.find(p => p.match_id === id)?.predictionGate ?? data.predictionReviewCandidates.find(p => p.matchId === id)?.predictionGate ?? null,
  detail: async () => ({ state: 'PREVIEW', runs: [], journal: null }),
  csvStageResearch: async () => ({ summary: { total: 0, researchEligible: 0, matches: 0, competitions: 0, invalidOfficial: 0, invalidTimingKnown: 0 }, groups: [] }),
};
const app = buildApp(config, repository as never, createLogger(config), undefined, predictions as never);
await app.listen({ host: '127.0.0.1', port: 4318 });
process.stdout.write('UI preview: http://127.0.0.1:4318 — synthetic fixtures, no DB access\n');
