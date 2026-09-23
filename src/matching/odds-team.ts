import { normalizeTeamAlias } from './team-alias.js';

const aliases = new Map<string, string>([
  ['cr flamengo', 'flamengo'], ['flamengo rj', 'flamengo'],
  ['red bull bragantino', 'bragantino'], ['rb bragantino', 'bragantino'], ['bragantino sp', 'bragantino'],
  ['turkiye', 'turkey'], ['czech republic', 'czechia'], ['usa', 'united states'],
  ['korea republic', 'south korea'], ['cote d ivoire', 'ivory coast'],
]);

export function normalizeOddsTeamAlias(name: string): string {
  const key = normalizeTeamAlias(name);
  return aliases.get(key) ?? key;
}

// Only harmless club descriptors may differ. City, youth, reserve, gender and
// geographic qualifiers are never discarded by the containment fallback.
export function safeOddsTokenMatch(left: string, right: string): boolean {
  const a = normalizeOddsTeamAlias(left).split(' ').filter(Boolean);
  const b = normalizeOddsTeamAlias(right).split(' ').filter(Boolean);
  if (!a.length || !b.length) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.every((token) => longer.includes(token))
    && longer.filter((token) => !shorter.includes(token)).every((token) => ['football','club','futebol','clube'].includes(token));
}
