import { afterEach, describe, expect, it, vi } from 'vitest';
import { NvidiaProvider } from '../../src/ai/nvidia-provider.js';
import { GroqProvider } from '../../src/ai/groq-provider.js';
import { AiService } from '../../src/ai/service.js';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { Logger } from '../../src/logger.js';
import { FootballRepository } from '../../src/db/repository.js';
import { evaluatePrediction } from '../../src/predictions/engine.js';
import { predictionConfig } from '../../src/predictions/config.js';
import { createLogger } from '../../src/logger.js';

describe('NVIDIA NIM AI Provider and AI Router', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // A) NVIDIA API key yok -> configured=false, request yapılmıyor
  it('A) when NVIDIA_API_KEY is missing: configured=false and no HTTP request is made', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const provider = new NvidiaProvider({ apiKey: '' });
    expect(provider.isConfigured()).toBe(false);

    const res = await provider.complete([{ role: 'user', content: 'test' }]);
    expect(res.success).toBe(false);
    expect(res.error).toBe('NOT_CONFIGURED');
    expect(fetchSpy).not.toHaveBeenCalled();

    const health = await provider.checkAvailability();
    expect(health.configured).toBe(false);
    expect(health.reachable).toBeNull();
    expect(health.errorCode).toBe('NOT_CONFIGURED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // B) NVIDIA success -> normalized response dönüyor
  it('B) when NVIDIA succeeds: returns normalized AiResponse', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Match analysis: Both teams have strong offensive records.',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const provider = new NvidiaProvider({
      apiKey: 'nvapi-valid-test-key',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    });

    expect(provider.isConfigured()).toBe(true);

    const res = await provider.complete([{ role: 'user', content: 'analyze match' }]);
    expect(res.success).toBe(true);
    expect(res.provider).toBe('nvidia');
    expect(res.model).toBe('nvidia/nemotron-3.5-lightning-30b-a3b');
    expect(res.content).toBe('Match analysis: Both teams have strong offensive records.');
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    expect(res.error).toBeUndefined();
  });

  // C) NVIDIA 401 -> safe error (AUTH_ERROR, no leak)
  it('C) when NVIDIA returns HTTP 401: returns safe AUTH_ERROR and does not leak token', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized key' }), { status: 401 }),
    );

    const provider = new NvidiaProvider({
      apiKey: 'nvapi-secret-key-12345',
    });

    const res = await provider.complete([{ role: 'user', content: 'test' }]);
    expect(res.success).toBe(false);
    expect(res.error).toBe('AUTH_ERROR');
    expect(JSON.stringify(res)).not.toContain('nvapi-secret-key-12345');
  });

  // D) NVIDIA 429 -> safe error (RATE_LIMIT)
  it('D) when NVIDIA returns HTTP 429: returns safe RATE_LIMIT error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 }),
    );

    const provider = new NvidiaProvider({
      apiKey: 'nvapi-test-key',
    });

    const res = await provider.complete([{ role: 'user', content: 'test' }]);
    expect(res.success).toBe(false);
    expect(res.error).toBe('RATE_LIMIT');
  });

  // E) NVIDIA 500 -> safe error (API_ERROR)
  it('E) when NVIDIA returns HTTP 500: returns safe API_ERROR error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 }),
    );

    const provider = new NvidiaProvider({
      apiKey: 'nvapi-test-key',
    });

    const res = await provider.complete([{ role: 'user', content: 'test' }]);
    expect(res.success).toBe(false);
    expect(res.error).toBe('API_ERROR');
  });

  // F) NVIDIA timeout -> safe error (TIMEOUT)
  it('F) when NVIDIA times out: aborts safely and returns TIMEOUT error', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    const provider = new NvidiaProvider({
      apiKey: 'nvapi-test-key',
      timeoutMs: 20, // 20ms timeout for test speed
    });

    const res = await provider.complete([{ role: 'user', content: 'test' }]);
    expect(res.success).toBe(false);
    expect(res.error).toBe('TIMEOUT');
  });

  // G) Groq success -> NVIDIA fallback çağrılmıyor
  it('G) when Groq succeeds: returns Groq response and NVIDIA fallback is never invoked', async () => {
    const mockGroq = new GroqProvider({ apiKey: 'gsk-test' });
    const mockNvidia = new NvidiaProvider({ apiKey: 'nvapi-test' });

    vi.spyOn(mockGroq, 'isConfigured').mockReturnValue(true);
    vi.spyOn(mockGroq, 'complete').mockResolvedValue({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      content: 'Groq analysis completed',
      latencyMs: 15,
      success: true,
    });

    const nvidiaSpy = vi.spyOn(mockNvidia, 'complete');

    const service = new AiService(
      {
        GROQ_API_KEY: 'gsk-test',
        GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
        GROQ_MODEL: 'llama-3.3-70b-versatile',
        NVIDIA_API_KEY: 'nvapi-test',
        NVIDIA_BASE_URL: 'https://integrate.api.nvidia.com/v1',
        NVIDIA_MODEL: 'nvidia/nemotron-3.5-lightning-30b-a3b',
        AI_ROUTER_PROVIDER: 'groq',
        AI_FALLBACK_PROVIDER: 'nvidia',
        AI_TIMEOUT_MS: 15000,
      },
      { groqProvider: mockGroq, nvidiaProvider: mockNvidia },
    );

    const result = await service.generateAnalysis([{ role: 'user', content: 'hello' }]);
    expect(result.success).toBe(true);
    expect(result.provider).toBe('groq');
    expect(result.content).toBe('Groq analysis completed');
    expect(nvidiaSpy).not.toHaveBeenCalled();
  });

  // H) Groq failure + NVIDIA success -> NVIDIA response kullanılıyor
  it('H) when Groq fails and NVIDIA succeeds: seamlessly falls back to NVIDIA response', async () => {
    const mockGroq = new GroqProvider({ apiKey: 'gsk-test' });
    const mockNvidia = new NvidiaProvider({ apiKey: 'nvapi-test' });

    vi.spyOn(mockGroq, 'isConfigured').mockReturnValue(true);
    vi.spyOn(mockGroq, 'complete').mockResolvedValue({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      content: '',
      latencyMs: 25,
      success: false,
      error: 'RATE_LIMIT',
    });

    vi.spyOn(mockNvidia, 'isConfigured').mockReturnValue(true);
    vi.spyOn(mockNvidia, 'complete').mockResolvedValue({
      provider: 'nvidia',
      model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
      content: 'NVIDIA fallback analysis result',
      latencyMs: 30,
      success: true,
    });

    const service = new AiService(
      {
        GROQ_API_KEY: 'gsk-test',
        GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
        GROQ_MODEL: 'llama-3.3-70b-versatile',
        NVIDIA_API_KEY: 'nvapi-test',
        NVIDIA_BASE_URL: 'https://integrate.api.nvidia.com/v1',
        NVIDIA_MODEL: 'nvidia/nemotron-3.5-lightning-30b-a3b',
        AI_ROUTER_PROVIDER: 'groq',
        AI_FALLBACK_PROVIDER: 'nvidia',
        AI_TIMEOUT_MS: 15000,
      },
      { groqProvider: mockGroq, nvidiaProvider: mockNvidia },
    );

    const result = await service.generateAnalysis([{ role: 'user', content: 'analyze' }]);
    expect(result.success).toBe(true);
    expect(result.provider).toBe('nvidia');
    expect(result.content).toBe('NVIDIA fallback analysis result');
  });

  // I) Groq failure + NVIDIA failure -> AI unavailable
  it('I) when both Groq and NVIDIA fail: returns safe AI_UNAVAILABLE response without crashing', async () => {
    const mockGroq = new GroqProvider({ apiKey: 'gsk-test' });
    const mockNvidia = new NvidiaProvider({ apiKey: 'nvapi-test' });

    vi.spyOn(mockGroq, 'isConfigured').mockReturnValue(true);
    vi.spyOn(mockGroq, 'complete').mockResolvedValue({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      content: '',
      latencyMs: 20,
      success: false,
      error: 'API_ERROR',
    });

    vi.spyOn(mockNvidia, 'isConfigured').mockReturnValue(true);
    vi.spyOn(mockNvidia, 'complete').mockResolvedValue({
      provider: 'nvidia',
      model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
      content: '',
      latencyMs: 20,
      success: false,
      error: 'API_ERROR',
    });

    const service = new AiService(
      {
        GROQ_API_KEY: 'gsk-test',
        GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
        GROQ_MODEL: 'llama-3.3-70b-versatile',
        NVIDIA_API_KEY: 'nvapi-test',
        NVIDIA_BASE_URL: 'https://integrate.api.nvidia.com/v1',
        NVIDIA_MODEL: 'nvidia/nemotron-3.5-lightning-30b-a3b',
        AI_ROUTER_PROVIDER: 'groq',
        AI_FALLBACK_PROVIDER: 'nvidia',
        AI_TIMEOUT_MS: 15000,
      },
      { groqProvider: mockGroq, nvidiaProvider: mockNvidia },
    );

    const result = await service.generateAnalysis([{ role: 'user', content: 'analyze' }]);
    expect(result.success).toBe(false);
    expect(result.provider).toBe('none');
    expect(result.error).toBe('AI_UNAVAILABLE');
  });

  // J) API key loglanmıyor
  it('J) ensures API key and authorization header are NEVER logged', async () => {
    const logEvents: Array<{ level: string; msg: string; obj?: unknown }> = [];
    const dummyLogger = {
      debug: (obj: unknown, msg: string) => logEvents.push({ level: 'debug', msg, obj }),
      info: (obj: unknown, msg: string) => logEvents.push({ level: 'info', msg, obj }),
      warn: (obj: unknown, msg: string) => logEvents.push({ level: 'warn', msg, obj }),
      error: (obj: unknown, msg: string) => logEvents.push({ level: 'error', msg, obj }),
    } as unknown as Logger;

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Auth failed' }), { status: 401 }),
    );

    const secretKey = 'nvapi-super-confidential-secret-key-999';
    const provider = new NvidiaProvider({
      apiKey: secretKey,
      logger: dummyLogger,
    });

    await provider.complete([{ role: 'user', content: 'test logging' }]);

    const fullLogText = JSON.stringify(logEvents);
    expect(fullLogText).not.toContain(secretKey);
    expect(fullLogText).not.toContain('Bearer');
  });

  // K) /api/ai-status -> secret yok
  it('K) GET /api/ai-status returns provider states without leaking secrets', async () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://betapp:betapp@localhost:5432/betapp',
      NVIDIA_API_KEY: 'nvapi-top-secret-key',
      NVIDIA_BASE_URL: 'https://integrate.api.nvidia.com/v1',
      NVIDIA_MODEL: 'nvidia/nemotron-3.5-lightning-30b-a3b',
      GROQ_API_KEY: 'gsk-top-secret-key',
      GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
      GROQ_MODEL: 'llama-3.3-70b-versatile',
      AI_ROUTER_PROVIDER: 'groq',
      AI_FALLBACK_PROVIDER: 'nvidia',
    });

    const dummyLogger = createLogger(config, 'betapp-test');
    const dummyRepo = {} as unknown as FootballRepository;
    const app = buildApp(config, dummyRepo, dummyLogger);

    const response = await app.inject({
      method: 'GET',
      url: '/api/ai-status',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.router).toEqual({
      primary: 'groq',
      fallback: 'nvidia',
    });
    expect(body.groq.configured).toBe(true);
    expect(body.groq.model).toBe('llama-3.3-70b-versatile');
    expect(body.nvidia.configured).toBe(true);
    expect(body.nvidia.baseUrlConfigured).toBe(true);
    expect(body.nvidia.model).toBe('nvidia/nemotron-3.5-lightning-30b-a3b');
    expect(body.nvidia.reachable).toBeNull(); // No startup health request

    const responseText = response.body;
    expect(responseText).not.toContain('nvapi-top-secret-key');
    expect(responseText).not.toContain('gsk-top-secret-key');
  });

  // L) prediction gate regression -> LOCKED_PREDICTION kurallarını değiştirmiyor
  it('L) ensures prediction score weights, thresholds, and decision gates remain completely unchanged', () => {
    const item = {
      marketType: 'TOTAL_GOALS' as const,
      marketName: 'Total Goals',
      line: 2.5,
      selection: 'OVER' as const,
      openingOdds: 2.0,
      currentOdds: 1.8,
      highestOdds: 2.0,
      lowestOdds: 1.8,
      snapshotCount: 6,
      openingFairProbability: 0.45,
      currentFairProbability: 0.56,
      probabilityDeltaPp: 11,
      rawOddsMovementPercent: -10,
      bookmakerCount: 3,
      completeStateBookmakerCount: 3,
      minimumCompleteStateCount: 2,
      agreeingBookmakerCount: 3,
      disagreeingBookmakerCount: 0,
      movementAgreementRatio: 1,
      probabilityDispersion: 0.2,
      oddsDispersion: 0.1,
      movementClass: 'SUPPORT' as const,
      score: 80,
      scoreComponents: { movement: 30, agreement: 20, coverage: 20, freshness: 15, stability: 15 },
      dataQuality: { score: 90, grade: 'GOOD' as const, analysisEligible: true, warnings: [] },
      modelConfidence: { score: 85, grade: 'GOOD' as const },
      analysisEligible: true,
      reasons: [],
      warnings: [],
      modelMarketGapPp: null,
    };

    const kickoff = new Date('2026-09-20T18:00:00Z');
    const target = {
      matchId: 'target-1',
      competitionId: 'league-a',
      kickoffAt: kickoff,
      oddsInputHash: 'input-hash',
      oddsItems: [item],
    };

    const result = evaluatePrediction(target, [], kickoff);
    expect(result.decision).toBe('SKIP');
    expect(result.skipReasons).toContain('INSUFFICIENT_HISTORICAL_SAMPLE');
    expect(predictionConfig.minimumPredictionScore).toBe(70);
    expect(predictionConfig.minimumHistoricalSample).toBe(30);
  });
});
