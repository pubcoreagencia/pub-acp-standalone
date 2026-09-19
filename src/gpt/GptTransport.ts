import { randomUUID } from 'node:crypto';
import {
  GptHealthResult,
  GptPromptOptions,
  GptPromptResponse,
  IGptTransport
} from './types.js';

export interface GptTransportConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  defaultTimeoutMs?: number;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch (err: any) {
    throw new Error(`Invalid JSON response: ${err?.message || 'unknown parse error'}`);
  }
}

export class GptTransport implements IGptTransport {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly model?: string;
  private readonly defaultTimeoutMs: number;

  constructor(config: GptTransportConfig = {}) {
    const explicitBaseUrl =
      config.baseUrl ||
      process.env.GPT_BASE_URL ||
      process.env.OPENAI_BASE_URL;

    const openAiKey = config.apiKey || process.env.GPT_API_KEY || process.env.OPENAI_API_KEY;
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    this.baseUrl =
      explicitBaseUrl ||
      (openRouterKey && !openAiKey
        ? 'https://openrouter.ai/api/v1'
        : 'https://api.openai.com/v1');

    this.apiKey =
      config.apiKey ||
      process.env.GPT_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.OPENROUTER_API_KEY;

    this.model =
      config.model ||
      process.env.GPT_MODEL ||
      process.env.OPENAI_MODEL ||
      process.env.OPENROUTER_MODEL;

    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 120000;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getModel(): string | undefined {
    return this.model;
  }

  createSession(): string {
    return `gpt-session-${randomUUID()}`;
  }

  async health(timeoutMs = 10000): Promise<GptHealthResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(joinUrl(this.baseUrl, '/models'), {
        method: 'GET',
        headers: this.apiKey
          ? { Accept: 'application/json', Authorization: `Bearer ${this.apiKey}` }
          : { Accept: 'application/json' },
        signal: controller.signal
      });

      const json = await readJson(response);

      if (!response.ok) {
        return {
          status: 'error',
          initialized: false,
          error: json?.error?.message || `GPT endpoint returned HTTP ${response.status}`
        };
      }

      return {
        status: 'ok',
        initialized: true,
        isProcessing: false,
        details: {
          baseUrl: this.baseUrl,
          model: this.model,
          modelsAvailable: Array.isArray(json?.data) ? json.data.length : undefined
        }
      };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return {
          status: 'error',
          initialized: false,
          error: `GPT health check timed out after ${timeoutMs}ms`
        };
      }

      return {
        status: 'error',
        initialized: false,
        error: err?.message || 'GPT health check failed'
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async sendPrompt(prompt: string, options: GptPromptOptions = {}): Promise<GptPromptResponse> {
    const started = Date.now();
    const requestId = options.request_id || `gpt-req-${randomUUID()}`;
    const timeoutMs = options.timeout_ms || this.defaultTimeoutMs;
    const requestedModel =
      typeof options.options?.model === 'string' ? options.options.model : undefined;
    const model = requestedModel || this.model;
    const sessionId = options.session_id || this.createSession();

    if (!model) {
      return {
        request_id: requestId,
        session_id: sessionId,
        status: 'FAILED',
        text: '',
        duration_ms: Date.now() - started,
        error: {
          code: 'CONFIG_ERROR',
          message: 'No GPT model configured. Set GPT_MODEL or pass a model through runtime configuration.'
        }
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(joinUrl(this.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      });

      const json = await readJson(response);

      if (!response.ok) {
        const message =
          json?.error?.message ||
          json?.message ||
          `GPT endpoint returned HTTP ${response.status}`;

        return {
          request_id: json?.id || requestId,
          session_id: sessionId,
          status: 'FAILED',
          text: '',
          duration_ms: Date.now() - started,
          error: {
            code: json?.error?.code || `HTTP_${response.status}`,
            message,
            details: json?.error
          }
        };
      }

      const text =
        json?.choices?.[0]?.message?.content ??
        (typeof json?.choices?.[0]?.text === 'string' ? json.choices[0].text : '');

      if (typeof text !== 'string' || text.length === 0) {
        return {
          request_id: json?.id || requestId,
          session_id: sessionId,
          status: 'FAILED',
          text: '',
          duration_ms: Date.now() - started,
          error: {
            code: 'INVALID_RESPONSE',
            message: 'GPT response did not contain choices[0].message.content.'
          }
        };
      }

      return {
        request_id: json?.id || requestId,
        session_id: sessionId,
        status: 'COMPLETED',
        text,
        duration_ms: Date.now() - started,
        metadata: {
          model,
          provider: this.baseUrl,
          usage: json?.usage,
          finish_reason: json?.choices?.[0]?.finish_reason,
          session_mode: 'logical'
        }
      };
    } catch (err: any) {
      const durationMs = Date.now() - started;

      if (err?.name === 'AbortError') {
        return {
          request_id: requestId,
          session_id: sessionId,
          status: 'TIMEOUT',
          text: '',
          duration_ms: durationMs,
          error: {
            code: 'TIMEOUT',
            message: `GPT request timed out after ${timeoutMs}ms`
          }
        };
      }

      return {
        request_id: requestId,
        session_id: sessionId,
        status: 'FAILED',
        text: '',
        duration_ms: durationMs,
        error: {
          code: 'NETWORK_ERROR',
          message: err?.message || 'Error communicating with GPT endpoint'
        }
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async continueSession(
    sessionId: string,
    prompt: string,
    options: Omit<GptPromptOptions, 'session_id'> = {}
  ): Promise<GptPromptResponse> {
    return this.sendPrompt(prompt, {
      ...options,
      session_id: sessionId
    });
  }

  async recover(): Promise<boolean> {
    const health = await this.health(5000);
    return health.status === 'ok';
  }
}
