import type { Logger } from '../logger.js';
import type { AiAvailabilityResult, AiPromptMessage, AiProvider, AiRequestOptions, AiResponse } from './types.js';

export interface NvidiaProviderOptions {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  model?: string | undefined;
  timeoutMs?: number | undefined;
  logger?: Logger | undefined;
}

export class NvidiaProvider implements AiProvider {
  readonly name = 'nvidia';
  readonly baseUrl: string;
  readonly model: string;
  private readonly apiKey?: string | undefined;
  private readonly timeoutMs: number;
  private readonly logger?: Logger | undefined;

  constructor(options: NvidiaProviderOptions = {}) {
    this.apiKey = options.apiKey?.trim();
    this.baseUrl = (options.baseUrl || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
    this.model = options.model?.trim() || 'nvidia/nemotron-3.5-lightning-30b-a3b';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.logger = options.logger;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  async complete(messages: AiPromptMessage[], options: AiRequestOptions = {}): Promise<AiResponse> {
    if (!this.isConfigured()) {
      return {
        provider: this.name,
        model: this.model,
        content: '',
        latencyMs: 0,
        success: false,
        error: 'NOT_CONFIGURED',
      };
    }

    const start = Date.now();
    const timeout = options.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const endpoint = `${this.baseUrl}/chat/completions`;
    const payload = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 1200,
      stream: false,
    };

    try {
      this.logger?.debug({ provider: this.name, model: this.model, endpoint }, 'NVIDIA AI request start');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        let errorCode = 'API_ERROR';
        if (response.status === 401) {
          errorCode = 'AUTH_ERROR';
        } else if (response.status === 403) {
          errorCode = 'FORBIDDEN';
        } else if (response.status === 429) {
          errorCode = 'RATE_LIMIT';
        } else if (response.status >= 500) {
          errorCode = 'API_ERROR';
        } else {
          errorCode = `HTTP_${response.status}`;
        }

        this.logger?.warn(
          { provider: this.name, status: response.status, errorCode, latencyMs },
          'NVIDIA AI request failed with HTTP status',
        );

        return {
          provider: this.name,
          model: this.model,
          content: '',
          latencyMs,
          success: false,
          error: errorCode,
        };
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        this.logger?.warn({ provider: this.name, latencyMs }, 'NVIDIA AI returned invalid JSON');
        return {
          provider: this.name,
          model: this.model,
          content: '',
          latencyMs,
          success: false,
          error: 'INVALID_JSON',
        };
      }

      const parsed = data as { choices?: Array<{ message?: { content?: string } }> };
      const content = parsed.choices?.[0]?.message?.content;

      if (typeof content !== 'string' || content.trim().length === 0) {
        this.logger?.warn({ provider: this.name, latencyMs }, 'NVIDIA AI returned empty response');
        return {
          provider: this.name,
          model: this.model,
          content: '',
          latencyMs,
          success: false,
          error: 'EMPTY_RESPONSE',
        };
      }

      this.logger?.debug({ provider: this.name, model: this.model, latencyMs }, 'NVIDIA AI request completed successfully');

      return {
        provider: this.name,
        model: this.model,
        content: content.trim(),
        latencyMs,
        success: true,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      const errorCode = isAbort ? 'TIMEOUT' : 'NETWORK_ERROR';

      this.logger?.warn(
        { provider: this.name, errorCode, isAbort, latencyMs },
        'NVIDIA AI request failed with exception',
      );

      return {
        provider: this.name,
        model: this.model,
        content: '',
        latencyMs,
        success: false,
        error: errorCode,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async checkAvailability(): Promise<AiAvailabilityResult> {
    if (!this.isConfigured()) {
      return {
        configured: false,
        reachable: null,
        model: this.model,
        errorCode: 'NOT_CONFIGURED',
      };
    }

    const res = await this.complete(
      [{ role: 'user', content: 'health check' }],
      { maxTokens: 10, timeoutMs: 10_000 },
    );

    if (res.success) {
      return {
        configured: true,
        reachable: true,
        latencyMs: res.latencyMs,
        model: this.model,
      };
    }

    return {
      configured: true,
      reachable: false,
      latencyMs: res.latencyMs,
      model: this.model,
      errorCode: res.error || 'API_ERROR',
      error: res.error,
    };
  }
}
