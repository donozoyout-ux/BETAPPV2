import type { LiveMatchEvent } from './types.js';

type LiveV3Input = {
  minute: number | null;
  events: LiveMatchEvent[];
  conflicts: unknown[];
  sourceVerified: boolean;
  LIVE_ANALYSIS_V2: { state: string; pressureSide: string };
};

function recentWindow(data: LiveV3Input): LiveMatchEvent[] {
  const minute = data.minute;
  if (minute == null) return [];
  const start = Math.max(0, minute - 10);
  return data.events.filter((event) => event.minute != null && event.minute >= start && event.minute <= minute);
}

export function liveAnalysisV3(data: LiveV3Input, generatedAt = new Date()) {
  const recent: LiveMatchEvent[] = recentWindow(data);
  const scoreEvents = recent.filter((event) =>
    ['GOAL','OWN_GOAL','PENALTY_GOAL'].includes(event.type));
  const homeEvents = recent.filter((event) => event.teamSide === 'HOME').length;
  const awayEvents = recent.filter((event) => event.teamSide === 'AWAY').length;
  const recentEventEdge = homeEvents === awayEvents ? 'BALANCED' : homeEvents > awayEvents ? 'HOME' : 'AWAY';
  const lastScoreEvent = [...data.events].reverse().find((event) =>
    ['GOAL','OWN_GOAL','PENALTY_GOAL'].includes(event.type));
  const afterScoreEvents: LiveMatchEvent[] = lastScoreEvent?.minute == null ? [] : data.events.filter((event) =>
    event.minute != null && event.minute > lastScoreEvent.minute!);
  const afterHome = afterScoreEvents.filter((event) => event.teamSide === 'HOME').length;
  const afterAway = afterScoreEvents.filter((event) => event.teamSide === 'AWAY').length;
  const postScoreEdge = !afterScoreEvents.length ? 'UNKNOWN'
    : afterHome === afterAway ? 'BALANCED' : afterHome > afterAway ? 'HOME' : 'AWAY';

  return {
    version: 'LIVE_ANALYSIS_V3' as const,
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
    shotAcceleration: { state: 'UNAVAILABLE' as const, reason: 'Historical live-stat snapshots are not persisted yet.' },
    cornerAcceleration: { state: 'UNAVAILABLE' as const, reason: 'Historical live-stat snapshots are not persisted yet.' },
    sourceConflict: data.conflicts.length > 0,
    sourceVerified: data.sourceVerified,
    reasons: [
      data.minute == null ? 'Gerçek maç dakikası yok; son 10 dakika penceresi hesaplanamadı.' : `Son 10 dakikada ${recent.length} olay gözlendi.`,
      lastScoreEvent ? `Son skor değişimi ${lastScoreEvent.minute ?? '—'}. dakikada gözlendi.` : 'Skor değişimi olayı mevcut değil.',
      'Şut ve korner hızlanması için zaman serisi olmadığı sürece trend üretilmez.',
    ],
    generatedAt,
    executionAuthority: false as const,
    aiPredictionAuthority: false as const,
  };
}
