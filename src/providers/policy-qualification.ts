import { check } from '../qualification/helpers.js';
import { providerCapabilities, type ProviderQualification, type QualifiableProvider } from '../qualification/types.js';
import { historicalProviderPolicies } from '../historical/provider-policy.js';
import type { HistoricalProviderId } from '../historical/types.js';

type RobotsStatus = { status: number | null; note: string };

function classifyRobots(body: string): string {
  const wildcard = body.match(/user-agent:\s*\*([\s\S]*?)(?=\n\s*user-agent:|$)/i)?.[1] ?? '';
  if (!wildcard) return 'ROBOTS_UNCLEAR';
  if (/^\s*disallow:\s*\/\s*$/im.test(wildcard)) return 'ROBOTS_RESTRICTED';
  if (/^\s*disallow:\s*$/im.test(wildcard)) return 'ROBOTS_ALLOWED';
  if (!/^\s*disallow:/im.test(wildcard)) return 'ROBOTS_ALLOWED';
  return 'ROBOTS_UNCLEAR';
}

async function robotsStatus(baseUrl: string): Promise<RobotsStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${baseUrl}/robots.txt`, { signal: controller.signal,
      headers: { 'user-agent': 'BETAPP-V2/2.0 (+provider-qualification)' } });
    const body = await response.text();
    const classification = response.ok ? classifyRobots(body) : 'ROBOTS_RESTRICTED';
    return { status: response.status, note: `${classification}; robots.txt erişilebilir olsa bile kullanım koşulları ayrıca doğrulanmalı.` };
  } catch {
    return { status: null, note: 'ROBOTS_UNCLEAR; robots.txt sorgusu başarısız, manuel inceleme gerekli.' };
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
