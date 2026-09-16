import { describe, expect, it, vi } from 'vitest';
import { Collector } from '../../src/collector/collector.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import type { FootballDataProvider } from '../../src/providers/provider.js';
import type { FootballRepository } from '../../src/db/repository.js';

describe('Collector restart', () => {
  it('continues from the persisted nextDate cursor', async () => {
    const getFixtures = vi.fn().mockResolvedValue([]);
    const provider: FootballDataProvider = {
      name: 'fake', getFixtures, getMatchStatistics: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue({ provider: 'fake', ok: true, checkedAt: new Date(), latencyMs: 1 }),
    };
    const markSucceeded = vi.fn();
    const repository = {
      updateCircuitState: vi.fn(), updateProviderStatus: vi.fn(),
      getCheckpoint: vi.fn().mockResolvedValue({ nextDate: '2026-09-16', endDate: '2026-09-16', completed: false }),
      markStarted: vi.fn(), markSucceeded, markProviderFetch: vi.fn(), markFailed: vi.fn(),
    } as unknown as FootballRepository;
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent' });
    const collector = new Collector(provider, repository, config, createLogger(config));
    await collector.runCycle();
    expect(getFixtures).toHaveBeenCalledOnce();
    expect(getFixtures.mock.calls[0]?.[0].date.toISOString()).toBe('2026-09-16T00:00:00.000Z');
    expect(markSucceeded).toHaveBeenLastCalledWith('fake', 'fixtures-and-statistics', expect.objectContaining({ completed: true }));
  });
});
