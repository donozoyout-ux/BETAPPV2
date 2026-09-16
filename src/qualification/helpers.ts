import type { CapabilityCheck, ProviderCapability, QualificationResult } from './types.js';

export function check(
  capability: ProviderCapability,
  result: QualificationResult,
  source: string,
  options: Partial<Omit<CapabilityCheck, 'capability' | 'result' | 'source'>> = {},
): CapabilityCheck {
  return {
    capability, result, source, checkedAt: options.checkedAt ?? new Date(),
    httpStatus: options.httpStatus ?? null, latencyMs: options.latencyMs ?? 0,
    sampleCount: options.sampleCount ?? 0, parseSuccess: options.parseSuccess ?? false,
    error: options.error ?? null, notes: options.notes ?? null,
  };
}

export function statusFromError(error: unknown): number | null {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    ? error.status : null;
}
