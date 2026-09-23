import { describe, expect, it, vi } from 'vitest';
import { ControlAuditService } from '../../src/control-audit.js';
import { loadConfig } from '../../src/config.js';

function fakePool(values: { invalid?: number; stale?: number; pending?: number; duplicate?: number; suspicious?: number; triggers?: number; api?: string } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('count(*)::integer total')) return { rows: [{ total: 4, mapped: 4 }] };
    if (sql.includes('count(*)::integer invalid')) return { rows: [{ invalid: values.invalid ?? 0 }] };
    if (sql.includes('count(*)::integer live')) return { rows: [{ live: 1, stale: values.stale ?? 0 }] };
    if (sql.includes('count(*)::integer pending')) return { rows: [{ pending: values.pending ?? 0 }] };
    if (sql.includes('duplicate_groups')) return { rows: [{ duplicate_groups: values.duplicate ?? 0 }] };
    if (sql.includes('suspicious')) return { rows: [{ suspicious: values.suspicious ?? 0 }] };
    if (sql.includes('FROM pg_trigger')) return { rows: [{ count: values.triggers ?? 2 }] };
    if (sql.includes('FROM live_provider_health')) return { rows: [{ status: values.api ?? 'SUPPORTED' }] };
    if (sql.includes('INSERT INTO control_audit_runs')) return { rows: [{
      id: 1, version: 'CONTROL_AUDIT_V1', status: values.invalid ? 'FAIL' : 'PASS',
      checked_at: new Date(), checks: [], summary: {},
    }] };
    throw new Error('unexpected query: ' + sql);
  });
  return { query };
}

describe('CONTROL_AUDIT_V1', () => {
  it('passes when persistence, immutable guards and live checks are healthy', async () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', API_FOOTBALL_ENABLED: 'true', API_FOOTBALL_KEY: 'x' });
    const pool = fakePool();
    const result = await new ControlAuditService(pool as never, config).run();
    expect(result).toMatchObject({ version: 'CONTROL_AUDIT_V1', status: 'PASS' });
  });

  it('fails closed on malformed official predictions', async () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp' });
    const pool = fakePool({ invalid: 1 });
    const result = await new ControlAuditService(pool as never, config).run();
    expect(result.status).toBe('FAIL');
  });
});
