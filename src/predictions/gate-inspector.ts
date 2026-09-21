import { predictionConfig, type PredictionConfig } from './config.js';
import { isSupportedPredictionMarket, officialCandidateBlockers, predictionWindowState } from './prediction-gates.js';
import type { PredictionCandidate, PredictionDecision } from './types.js';

export type PredictionGateStatus = 'OFFICIAL' | 'REVIEW' | 'REJECTED' | 'WAITING';
export type PredictionGateKey = 'ODDS_ANALYSIS' | 'ODDS_ELIGIBILITY' | 'BOOKMAKERS' | 'COMPLETE_STATES' | 'DATA_QUALITY'
  | 'MODEL_CONFIDENCE' | 'MOVEMENT' | 'HISTORICAL_SAMPLE' | 'PREDICTION_SCORE'
  | 'CORNER_MODEL_CONFLICT' | 'OFFICIAL_WINDOW' | 'SELF_AUDIT_GLOBAL' | 'SELF_AUDIT_SEGMENT';
export type PredictionGateResult = { key: PredictionGateKey; label: string; current: unknown; required: unknown;
  passed: boolean; reason: string | null; reasonCode: string | null };
export type PredictionGateInspector = {
  overallStatus: PredictionGateStatus; thresholds: Pick<PredictionConfig, 'minimumHistoricalSample'
    | 'minimumPredictionScore' | 'minimumBookmakerCount' | 'minimumCompleteStateCount'
    | 'minimumDataQualityScore' | 'minimumConfidenceScore' | 'officialWindowStartMinutes'>;
  gates: PredictionGateResult[]; blockers: string[]; summary: string;
  candidate: PredictionCandidate | null; evidence: Record<string, unknown> | null;
  executionAuthority: false; aiPredictionAuthority: false;
};

export const predictionGateReasonTranslations: Readonly<Record<string, string>> = {
  NO_ODDS_ANALYSIS: 'Bu maç için henüz oran analizi oluşmadı.',
  ODDS_NOT_ELIGIBLE: 'Oran verisi resmi tahmin için henüz yeterli değil.',
  INSUFFICIENT_BOOKMAKERS: 'Yeterli sayıda bahis şirketinden veri yok.',
  INSUFFICIENT_COMPLETE_STATES: 'Açılış ve güncel oranı karşılaştırmak için yeterli ölçüm yok.',
  MOVEMENT_NOT_SUPPORTED: 'Bookmakerlarda yeterli oran hareketi oluşmadı.',
  INSUFFICIENT_HISTORICAL_SAMPLE: 'Benzer geçmiş maç sayısı yetersiz.',
  LOW_PREDICTION_SCORE: 'Tahmin skoru resmi eşik altında.',
  LOW_DATA_QUALITY: 'Veri kalitesi resmi tahmin için yeterli değil.',
  LOW_MODEL_CONFIDENCE: 'Model güveni yeterli değil.',
  CONFLICTING_CORNER_MODEL: 'Korner modeli piyasa hareketiyle çelişiyor.',
  LOCK_WINDOW_MISSED: 'Resmi tahmin oluşturma zamanı geçti.',
  OFFICIAL_WINDOW_NOT_OPEN: 'Resmi tahmin penceresi henüz açılmadı.',
  SELF_AUDIT_PAUSED: 'Self-Audit güvenlik freni yeni tahminleri geçici olarak durdurdu.',
  SELF_AUDIT_SEGMENT_PAUSED: 'Bu lig veya market için Self-Audit güvenlik freni aktif.',
  UNSUPPORTED_MARKET: 'Bu market Prediction V1 tarafından desteklenmiyor.',
  NO_SETTLEMENT_DATA: 'Maç sonucu verisi henüz tamamlanmadı.',
};

export function translatePredictionGateReason(value: unknown): string {
  const code = String(value ?? '');
  const base = code.split(':')[0] ?? code;
  return predictionGateReasonTranslations[base]
    ?? 'Bu maç resmi tahmin için gerekli koşulları henüz karşılamıyor.';
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

export function parsePredictionCandidate(value: unknown): PredictionCandidate | null {
  const parsed = parseJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as PredictionCandidate : null;
}

export function parsePredictionCandidates(value: unknown): PredictionCandidate[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is PredictionCandidate => Boolean(item) && typeof item === 'object') : [];
}

export function parsePredictionReasons(value: unknown): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

export function bestPredictionCandidate(selected: unknown, candidates: unknown): PredictionCandidate | null {
  const official = parsePredictionCandidate(selected);
  if (official) return official;
  return parsePredictionCandidates(candidates).sort((left, right) => right.predictionScore - left.predictionScore
    || right.historical.settledSampleSize - left.historical.settledSampleSize)[0] ?? null;
}

export function isMeaningfulReviewCandidate(candidate: PredictionCandidate | null): boolean {
  if (!candidate || !isSupportedPredictionMarket(candidate.marketType)) return false;
  const validOdds = [candidate.openingOdds, candidate.currentOdds, candidate.referenceOdds]
    .every((value) => Number.isFinite(value) && value > 1);
  return candidate.historical.settledSampleSize >= 5 && candidate.predictionScore >= 50
    && candidate.bookmakerCount >= 2 && validOdds;
}

