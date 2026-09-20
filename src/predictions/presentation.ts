import { defaultConfig as oddsConfig } from '../odds-analysis/config.js';
import { predictionConfig, type PredictionConfig } from './config.js';
import type { PredictionCandidate } from './types.js';

export type PredictionDisplayTier = 'OFFICIAL' | 'REVIEW' | 'REJECTED';

export const predictionReasonTranslations: Readonly<Record<string, string>> = {
  NO_ODDS_ANALYSIS: 'Henüz oran analizi yok',
  ODDS_NOT_ELIGIBLE: 'Oran verisi henüz yeterli değil',
  MOVEMENT_NOT_SUPPORTED: 'Bookmakerlarda yeterli oran hareketi oluşmadı',
  INSUFFICIENT_HISTORICAL_SAMPLE: 'Benzer geçmiş maç sayısı yetersiz',
  LOW_DATA_QUALITY: 'Veri kalitesi düşük',
  LOW_MODEL_CONFIDENCE: 'Model güveni düşük',
  INSUFFICIENT_BOOKMAKERS: 'Yeterli bookmaker verisi yok',
  INSUFFICIENT_COMPLETE_STATES: 'Açılış ve güncel oran karşılaştırması eksik',
  LOW_PREDICTION_SCORE: 'Tahmin skoru resmi eşik altında',
  CONFLICTING_CORNER_MODEL: 'Korner modeli piyasa hareketiyle çelişiyor',
  LOCK_WINDOW_MISSED: 'Resmi tahmin kilit zamanı kaçırıldı',
  SELF_AUDIT_PAUSED: 'Self-Audit güvenlik freni aktif',
  SELF_AUDIT_SEGMENT_PAUSED: 'Bu lig/market için güvenlik freni aktif',
  UNSUPPORTED_MARKET: 'Bu market tahmin motorunca desteklenmiyor',
  NO_SETTLEMENT_DATA: 'Sonuçlandırma verisi eksik',
};

export const predictionWarningTranslations: Readonly<Record<string, string>> = {
  FIRST_COMPLETE_ODDS_MEASUREMENT: 'İlk oran ölçümü alındı. Hareket analizi için ikinci ölçüm bekleniyor.',
  INSUFFICIENT_COMPLETE_ODDS_STATES: 'Açılış ve güncel oranı karşılaştırmak için yeterli tam ölçüm yok.',
  'insufficient complete opening/current market states': 'Açılış ve güncel oranı karşılaştırmak için yeterli tam ölçüm yok.',
};

export function formatPredictionReason(code: unknown): string {
  const key = String(code ?? '');
  return predictionReasonTranslations[key] ?? predictionWarningTranslations[key] ?? key;
}

export function parsePredictionCandidates(value: unknown): PredictionCandidate[] {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(parsed)
    ? parsed.filter((item): item is PredictionCandidate => Boolean(item) && typeof item === 'object')
    : [];
}

export function parsePredictionCandidate(value: unknown): PredictionCandidate | null {
  if (!value) return null;
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  return parsed && typeof parsed === 'object' ? parsed as PredictionCandidate : null;
}

export function bestDisplayCandidate(row: Record<string, unknown>): PredictionCandidate | null {
  const selected = parsePredictionCandidate(row.selected_candidate);
  if (selected) return selected;
  return parsePredictionCandidates(row.candidates).sort((left, right) =>
    Number(right.predictionScore ?? 0) - Number(left.predictionScore ?? 0)
    || Number(right.historical?.settledSampleSize ?? 0) - Number(left.historical?.settledSampleSize ?? 0))[0] ?? null;
}

export function rowSkipReasons(row: Record<string, unknown>): string[] {
  const value = row.skip_reasons ?? row.reasons;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [value];
    } catch { return [value]; }
  }
  return [];
}

const unsafeReasons = new Set(['LOCK_WINDOW_MISSED', 'SELF_AUDIT_PAUSED', 'SELF_AUDIT_SEGMENT_PAUSED']);
const unsafeWarning = /corrupt|leak|after kickoff|at\/after kickoff|invalid|impossible/i;

