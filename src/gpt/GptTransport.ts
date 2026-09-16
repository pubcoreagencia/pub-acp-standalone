import { randomUUID } from 'node:crypto';
import { AcpLabClient } from '../client/acp-lab-client.js';
import {
  GptHealthResult,
  GptPromptOptions,
  GptPromptResponse,
  GptTransportStatus,
  IGptTransport
} from './types.js';

export interface GptTransportConfig {
  baseUrl?: string;
  defaultTimeoutMs?: number;
  client?: AcpLabClient;
}

export class GptTransport implements IGptTransport {
  private readonly client: AcpLabClient;
  private readonly defaultTimeoutMs: number;

  constructor(config: GptTransportConfig = {}) {
    this.client = config.client || new AcpLabClient({
      baseUrl: config.baseUrl,
      timeoutMs: config.defaultTimeoutMs
    });
    this.defaultTimeoutMs = config.defaultTimeoutMs || 120000;
  }

  createSession(): string {
    return `gpt-session-${randomUUID()}`;
  }

  async health(timeoutMs = 5000): Promise<GptHealthResult> {
    try {
      const h = await this.client.health(timeoutMs);
      if (h.status === 'ok') {
        return {
          status: 'ok',
          initialized: h.initialized ?? true,
          isProcessing: h.isProcessing ?? false,
          details: h.health as Record<string, unknown>
        };
      }
      return {
        status: 'error',
        initialized: false,
        error: `Remote health check returned status ${h.status}`
      };
    } catch (err: any) {
      if (err.message && (err.message.includes('LOGIN_REQUIRED') || err.message.includes('not authenticated'))) {
        return {
          status: 'human_required',
          initialized: false,
          humanRequiredReason: 'ChatGPT session requires manual initial login in the browser'
        };
      }
      return {
        status: 'error',
        initialized: false,
        error: err.message || 'Health check failed'
      };
    }
  }

  async sendPrompt(prompt: string, options: GptPromptOptions = {}): Promise<GptPromptResponse> {
    const startTime = Date.now();
    const requestId = options.request_id || `gpt-req-${randomUUID()}`;
    const timeoutMs = options.timeout_ms || this.defaultTimeoutMs;

    try {
      const response = await this.client.prompt({
        request_id: requestId,
        session_id: options.session_id,
        prompt,
        timeout_ms: timeoutMs,
        options: options.options
      });

      let status: GptTransportStatus = 'COMPLETED';
      if ((response.status as string) !== 'completed') {
        status = 'FAILED';
      }

      return {
        request_id: response.request_id || requestId,
        session_id: response.session_id || options.session_id || 'default-session',
        status,
        text: response.text || response.response || '',
        duration_ms: response.duration_ms || (Date.now() - startTime),
        metadata: response.metadata,
        error: response.error ? {
          code: response.error.code || 'REMOTE_ERROR',
          message: response.error.message || 'Unknown error'
        } : undefined
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      let status: GptTransportStatus = 'FAILED';

      if (err.code === 'TIMEOUT') {
        status = 'TIMEOUT';
      } else if (err.code === 'HUMAN_REQUIRED' || (err.message && err.message.includes('LOGIN_REQUIRED'))) {
        status = 'HUMAN_REQUIRED';
      } else if (err.code === 'NETWORK_ERROR') {
        status = 'FAILED';
      }

      return {
        request_id: requestId,
        session_id: options.session_id || 'default-session',
        status,
        text: '',
        duration_ms: durationMs,
        error: {
          code: err.code || 'TRANSPORT_ERROR',
          message: err.message || 'Error communicating with GPT backend',
          details: err.details
        }
      };
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
    try {
      const h = await this.health(5000);
      return h.status === 'ok';
    } catch {
      return false;
    }
  }
}
