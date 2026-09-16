export type Observation = { provider: string; value: string | number | null };
export type ConsensusStatus = 'VERIFIED' | 'SINGLE_SOURCE' | 'CONFLICT' | 'MISSING';

export function resolveConsensus(observations: Observation[]) {
  const usable = observations.filter((item) => item.value !== null);
  if (usable.length === 0) return { resolvedValue: null, status: 'MISSING' as const, providerCount: 0, agreementCount: 0, confidence: 0 };
  const counts = new Map<string, { value: string | number; count: number }>();
  for (const item of usable) {
    const key = String(item.value);
    const current = counts.get(key);
    counts.set(key, { value: item.value!, count: (current?.count ?? 0) + 1 });
  }
  const winner = [...counts.values()].sort((a, b) => b.count - a.count)[0]!;
  const status: ConsensusStatus = usable.length === 1 ? 'SINGLE_SOURCE' : counts.size === 1 ? 'VERIFIED' : 'CONFLICT';
  return {
    resolvedValue: winner.value,
    status,
    providerCount: new Set(usable.map((item) => item.provider)).size,
    agreementCount: winner.count,
    confidence: winner.count / usable.length,
  };
}
