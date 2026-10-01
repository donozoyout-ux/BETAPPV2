export interface AiPromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiRequestOptions {
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  timeoutMs?: number | undefined;
}

export interface AiResponse {
  provider: string;
  model: string;
  content: string;
  latencyMs: number;
  success: boolean;
  error?: string | undefined;
}

export interface AiAvailabilityResult {
  configured: boolean;
  reachable: boolean | null;
  latencyMs?: number | undefined;
  model: string;
  errorCode?: string | undefined;
  error?: string | undefined;
}

export interface AiStatusResponse {
  router: {
    primary: string;
    fallback: string;
  };
  groq: {
    configured: boolean;
    baseUrlConfigured?: boolean | undefined;
    model?: string | undefined;
    reachable?: boolean | null | undefined;
  };
  nvidia: {
    configured: boolean;
    baseUrlConfigured: boolean;
    model: string;
    reachable: boolean | null;
    latencyMs?: number | undefined;
    errorCode?: string | undefined;
  };
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  isConfigured(): boolean;
  complete(messages: AiPromptMessage[], options?: AiRequestOptions): Promise<AiResponse>;
  checkAvailability(): Promise<AiAvailabilityResult>;
}
