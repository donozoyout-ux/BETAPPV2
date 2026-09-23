import { competitionKey } from '../matching/competition.js';
import { normalizeTeamAlias } from '../matching/team-alias.js';
import type { ApiFixture } from '../providers/api-football.js';
import type { Conflict, SourceData, SourceSnapshot } from './types.js';
function liveTeamKey(name: string): string {
  const key = normalizeTeamAlias(name);
  // Provider spellings for the same national identities; scoped to live mapping only.
  return ({ turkey: 'turkiye', usa: 'united states', 'united states of america': 'united states',
    'czech republic': 'czechia', 'korea republic': 'south korea', 'republic of korea': 'south korea' } as Record<string, string>)[key] ?? key;
}
export const STALE_MS = 180_000;
export function matchFixture(f: ApiFixture, rows: Array<Record<string, unknown>>): string | null {
  const matches = rows.filter(r => competitionKey(String(r.league)) === competitionKey(f.league)
    && liveTeamKey(String(r.home_team)) === liveTeamKey(f.homeTeam)
    && liveTeamKey(String(r.away_team)) === liveTeamKey(f.awayTeam)
    && Math.abs(new Date(String(r.kickoff_at)).getTime() - Date.parse(f.kickoffAt)) <= 10 * 60_000);
  return matches.length === 1 ? String(matches[0]!.id) : null;
}
export function reconcile(f: SourceSnapshot | undefined, a: SourceSnapshot | undefined, now = Date.now()) {
  const conflicts: Conflict[] = [];
  const stale = (s: SourceSnapshot) => now - Date.parse(s.observedAt) > STALE_MS;
  let chosen = f ?? a;
  if (f && a) {
    const newer = Date.parse(a.observedAt) - Date.parse(f.observedAt);
    const preferred = stale(f) && newer > STALE_MS ? a : stale(a) && -newer > STALE_MS ? f : undefined;
    const resolution = preferred ? `NEWER_${preferred.provider}` : 'KEEP_TRUSTED';
    if (f.homeScore != null && f.awayScore != null && a.homeScore != null && a.awayScore != null
      && (f.homeScore !== a.homeScore || f.awayScore !== a.awayScore)) conflicts.push({ type: 'SCORE_CONFLICT', fotmob: [f.homeScore, f.awayScore], apiFootball: [a.homeScore, a.awayScore], resolution });
    if (f.status !== a.status) conflicts.push({ type: 'STATUS_CONFLICT', fotmob: f.status, apiFootball: a.status, resolution });
    if (f.minute != null && a.minute != null && Math.abs(f.minute + (f.addedTime ?? 0) - a.minute - (a.addedTime ?? 0)) > 2) conflicts.push({ type: 'MINUTE_CONFLICT', fotmob: f.minute, apiFootball: a.minute, resolution });
    chosen = preferred ?? (conflicts.some(c => c.type !== 'MINUTE_CONFLICT') ? undefined : f);
  }
  return { chosen, conflicts };
}
export function eventConflicts(f?: SourceData, a?: SourceData): Conflict[] {
  if (!f?.events || !a?.events || !f.detailsAt || !a.detailsAt || Math.abs(Date.parse(f.detailsAt) - Date.parse(a.detailsAt)) > 60_000) return [];
  // Compare type/side/minute counts; provider-specific player spelling is not itself a conflict.
  const summary = (s: SourceData) => s.events!.map(e => `${e.type}:${e.teamSide}:${e.minute}:${e.addedTime ?? 0}`).sort();
  const fs = summary(f), as = summary(a);
  return JSON.stringify(fs) === JSON.stringify(as) ? [] : [{ type: 'EVENT_CONFLICT', fotmob: fs, apiFootball: as, resolution: 'PRIMARY_TIMELINE_WITH_SECONDARY_EVIDENCE' }];
}
