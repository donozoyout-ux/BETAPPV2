import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { IddaaProvider } from '../../src/providers/public-page-provider.js';

afterEach(() => vi.unstubAllGlobals());

describe('public page qualification provider', () => {
  it('reports UNAVAILABLE without crashing on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp' });
    const report = await new IddaaProvider(config).qualify();
    expect(report.connection).toBe('UNAVAILABLE');
    expect(report.checks.every((item) => item.result === 'UNAVAILABLE')).toBe(true);
  });
});
