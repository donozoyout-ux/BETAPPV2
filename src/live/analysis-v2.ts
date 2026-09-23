import { liveAnalysisV3 } from './analysis-v3.js';
import { analyzeLive, liveResponse, type LiveMatchState } from './analysis.js';
import { eventConflicts, reconcile, STALE_MS } from './reconcile.js';
import { type SourceData, type ProviderHealth, type LiveMatchEvent } from './types.js';
export function liveResponseV2(row: Record<string, unknown>, sources: SourceData[] = [],
  apiHealth: ProviderHealth = 'NOT_CONFIGURED', now = new Date()) {
  const v1 = liveResponse(row);
  const primary = sources.find(s => s.snapshot.provider === 'fotmob');
  const secondary = apiHealth === 'NOT_CONFIGURED' ? undefined : sources.find(s => s.snapshot.provider === 'api-football');
  const fresh = (s: SourceData | undefined) => !!s && now.getTime() - Date.parse(s.snapshot.observedAt) <= STALE_MS;
  const reconciliation = reconcile(primary?.snapshot, secondary?.snapshot, now.getTime());
  const conflicts = [...reconciliation.conflicts, ...eventConflicts(primary, secondary)];
  const minuteSource = fresh(secondary) && secondary?.snapshot.minute != null ? secondary : fresh(primary) ? primary : undefined;
  const terminal = row.status === 'finished';
  const minute = terminal ? null : minuteSource?.snapshot.minute ?? null;
  const addedTime = terminal ? null : minuteSource?.snapshot.addedTime ?? null;
  const stats = structuredClone(v1.statistics);
  // Preserve primary metric provenance; secondary is only a fallback for unavailable or stale pairs.
  const fallback = secondary?.statistics ?? [];
  const secondaryAsPrimary = liveResponse({ ...row, statistics: fallback.map(s => ({ ...s, provider: 'fotmob' })) }).statistics;
  const statisticSources: Record<string, string | null> = {};
  for (const key of Object.keys(stats) as Array<keyof typeof stats>) {
    const value = stats[key], alternate = secondaryAsPrimary[key];
    const stale = value.updatedAt == null || now.getTime() - new Date(String(value.updatedAt)).getTime() > STALE_MS;
    const alternateFresh = alternate.updatedAt != null && now.getTime() - new Date(String(alternate.updatedAt)).getTime() <= STALE_MS;
    if ((value.home == null || value.away == null || stale) && fresh(secondary) && alternateFresh && alternate.home != null && alternate.away != null) {
      stats[key] = alternate; statisticSources[key] = 'api-football';
    } else statisticSources[key] = value.home != null || value.away != null ? 'fotmob' : null;
  }
  const eventSource = primary?.events != null && (fresh(primary) || !fresh(secondary)) ? primary : secondary;
  const events: LiveMatchEvent[] = [...(eventSource?.events ?? [])].sort((a,b) =>
    (a.minute ?? Infinity) - (b.minute ?? Infinity) || (a.addedTime ?? 0) - (b.addedTime ?? 0) || a.observedAt.localeCompare(b.observedAt));
  const liveOdds = !terminal && row.status === 'live' && apiHealth === 'SUPPORTED'
    ? (secondary?.odds ?? []).filter(o => now.getTime() - Date.parse(o.observedAt) <= 90_000) : [];
  const sourceHealth = {
    fotmob: { status: fresh(primary) ? 'SUPPORTED' : primary ? 'DEGRADED' : 'UNAVAILABLE', observedAt: primary?.snapshot.observedAt ?? null },
    apiFootball: { status: apiHealth === 'SUPPORTED' && !fresh(secondary) ? 'DEGRADED' : apiHealth, observedAt: secondary?.snapshot.observedAt ?? null },
  };
  const baseline = analyzeLive({ ...v1.match, statistics: stats } as LiveMatchState, now);
  const phase = terminal ? 'FINISHED' : minuteSource?.snapshot.phase ?? 'UNKNOWN';
  const v2 = { ...baseline, version: 'LIVE_ANALYSIS_V2', state: terminal || row.status !== 'live' ? 'NOT_AVAILABLE'
    : conflicts.length ? 'SOURCE_CONFLICT' : baseline.state, matchPhase: phase, minute, addedTime,
    recentEvents: events.slice(-10), momentumSummary: `Baskı özeti: ${baseline.pressureSide}. Son olay sayısı: ${Math.min(events.length, 10)}.`,
    sourceHealth, conflicts, reasons: [...baseline.reasons.filter(r => !r.includes('oran')), ...(conflicts.length ? ['Kaynak uyuşmazlığı; kaynak değerleri ayrı gösterilir.'] : []),
      liveOdds.length ? 'Gerçek canlı oran gözlemi mevcut; hareket için yeterli geçmiş yok.' : 'Gerçek canlı oran mevcut değil.'],
    oddsMovement: null, generatedAt: now, executionAuthority: false, aiPredictionAuthority: false };
  const response = { ...v1, match: { ...v1.match, minute, addedTime, statistics: stats, odds: liveOdds, liveOddsAvailable: liveOdds.length > 0 },
    minute, addedTime, minuteSource: minuteSource?.snapshot.provider ?? null, events, statistics: stats, statisticSources,
    LIVE_ANALYSIS_V2: v2, sourceHealth, conflicts, sourceValues: sources.map(s => s.snapshot),
    sourceEvents: { fotmob: primary?.events ?? null, apiFootball: secondary?.events ?? null },
    sourceVerified: fresh(primary) && fresh(secondary) && !conflicts.length
      && primary?.snapshot.homeScore != null && primary.snapshot.awayScore != null,
    liveOdds, liveOddsAvailable: liveOdds.length > 0,
    preMatchContext: { contextualOnly: true, prediction: null as unknown, gate: null as unknown } };
  return { ...response, LIVE_ANALYSIS_V3: liveAnalysisV3(response, now) };
}
export type LiveResponseV2 = ReturnType<typeof liveResponseV2>;