type InspectorInput = { decision: PredictionDecision; state?: string | undefined; kickoffAt: Date; now?: Date;
  selectedCandidate?: unknown; candidates?: unknown; skipReasons?: unknown; metadata?: unknown;
  evidence?: Record<string, unknown> | null };

const gate = (key: PredictionGateKey, label: string, current: unknown, required: unknown,
  passed: boolean, reasonCode: string | null): PredictionGateResult => ({ key, label, current, required, passed,
  reasonCode: passed ? null : reasonCode, reason: passed || !reasonCode ? null : translatePredictionGateReason(reasonCode) });

export function inspectPredictionGates(input: InspectorInput,
  config: PredictionConfig = predictionConfig): PredictionGateInspector {
  const candidate = bestPredictionCandidate(input.selectedCandidate, input.candidates);
  const skipReasons = parsePredictionReasons(input.skipReasons);
  const metadataValue = parseJson(input.metadata);
  const metadata = metadataValue && typeof metadataValue === 'object' ? metadataValue as Record<string, unknown> : {};
  const lockedPrediction = input.state === 'LOCKED_PREDICTION';
  const lockedSkip = input.state === 'LOCKED_SKIP';
  const window = predictionWindowState(input.kickoffAt, input.now ?? new Date(), config);
  const windowPassed = lockedPrediction || (window.eligible && !window.missed);
  const windowReason = window.missed || skipReasons.includes('LOCK_WINDOW_MISSED')
    ? 'LOCK_WINDOW_MISSED' : 'OFFICIAL_WINDOW_NOT_OPEN';
  const globalPaused = skipReasons.includes('SELF_AUDIT_PAUSED') || metadata.selfAuditGuardActive === true;
  const segmentPaused = skipReasons.includes('SELF_AUDIT_SEGMENT_PAUSED')
    || Object.values((metadata.selfAuditSegmentGuards ?? {}) as Record<string, unknown>).some(Boolean);
  const candidateBlockers = candidate ? officialCandidateBlockers(candidate, config) : ['NO_ODDS_ANALYSIS' as const];
  const hasCompleteMetrics = Boolean(candidate && Number.isFinite(candidate.completeStateBookmakerCount)
    && Number.isFinite(candidate.minimumCompleteStateCount));
  const completePassed = Boolean(candidate && (hasCompleteMetrics
    ? candidate.completeStateBookmakerCount >= config.minimumBookmakerCount
      && candidate.minimumCompleteStateCount >= config.minimumCompleteStateCount
    : candidate.analysisEligible));
  const corner = Boolean(candidate?.marketType.toUpperCase().includes('TOTAL_CORNERS'));
  const gates: PredictionGateResult[] = [
    gate('ODDS_ANALYSIS', 'Oran analizi', candidate ? 'VAR' : 'YOK', 'VAR', Boolean(candidate), 'NO_ODDS_ANALYSIS'),
    gate('ODDS_ELIGIBILITY', 'Oran analizi uygunluğu', candidate?.analysisEligible ? 'UYGUN' : 'HENÜZ UYGUN DEĞİL',
      'UYGUN', Boolean(candidate?.analysisEligible), 'ODDS_NOT_ELIGIBLE'),
    gate('BOOKMAKERS', 'Bahis şirketi', candidate?.bookmakerCount ?? 0, config.minimumBookmakerCount,
      Boolean(candidate && candidate.bookmakerCount >= config.minimumBookmakerCount), 'INSUFFICIENT_BOOKMAKERS'),
    gate('COMPLETE_STATES', 'Açılış / güncel oran ölçümü', candidate && hasCompleteMetrics ? {
      bookmakers: candidate.completeStateBookmakerCount, states: candidate.minimumCompleteStateCount,
    } : candidate ? 'ESKİ KAYITTA AYRIŞTIRILMAMIŞ' : { bookmakers: 0, states: 0 },
    { bookmakers: config.minimumBookmakerCount, states: config.minimumCompleteStateCount },
    completePassed, 'INSUFFICIENT_COMPLETE_STATES'),
    gate('DATA_QUALITY', 'Veri kalitesi', candidate?.dataQualityScore ?? 0, config.minimumDataQualityScore,
      Boolean(candidate && candidate.dataQualityScore >= config.minimumDataQualityScore), 'LOW_DATA_QUALITY'),
    gate('MODEL_CONFIDENCE', 'Model güveni', candidate?.confidenceScore ?? 0, config.minimumConfidenceScore,
      Boolean(candidate && candidate.confidenceScore >= config.minimumConfidenceScore), 'LOW_MODEL_CONFIDENCE'),
    gate('MOVEMENT', 'Oran hareketi', candidate?.movementClass ?? 'UNAVAILABLE', ['SUPPORT','STRONG_SUPPORT'],
      Boolean(candidate && ['SUPPORT','STRONG_SUPPORT'].includes(candidate.movementClass)), 'MOVEMENT_NOT_SUPPORTED'),
    gate('HISTORICAL_SAMPLE', 'Geçmiş benzer maç', candidate?.historical.settledSampleSize ?? 0,
      config.minimumHistoricalSample, Boolean(candidate && candidate.historical.settledSampleSize >= config.minimumHistoricalSample),
      'INSUFFICIENT_HISTORICAL_SAMPLE'),
    gate('PREDICTION_SCORE', 'Tahmin skoru', candidate?.predictionScore ?? 0, config.minimumPredictionScore,
      Boolean(candidate && candidate.predictionScore >= config.minimumPredictionScore), 'LOW_PREDICTION_SCORE'),
    gate('CORNER_MODEL_CONFLICT', 'Korner modeli çelişkisi', corner ? candidate?.cornerConfirmation : 'UYGULANMAZ',
      corner ? 'CONFLICT YOK' : 'UYGULANMAZ', !corner || candidate?.cornerConfirmation !== 'CONFLICT', 'CONFLICTING_CORNER_MODEL'),
    gate('OFFICIAL_WINDOW', 'Resmi tahmin zamanı', lockedPrediction ? 'KİLİTLENDİ'
      : Math.round(window.minutesToKickoff), `0–${config.officialWindowStartMinutes} dakika`, windowPassed, windowReason),
    gate('SELF_AUDIT_GLOBAL', 'Self-Audit genel güvenlik', globalPaused ? 'PAUSED' : String(metadata.selfAuditStatus ?? 'AKTİF'),
      'PAUSE YOK', !globalPaused, 'SELF_AUDIT_PAUSED'),
    gate('SELF_AUDIT_SEGMENT', 'Self-Audit lig / market güvenliği', segmentPaused ? 'PAUSED' : 'AKTİF',
      'PAUSE YOK', !segmentPaused, 'SELF_AUDIT_SEGMENT_PAUSED'),
  ];
  const visibleFailedGates = candidate ? gates : gates.filter((item) => ['ODDS_ANALYSIS','OFFICIAL_WINDOW',
    'SELF_AUDIT_GLOBAL','SELF_AUDIT_SEGMENT'].includes(item.key));
  const blockers = [...new Set([...candidateBlockers, ...visibleFailedGates.filter((item) => !item.passed && item.reasonCode)
    .map((item) => item.reasonCode!), ...skipReasons.filter((reason) => ['LOCK_WINDOW_MISSED','SELF_AUDIT_PAUSED',
      'SELF_AUDIT_SEGMENT_PAUSED'].includes(reason))])];
  const hardRejected = lockedSkip || blockers.some((reason) => ['UNSUPPORTED_MARKET','LOCK_WINDOW_MISSED','SELF_AUDIT_PAUSED',
    'SELF_AUDIT_SEGMENT_PAUSED'].includes(reason));
  const waiting = blockers.some((reason) => ['NO_ODDS_ANALYSIS','ODDS_NOT_ELIGIBLE','INSUFFICIENT_COMPLETE_STATES',
    'OFFICIAL_WINDOW_NOT_OPEN'].includes(reason));
  const allOfficialGatesPassed = gates.every((item) => item.passed) && candidateBlockers.length === 0;
  const overallStatus: PredictionGateStatus = input.decision === 'PREDICT' && allOfficialGatesPassed
    ? 'OFFICIAL' : hardRejected ? 'REJECTED' : waiting ? 'WAITING'
      : isMeaningfulReviewCandidate(candidate) ? 'REVIEW' : 'REJECTED';
  const reasonText = blockers.slice(0, 3).map(translatePredictionGateReason);
  const summary = overallStatus === 'OFFICIAL'
    ? 'Resmi tahmin oluştu: bütün Prediction V1 güvenlik kapıları geçildi.'
    : `${overallStatus === 'WAITING' ? 'Veri bekleniyor' : 'Resmi tahmin oluşmadı'}: ${reasonText.join(' ')}`;
  return { overallStatus, thresholds: {
    minimumHistoricalSample: config.minimumHistoricalSample, minimumPredictionScore: config.minimumPredictionScore,
    minimumBookmakerCount: config.minimumBookmakerCount, minimumCompleteStateCount: config.minimumCompleteStateCount,
    minimumDataQualityScore: config.minimumDataQualityScore, minimumConfidenceScore: config.minimumConfidenceScore,
    officialWindowStartMinutes: config.officialWindowStartMinutes,
  }, gates, blockers, summary, candidate, evidence: input.evidence ?? null,
  executionAuthority: false, aiPredictionAuthority: false };
}

export function inspectPredictionRow(row: Record<string, unknown>, now = new Date(),
  config: PredictionConfig = predictionConfig): PredictionGateInspector {
  return inspectPredictionGates({ decision: String(row.decision ?? 'SKIP') as PredictionDecision,
    state: row.state == null ? undefined : String(row.state), kickoffAt: new Date(String(row.kickoff_at ?? row.kickoffAt)), now,
    selectedCandidate: row.selected_candidate ?? row.selectedCandidate, candidates: row.candidates,
    skipReasons: row.skip_reasons ?? row.skipReasons, metadata: row.metadata, evidence: row.evidence as Record<string, unknown> | null }, config);
}
