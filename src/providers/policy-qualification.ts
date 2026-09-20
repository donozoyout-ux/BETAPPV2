import { check } from '../qualification/helpers.js';
import { providerCapabilities, type ProviderQualification, type QualifiableProvider } from '../qualification/types.js';
import { historicalProviderPolicies } from '../historical/provider-policy.js';
import type { HistoricalProviderId } from '../historical/types.js';

async function robotsStatus(baseUrl: string): Promise<{ status: number | null; note: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${baseUrl}/robots.txt`, { signal: controller.signal,
      headers: { 'user-agent': 'BETAPP-V2/2.0 (+provider-qualification)' } });
    return { status: response.status, note: response.ok ? 'robots.txt erişilebilir; otomasyon izni ayrıca manuel doğrulanmalı.' : 'robots.txt erişilemedi.' };
  } catch {
    return { status: null, note: 'robots.txt sorgusu başarısız; manuel inceleme gerekli.' };
  } finally { clearTimeout(timer); }
}

export class PolicyQualificationProvider implements QualifiableProvider {
  readonly name: string;
  constructor(private readonly providerId: HistoricalProviderId) { this.name = providerId; }
  async qualify(): Promise<ProviderQualification> {
    const policy = historicalProviderPolicies[this.providerId];
    const robots = await robotsStatus(policy.baseUrl);
    const result = policy.status === 'DISABLED_PAID_API' ? 'UNAVAILABLE' : 'NOT_TESTED';
    const notes = `${policy.status}: ${policy.reason} ${robots.note}`;
    return { provider: policy.id, connection: result, checks: providerCapabilities.map((capability) =>
      check(capability, result, `${policy.baseUrl}/robots.txt`, { httpStatus: robots.status, parseSuccess: false, notes })) };
  }
}
