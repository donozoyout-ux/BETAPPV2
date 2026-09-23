import { createHash } from 'node:crypto';
import { arr, obj, num, str, type LiveMatchEvent, type EventType } from './types.js';
export function eventFingerprint(e: LiveMatchEvent): string {
  return createHash('sha256').update(JSON.stringify(e.providerEventId != null ? ['id', e.providerEventId]
    : [e.type, e.minute, e.addedTime, e.teamSide, e.playerName, e.assistName, e.detail])).digest('hex');
}
export function fotmobClock(status: unknown) {
  const live = obj(obj(status).liveTime);
  const display = str(live.short)?.replace(/[\u200e\u200f’'\s]/g, '');
  const parts = display?.match(/^(\d{1,3})(?:\+(\d{1,2}))?$/);
  return { minute: parts ? Number(parts[1]) : null, addedTime: parts ? (parts[2] ? Number(parts[2]) : num(live.addedTime)) : null };
}
export function fotmobEvents(payload: unknown, matchId: string, observedAt: string): LiveMatchEvent[] | null {
  const root = obj(payload), content = obj(root.content), facts = obj(content.matchFacts), events = obj(facts.events);
  if (!Array.isArray(events.events)) return null;
  const teams = arr(obj(root.header).teams);
  return arr(events.events).flatMap(e => {
    if (e.isPenaltyShootoutEvent === true) return [];
    let type: EventType | undefined;
    if (e.type === 'Goal') type = e.ownGoal === true ? 'OWN_GOAL' : e.goalDescriptionKey === 'penalty' || e.goalDescription === 'Penalty' ? 'PENALTY_GOAL' : 'GOAL';
    if (e.type === 'MissedPenalty') type = 'MISSED_PENALTY';
    if (e.type === 'Card') type = ({ Yellow: 'YELLOW_CARD', Red: 'RED_CARD', YellowRed: 'SECOND_YELLOW', SecondYellow: 'SECOND_YELLOW' } as Record<string, EventType>)[String(e.card)];
    if (e.type === 'Substitution') type = 'SUBSTITUTION';
    if (!type) return [];
    const side = e.isHome === true ? 'HOME' : e.isHome === false ? 'AWAY' : 'UNKNOWN';
    const swap = arr(e.swap), score = Array.isArray(e.newScore) ? e.newScore : [];
    const h = num(score[0]), a = num(score[1]);
    return [{ provider: 'fotmob' as const, providerEventId: e.eventId == null ? null : String(e.eventId), matchId, type,
      minute: num(e.time), addedTime: num(e.overloadTime), teamSide: side,
      teamName: side === 'UNKNOWN' ? null : str(teams[side === 'HOME' ? 0 : 1]?.name),
      playerName: str(obj(e.player).name) ?? str(swap[0]?.name), assistName: str(e.assistStr),
      detail: type === 'SUBSTITUTION' ? swap.map(p => str(p.name)).filter(Boolean).join(' ↔ ') : str(e.goalDescription) ?? str(e.cardDescription),
      scoreAfter: h != null && a != null ? { home: h, away: a } : null,
      occurredAt: null, observedAt, raw: e } satisfies LiveMatchEvent];
  });
}

export function fotmobPhase(status: unknown): string {
  const s = obj(status), l = obj(s.liveTime);
  if (s.finished === true) return 'FINISHED';
  if (l.short === 'HT' || l.shortKey === 'halftime_short' || l.longKey === 'halftime') return 'HALF_TIME';
  if (l.penalties === true) return 'PENALTIES';
  const minute = fotmobClock(s).minute;
  if (minute == null) return 'UNKNOWN';
  if (Number(l.basePeriod) > 90) return 'EXTRA_TIME';
  return Number(l.basePeriod) === 45 ? 'FIRST_HALF' : Number(l.basePeriod) === 90 ? 'SECOND_HALF' : 'UNKNOWN';
}