export function classifyPredictionDisplay(row: Record<string, unknown>): PredictionDisplayTier {
  if (String(row.decision) === 'PREDICT' && bestDisplayCandidate(row)) return 'OFFICIAL';
  if (String(row.state) === 'LOCKED_SKIP') return 'REJECTED';
  const candidate = bestDisplayCandidate(row);
  if (!candidate) return 'REJECTED';
  const reasons = rowSkipReasons(row);
  const historicalN = Number(candidate.historical?.settledSampleSize ?? 0);
  const validOdds = [candidate.openingOdds, candidate.currentOdds, candidate.referenceOdds]
    .every((value) => Number.isFinite(Number(value)) && Number(value) > 1);
  const warnings = Array.isArray(candidate.warnings) ? candidate.warnings.map(String) : [];
  if (reasons.some((reason) => unsafeReasons.has(reason)) || warnings.some((warning) => unsafeWarning.test(warning))) {
    return 'REJECTED';
  }
  return historicalN >= 5 && Number(candidate.predictionScore) >= 50
    && Number(candidate.bookmakerCount) >= 2 && validOdds ? 'REVIEW' : 'REJECTED';
}

export type PredictionGateGap = { key: string; actual: number; required: number; message: string; passed: boolean };

export function predictionGateGaps(candidate: PredictionCandidate,
  config: PredictionConfig = predictionConfig): PredictionGateGap[] {
  const historicalN = Number(candidate.historical?.settledSampleSize ?? 0);
  const completeBookmakers = Number(candidate.completeStateBookmakerCount ?? 0);
  const completeStates = Number(candidate.minimumCompleteStateCount ?? 0);
  const movement = Number(candidate.probabilityDeltaPp ?? 0);
  const agreement = Number(candidate.agreementRatio ?? 0);
  return [
    { key: 'historical', actual: historicalN, required: config.minimumHistoricalSample,
      passed: historicalN >= config.minimumHistoricalSample,
      message: `Benzer geçmiş maç ${historicalN} / gerekli ${config.minimumHistoricalSample}` },
    { key: 'movement', actual: movement, required: oddsConfig.minimumProbabilityChangePp,
      passed: movement >= oddsConfig.minimumProbabilityChangePp,
      message: `Oran hareketi ${movement >= 0 ? '+' : ''}${movement.toFixed(1)} yüzde puan / gerekli +${oddsConfig.minimumProbabilityChangePp.toFixed(1)}` },
    { key: 'agreement', actual: agreement, required: oddsConfig.minimumAgreementRatio,
      passed: agreement >= oddsConfig.minimumAgreementRatio,
      message: `Bookmaker uyumu %${Math.round(agreement * 100)} / gerekli %${Math.round(oddsConfig.minimumAgreementRatio * 100)}` },
    { key: 'completeBookmakers', actual: completeBookmakers, required: config.minimumBookmakerCount,
      passed: completeBookmakers >= config.minimumBookmakerCount,
      message: `Tam açılış/güncel durumu olan bookmaker ${completeBookmakers} / gerekli ${config.minimumBookmakerCount}` },
    { key: 'completeStates', actual: completeStates, required: config.minimumCompleteStateCount,
      passed: completeStates >= config.minimumCompleteStateCount,
      message: `En düşük tam ölçüm sayısı ${completeStates} / gerekli ${config.minimumCompleteStateCount}` },
    { key: 'score', actual: Number(candidate.predictionScore ?? 0), required: config.minimumPredictionScore,
      passed: Number(candidate.predictionScore ?? 0) >= config.minimumPredictionScore,
      message: `Tahmin skoru ${Number(candidate.predictionScore ?? 0).toFixed(0)} / gerekli ${config.minimumPredictionScore}` },
  ];
}

export function movementExplanation(candidate: PredictionCandidate): string {
  const movement = Number(candidate.probabilityDeltaPp ?? 0);
  const agreement = Number(candidate.agreementRatio ?? 0);
  if (agreement < oddsConfig.minimumAgreementRatio) return 'Hareket yönü bookmakerlar arasında tutarlı değil.';
  if (movement < oddsConfig.minimumProbabilityChangePp) {
    return 'Bookmakerlar aynı yönde hareket ediyor fakat hareket büyüklüğü henüz resmi sinyal için yeterli değil.';
  }
  return 'Oran hareketi ve bookmaker uyumu resmi hareket eşiğini karşılıyor.';
}
