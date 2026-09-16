import type { Logger } from '../logger.js';

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

type HttpClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  requestsPerSecond: number;
  maxRetries: number;
  logger: Logger;
};

export class ResilientHttpClient {
  private nextAllowedAt = 0;
  private rateLimitChain: Promise<void> = Promise.resolve();
  private retryCount = 0;

  constructor(private readonly options: HttpClientOptions) {}

  private async rateLimit(): Promise<void> {
    const previous = this.rateLimitChain;
    let release!: () => void;
    this.rateLimitChain = new Promise<void>((resolve) => (release = resolve));
    await previous;
    const delay = Math.max(0, this.nextAllowedAt - Date.now());
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    this.nextAllowedAt = Date.now() + Math.ceil(1000 / this.options.requestsPerSecond);
    release();
  }

  async getJson<T>(path: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      await this.rateLimit();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await fetch(`${this.options.baseUrl}${path}`, {
          signal: controller.signal,
          headers: {
            accept: 'application/json',
            'user-agent': 'BETAPP-V2/2.0 (+data-collector)',
          },
        });
        if (!response.ok) {
          const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
          throw new ProviderHttpError(`Provider returned HTTP ${response.status}`, response.status, retryable);
        }
        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        const retryable = !(error instanceof ProviderHttpError) || error.retryable;
        if (!retryable || attempt === this.options.maxRetries) break;
        this.retryCount += 1;
        const exponential = Math.min(30_000, 500 * 2 ** attempt);
        const jitter = Math.floor(Math.random() * Math.max(1, exponential * 0.25));
        const waitMs = exponential + jitter;
        this.options.logger.warn({ err: error, path, attempt: attempt + 1, waitMs }, 'Provider request retry');
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new ProviderHttpError('Provider request failed');
  }

  consumeRetryCount(): number {
    const count = this.retryCount;
    this.retryCount = 0;
    return count;
  }
}
