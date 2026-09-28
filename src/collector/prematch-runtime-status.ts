export type PrematchRuntimeSource = 'worker.runCycle' | 'worker.bootstrap';
export type PrematchRuntimeReason = 'NOWGOAL_DISABLED' | 'NOT_INSTANTIATED' | 'COLLECTOR_DISABLED' | null;

export function prematchCollectorRuntimeStatus(input: {
  enabled: boolean;
  instantiated: boolean;
  started: boolean;
  source: PrematchRuntimeSource;
  reason?: PrematchRuntimeReason;
}) {
  const reason = input.reason ?? (input.enabled ? input.instantiated ? null : 'NOT_INSTANTIATED' : 'NOWGOAL_DISABLED');
  return {
    event: 'PREMATCH_COLLECTOR_RUNTIME_STATUS',
    enabled: input.enabled,
    instantiated: input.instantiated,
    started: input.started,
    reason: input.started ? null : reason,
    source: input.source,
  } as const;
}
