import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { GroqProvider } from './groq-provider.js';
import { NvidiaProvider } from './nvidia-provider.js';
import type {
  AiAvailabilityResult,
  AiPromptMessage,
  AiProvider,
  AiRequestOptions,
  AiResponse,
  AiStatusResponse,
} from './types.js';

export interface AiServiceOptions {
  groqProvider?: AiProvider | undefined;
  nvidiaProvider?: AiProvider | undefined;
  primaryProviderName?: string | undefined;
  fallbackProviderName?: string | undefined;
  logger?: Logger | undefined;
}

export class AiService {
  readonly groqProvider: AiProvider;
  readonly nvidiaProvider: AiProvider;
  private readonly primaryProviderName: string;
  private readonly fallbackProviderName: string;
  private readonly logger?: Logger | undefined;

  constructor(
    private readonly config: Pick<
      AppConfig,
      | 'GROQ_API_KEY'
      | 'GROQ_BASE_URL'
      | 'GROQ_MODEL'
      | 'NVIDIA_API_KEY'
      | 'NVIDIA_BASE_URL'
      | 'NVIDIA_MODEL'
      | 'AI_ROUTER_PROVIDER'
      | 'AI_FALLBACK_PROVIDER'
      | 'AI_TIMEOUT_MS'
    >,
    options: AiServiceOptions = {},
  ) {
    this.logger = options.logger;
    this.groqProvider =
      options.groqProvider ??
      new GroqProvider({
        apiKey: config.GROQ_API_KEY,
        baseUrl: config.GROQ_BASE_URL,
        model: config.GROQ_MODEL,
        timeoutMs: config.AI_TIMEOUT_MS,
        logger: this.logger,
      });

    this.nvidiaProvider =
      options.nvidiaProvider ??
      new NvidiaProvider({
        apiKey: config.NVIDIA_API_KEY,
        baseUrl: config.NVIDIA_BASE_URL,
        model: config.NVIDIA_MODEL,
        timeoutMs: config.AI_TIMEOUT_MS,
        logger: this.logger,
      });

    this.primaryProviderName = options.primaryProviderName ?? config.AI_ROUTER_PROVIDER;
    this.fallbackProviderName = options.fallbackProviderName ?? config.AI_FALLBACK_PROVIDER;
  }

  private getProvider(name: string): AiProvider | null {
    if (name === 'groq') return this.groqProvider;
    if (name === 'nvidia') return this.nvidiaProvider;
    return null;
  }

  async generateAnalysis(messages: AiPromptMessage[], options: AiRequestOptions = {}): Promise<AiResponse> {
    const primary = this.getProvider(this.primaryProviderName);
    const fallback = this.fallbackProviderName !== 'none' ? this.getProvider(this.fallbackProviderName) : null;

    if (primary) {
      if (!primary.isConfigured()) {
        this.logger?.info(
          { primary: this.primaryProviderName, fallback: this.fallbackProviderName },
          'Primary AI provider not configured, attempting fallback',
        );
      } else {
        const primaryRes = await primary.complete(messages, options);
        if (primaryRes.success) {
          return primaryRes;
        }
        this.logger?.warn(
          {
            primary: this.primaryProviderName,
            error: primaryRes.error,
            fallback: this.fallbackProviderName,
          },
          'Primary AI provider request failed, attempting fallback',
        );
      }
    }

    if (fallback && fallback !== primary) {
      if (!fallback.isConfigured()) {
        this.logger?.warn(
          { fallback: this.fallbackProviderName },
          'Fallback AI provider not configured',
        );
      } else {
        const fallbackRes = await fallback.complete(messages, options);
        if (fallbackRes.success) {
          return fallbackRes;
        }
        this.logger?.warn(
          { fallback: this.fallbackProviderName, error: fallbackRes.error },
          'Fallback AI provider request failed',
        );
      }
    }

    return {
      provider: 'none',
      model: 'none',
      content: '',
      latencyMs: 0,
      success: false,
      error: 'AI_UNAVAILABLE',
    };
  }

  async checkNvidiaAvailability(): Promise<AiAvailabilityResult> {
    return this.nvidiaProvider.checkAvailability();
  }

  async status(checkHealth = false): Promise<AiStatusResponse> {
    let health: AiAvailabilityResult | null = null;
    if (checkHealth && this.nvidiaProvider.isConfigured()) {
      health = await this.checkNvidiaAvailability();
    }

    return {
      router: {
        primary: this.primaryProviderName,
        fallback: this.fallbackProviderName,
      },
      groq: {
        configured: this.groqProvider.isConfigured(),
        baseUrlConfigured: Boolean(this.config.GROQ_BASE_URL),
        model: this.groqProvider.model,
      },
      nvidia: {
        configured: this.nvidiaProvider.isConfigured(),
        baseUrlConfigured: Boolean(this.config.NVIDIA_BASE_URL),
        model: this.nvidiaProvider.model,
        reachable: health ? health.reachable : null,
        latencyMs: health?.latencyMs,
        errorCode: health?.errorCode,
      },
    };
  }
}
