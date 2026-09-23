import type { LiveResponseV2 } from './analysis-v2.js';

function recentWindow(data: LiveResponseV2) {
  const minute = data.minute;
  if (minute == null) return [];
  const start = Math.max(0, minute - 10);
  return data.events.filter((event) => event.minute != null && event.minute >= start && event.minute <= minute);
}

export function liveAnalysisV3(data: LiveResponseV2, generatedAt = new Date()) {
  const recent = recentWindow(data);
  const scoreEvents = recent.filter((event) =>
    ['GOAL','OWN_GOAL','PENALTY_GOAL'].includes(event.type));
  const homeEvents = recent.filter((event) => event.teamSide === 'HOME').length;
  const awayEvents = recent.filter((event) => event.teamSide === 'AWAY').length;
  const recentEventEdge = homeEvents === awayEvents ? 'BALANCED' : homeEvents > awayEvents ? 'HOME' : 'AWAY';
  const lastScoreEvent = [...data.events].reverse().find((event) =>
    ['GOAL','OWN_GOAL','PENALTY_GOAL'].includes(event.type));
  const afterScoreEvents = lastScoreEvent?.minute == null ? [] : data.events.filter((event) =>
    event.minute != null && event.minute > lastScoreEvent.minute);
  const postScoreEdge = afterScoreEvents.length
    ? afterScoreEvents.filter((event) => event.teamSide === 'HOME').length === afterScoreEvents.filter((event) => event.teamSide === 'AWAY').length
      ? 'BALANCED'
      : afterScoreEvents.filter((event) => event.teamSide === 'HOME').length > afterScoreEvents.filter((event) => event.teamSide === 'AWAY').length
        ? 'HOME' : 'AWAY'
    : 'UNKNOWN';

  return {
    version: 'LIVE_ANALYSIS_V3',
    state: data.LIVE_ANALYSIS_V2.state,
    minute: data.minute,
    recentWindowMinutes: 10,
    recentEventsCount: recent.length,
    recentGoals: scoreEvents.length,
    recentEventEdge,
    postScoreMomentum: {
      state: lastScoreEvent ? (afterScoreEvents.length ? 'AVAILABLE' : 'LOW_DATA') : 'NOT_AVAILABLE',
      lastScoreMinute: lastScoreEvent?.minute ?? null,
      eventEdge: postScoreEdge,
      eventsAfterScore: afterScoreEvents.length,
    },
    pressureNow: data.LIVE_ANALYSIS_V2.pressureSide,
    shotAcceleration: { state: 'UNAVAILABLE', reason: 'Historical live-stat snapshots are not persisted yet.' },
    cornerAcceleration: { state: 'UNAVAILABLE', reason: 'Historical live-stat snapshots are not persisted yet.' },
    sourceConflict: data.conflicts.length > 0,
    sourceVerified: data.sourceVerified,
    reasons: [
      data.minute == null ? 'Gerçek maç dakikası yok; son 10 dakika penceresi hesaplanamadı.' : `Son 10 dakikada ${recent.length} olay gözlendi.`,
      lastScoreEvent ? `Son skor değişimi ${lastScoreEvent.minute ?? '—'}. dakikada gözlendi.` : 'Skor değişimi olayı mevcut değil.',
      'Şut ve korner hızlanması için zaman serisi olmadığı sürece trend üretilmez.',
    ],
    generatedAt,
    executionAuthority: false,
    aiPredictionAuthority: false,
  };
}
