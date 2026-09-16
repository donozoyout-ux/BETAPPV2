import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { ProviderHttpError, ResilientHttpClient } from '../../src/providers/http-client.js';

afterEach(() => vi.unstubAllGlobals());

describe('ResilientHttpClient', () => {
  it('does not retry non-retryable 4xx responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent' });
    const client = new ResilientHttpClient({
      baseUrl: 'https://example.test', timeoutMs: 1000, requestsPerSecond: 10, maxRetries: 3,
      logger: createLogger(config),
    });
    await expect(client.getJson('/missing')).rejects.toBeInstanceOf(ProviderHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries HTTP 429 and succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent' });
    const client = new ResilientHttpClient({ baseUrl: 'https://example.test', timeoutMs: 1000,
      requestsPerSecond: 1000, maxRetries: 1, logger: createLogger(config) });
    await expect(client.getJson('/rate-limited')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })));
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent' });
    const client = new ResilientHttpClient({ baseUrl: 'https://example.test', timeoutMs: 1000,
      requestsPerSecond: 1000, maxRetries: 0, logger: createLogger(config) });
    await expect(client.getJson('/invalid')).rejects.toBeInstanceOf(SyntaxError);
  });

  it('times out an unresponsive request', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/betapp', LOG_LEVEL: 'silent' });
    const client = new ResilientHttpClient({ baseUrl: 'https://example.test', timeoutMs: 10,
      requestsPerSecond: 1000, maxRetries: 0, logger: createLogger(config) });
    await expect(client.getJson('/slow')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
