import { normalizeTeamAlias } from '../matching/team-alias.js';
import type { LiveResponseV2 } from './analysis-v2.js';

type PrematchRecommendation = Record<string, unknown>;

function directionalSide(prediction: PrematchRecommendation): 'HOME' | 'AWAY' | 'DRAW' | 'UNKNOWN' {
  const market = `${String(prediction.market_type ?? '')} ${String(prediction.market_name ?? '')}`.toLowerCase();
  if (!/(match_result|1x2|match winner|moneyline)/i.test(market)) return 'UNKNOWN';
  const selection = String(prediction.selection ?? '').trim();
  const upper = selection.toUpperCase();
  if (upper === 'HOME' || upper === '1') return 'HOME';
  if (upper === 'AWAY' || upper === '2') return 'AWAY';
  if (upper === 'DRAW' || upper === 'X') return 'DRAW';
  const normalized = normalizeTeamAlias(selection);
  if (normalized && normalized === normalizeTeamAlias(String(prediction.home_team ?? prediction.homeTeam ?? ''))) return 'HOME';
  if (normalized && normalized === normalizeTeamAlias(String(prediction.away_team ?? prediction.awayTeam ?? ''))) return 'AWAY';
  return 'UNKNOWN';
}

export function buildLiveRecommendation(prediction: PrematchRecommendation, live: LiveResponseV2) {
  const status = String(live.match.status);
  const side = directionalSide(prediction);
  const reasons: string[] = [];
  let state: 'WAITING_KICKOFF' | 'ACTIVE' | 'SOURCE_CONFLICT' | 'LOW_DATA' | 'FINISHED';
  let recommendation: 'MAÇI_BEKLE' | 'DESTEKLENIYOR' | 'ZAYIFLIYOR' | 'TAKİP' | 'BEKLE' | 'SONUÇLANDI';

  if (status === 'finished') {
    state = 'FINISHED'; recommendation = 'SONUÇLANDI';
    reasons.push('Maç tamamlandı; canlı öneri kapandı.');
  } else if (status !== 'live') {
    state = 'WAITING_KICKOFF'; recommendation = 'MAÇI_BEKLE';
    reasons.push('Resmi pre-match öneri kayıtlı; maçın başlaması bekleniyor.');
  } else if (live.conflicts.length > 0 || live.LIVE_ANALYSIS_V2.state === 'SOURCE_CONFLICT') {
    state = 'SOURCE_CONFLICT'; recommendation = 'BEKLE';
    reasons.push('Canlı kaynaklar arasında uyuşmazlık var; yeni yön önerisi üretilmedi.');
  } else if (live.minute == null || ['LOW_DATA','NOT_AVAILABLE'].includes(String(live.LIVE_ANALYSIS_V2.state))) {
    state = 'LOW_DATA'; recommendation = 'BEKLE';
    reasons.push('Canlı veri veya gerçek maç dakikası yeterli değil.');
  } else if (side === 'UNKNOWN' || side === 'DRAW') {
    state = 'ACTIVE'; recommendation = 'TAKİP';
    reasons.push('Pre-match market için güvenli yön eşlemesi yok; yalnız canlı gidişat takip ediliyor.');
  } else {
    state = 'ACTIVE';
    const opposite = side === 'HOME' ? 'AWAY' : 'HOME';
    const signals = [
      live.LIVE_ANALYSIS_V3.pressureNow,
      live.LIVE_ANALYSIS_V3.recentEventEdge,
      live.LIVE_ANALYSIS_V3.postScoreMomentum.eventEdge,
    ];
    const aligned = signals.filter((value) => value === side).length;
    const opposed = signals.filter((value) => value === opposite).length;
    if (aligned >= 2 && opposed === 0) {
      recommendation = 'DESTEKLENIYOR';
      reasons.push('Canlı baskı ve son olay yönü pre-match seçimle aynı tarafta.');
    } else if (opposed >= 2 && aligned === 0) {
      recommendation = 'ZAYIFLIYOR';
      reasons.push('Canlı baskı ve son olay yönü pre-match seçimin tersine dönmüş durumda.');
    } else {
      recommendation = 'TAKİP';
      reasons.push('Canlı sinyaller tek yönde yeterince birleşmiyor.');
    }
  }

  return {
    version: 'LIVE_RECOMMENDATION_V1' as const,
    matchId: live.match.matchId,
    state,
    recommendation,
    preMatch: {
      marketType: prediction.market_type ?? null,
      marketName: prediction.market_name ?? null,
      line: prediction.line ?? null,
      selection: prediction.selection ?? null,
      referenceOdds: prediction.reference_odds ?? null,
      predictionScore: prediction.prediction_score ?? null,
      lockedAt: prediction.locked_at ?? null,
    },
    live: {
      status: live.match.status,
      minute: live.minute,
      addedTime: live.addedTime,
      homeScore: live.match.homeScore,
      awayScore: live.match.awayScore,
      pressureNow: live.LIVE_ANALYSIS_V3.pressureNow,
      recentEventEdge: live.LIVE_ANALYSIS_V3.recentEventEdge,
      sourceVerified: live.sourceVerified,
      conflicts: live.conflicts,
    },
    outcome: prediction.outcome ?? null,
    reasons,
    changesPredictionV1: false as const,
    executionAuthority: false as const,
    aiPredictionAuthority: false as const,
    generatedAt: new Date(),
  };
}
