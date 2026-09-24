const replacements: Array<[RegExp, string]> = [
  [/\bman\s+utd\b/g, 'manchester united'],
  [/\bman\s+united\b/g, 'manchester united'],
  [/\bmanchester\s+utd\b/g, 'manchester united'],
  [/\bman\s+city\b/g, 'manchester city'],
  [/\binter\s+milan\b/g, 'inter'],
  [/\bparis\s+saint[- ]germain\b/g, 'psg'],
  [/\bfenerbahce\b/g, 'fenerbahce'],
  [/\bbayern\s+munchen\b/g, 'bayern munich'],
  [/\bturkey\b/g, 'turkiye'],
  [/\btuerkiye\b/g, 'turkiye'],
  [/\bczech republic\b/g, 'czechia'],
  [/\bkorea republic\b/g, 'south korea'],
  [/\brepublic of korea\b/g, 'south korea'],
  [/\busa\b/g, 'united states'],
  [/\bu s a\b/g, 'united states'],
  [/\binter miami cf\b/g, 'inter miami'],
];

export function normalizeTeamAlias(name: string): string {
  let normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  normalized = normalized.replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  for (const [pattern, replacement] of replacements) normalized = normalized.replace(pattern, replacement);
  return normalized.replace(/\b(fc|cf|sc|fk|sk|as|ac)\b/g, '').replace(/\s+/g, ' ').trim();
}

export type MatchConfidence = 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNMATCHED';

export function kickoffConfidence(existing: Date, incoming: Date): MatchConfidence {
  const minutes = Math.abs(existing.getTime() - incoming.getTime()) / 60_000;
  if (minutes <= 1) return 'EXACT';
  if (minutes <= 10) return 'HIGH';
  if (minutes <= 30) return 'MEDIUM';
  if (minutes <= 120) return 'LOW';
  return 'UNMATCHED';
}


export function teamNameSimilarity(left: string, right: string): number {
  const a = normalizeTeamAlias(left);
  const b = normalizeTeamAlias(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    if (shorter >= 5) return Math.max(0.9, shorter / longer);
  }
  const at = new Set(a.split(' ').filter(Boolean));
  const bt = new Set(b.split(' ').filter(Boolean));
  const intersection = [...at].filter((token) => bt.has(token)).length;
  const union = new Set([...at, ...bt]).size;
  return union ? intersection / union : 0;
}

const nationalAliasGroups = [ ['Turkey', 'Türkiye', 'Turkiye'], ['USA', 'United States', 'United States of America'],
  ['Korea Republic', 'South Korea', 'Republic of Korea'], ['Czech Republic', 'Czechia'] ];
// Match exact senior national names before the generic club-suffix normalization.
const exactNationalName = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function isKnownNationalName(name: string): boolean {
  return nationalAliasGroups.some(names => names.some(n => exactNationalName(n) === exactNationalName(name)));
}
export function nationalTeamAliases(name: string): string[] {
  const group = nationalAliasGroups.find(names => names.some(n => exactNationalName(n) === exactNationalName(name)));
  return group ? [...new Set(group.map(normalizeTeamAlias))] : [exactNationalName(name)];
}
