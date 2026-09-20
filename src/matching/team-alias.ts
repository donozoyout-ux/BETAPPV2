const replacements: Array<[RegExp, string]> = [
  [/\bman\s+utd\b/g, 'manchester united'],
  [/\bman\s+united\b/g, 'manchester united'],
  [/\bmanchester\s+utd\b/g, 'manchester united'],
  [/\bman\s+city\b/g, 'manchester city'],
  [/\binter\s+milan\b/g, 'inter'],
  [/\bparis\s+saint[- ]germain\b/g, 'psg'],
  [/\bfenerbahce\b/g, 'fenerbahce'],
  [/\bbayern\s+munchen\b/g, 'bayern munich'],
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
