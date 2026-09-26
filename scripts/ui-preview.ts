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
const humanModeGates = [
  { key: 'ODDS_ANALYSIS', label: 'Oran analizi', current: 'VAR', required: 'VAR', passed: true, reason: null, reasonCode: null },
  { key: 'PREDICTION_RUN', label: 'Prediction V1 değerlendirmesi', current: 'VAR', required: 'VAR', passed: true, reason: null, reasonCode: null },
  { key: 'ODDS_ELIGIBILITY', label: 'Oran analizi uygunluğu', current: 'HENÜZ UYGUN DEĞİL', required: 'UYGUN', passed: false, reason: 'Oran analizi henüz resmi tahmine uygun değil.', reasonCode: 'ODDS_NOT_ELIGIBLE' },
  { key: 'BOOKMAKERS', label: 'Bahis şirketi', current: 3, required: 3, passed: true, reason: null, reasonCode: null },
  { key: 'COMPLETE_STATES', label: 'Açılış / güncel oran ölçümü', current: { bookmakers: 0, states: 1 }, required: { bookmakers: 3, states: 2 }, passed: false, reason: 'Açılış ve güncel oranı karşılaştırmak için yeterli ölçüm yok.', reasonCode: 'INSUFFICIENT_COMPLETE_STATES' },
  { key: 'DATA_QUALITY', label: 'Veri kalitesi', current: 25, required: 50, passed: false, reason: 'Veri kalitesi resmi tahmin için yeterli değil.', reasonCode: 'LOW_DATA_QUALITY' },
  { key: 'MODEL_CONFIDENCE', label: 'Model güveni', current: 44, required: 45, passed: false, reason: 'Model güveni yeterli değil.', reasonCode: 'LOW_MODEL_CONFIDENCE' },
  { key: 'MOVEMENT', label: 'Oran hareketi', current: 'NEUTRAL', required: ['SUPPORT','STRONG_SUPPORT'], passed: false, reason: 'Bookmakerlarda yeterli oran hareketi oluşmadı.', reasonCode: 'MOVEMENT_NOT_SUPPORTED' },
  { key: 'HISTORICAL_SAMPLE', label: 'Geçmiş benzer maç', current: 2, required: 30, passed: false, reason: 'Benzer geçmiş maç sayısı yetersiz.', reasonCode: 'INSUFFICIENT_HISTORICAL_SAMPLE' },
  { key: 'PREDICTION_SCORE', label: 'Tahmin skoru', current: 36.66, required: 70, passed: false, reason: 'Tahmin skoru resmi eşik altında.', reasonCode: 'LOW_PREDICTION_SCORE' },
  { key: 'CORNER_MODEL_CONFLICT', label: 'Korner modeli çelişkisi', current: 'UYGULANMAZ', required: 'UYGULANMAZ', passed: true, reason: null, reasonCode: null },
  { key: 'OFFICIAL_WINDOW', label: 'Resmi tahmin zamanı', current: 281, required: '0–90 dakika', passed: false, reason: 'Resmi tahmin penceresi henüz açılmadı.', reasonCode: 'OFFICIAL_WINDOW_NOT_OPEN' },
  { key: 'SELF_AUDIT_GLOBAL', label: 'Self-Audit genel güvenlik', current: 'AKTİF', required: 'PAUSE YOK', passed: true, reason: null, reasonCode: null },
  { key: 'SELF_AUDIT_SEGMENT', label: 'Self-Audit lig / market güvenliği', current: 'AKTİF', required: 'PAUSE YOK', passed: true, reason: null, reasonCode: null },
];
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
  gates: async (id: string) => id === 'ui-0' ? { overallStatus: 'WAITING', gates: humanModeGates,
    candidate: { predictionScore: 36.66, historical: { settledSampleSize: 2 } }, summary: 'Resmi tahmin koşulları henüz tamamlanmadı.' }
    : data.predictionPreviews.find(p => p.match_id === id)?.predictionGate ?? data.predictionReviewCandidates.find(p => p.matchId === id)?.predictionGate ?? null,
  detail: async () => ({ state: 'PREVIEW', runs: [{ generated_at: new Date().toISOString() }], journal: null }),
  csvStageResearch: async () => ({ summary: { total: 0, researchEligible: 0, matches: 0, competitions: 0, invalidOfficial: 0, invalidTimingKnown: 0 }, groups: [] }),
};
const app = buildApp(config, repository as never, createLogger(config), undefined, predictions as never);
await app.listen({ host: '127.0.0.1', port: 4318 });
process.stdout.write('UI preview: http://127.0.0.1:4318 — synthetic fixtures, no DB access\n');
