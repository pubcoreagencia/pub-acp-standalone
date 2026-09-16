import { randomUUID } from 'node:crypto';
import {
  AcpLabClientOptions,
  HealthResponse,
  PromptRequest,
  PromptResponse,
  AcpLabClientError
} from './types.js';

export class AcpLabClient {
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;

  constructor(options: AcpLabClientOptions = {}) {
    const rawUrl = options.baseUrl || process.env.ACP_LAB_URL || 'http://127.0.0.1:5125';
    this.baseUrl = rawUrl.replace(/\/+$/, '');
    this.defaultTimeoutMs = options.timeoutMs || 120000;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async health(timeoutMs = 10000): Promise<HealthResponse> {
    const url = `${this.baseUrl}/v1/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new AcpLabClientError(
          `Health check failed with HTTP ${response.status}: ${response.statusText}`,
          'HTTP_ERROR',
          response.status
        );
      }

      const json = await response.json() as HealthResponse;
      return json;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new AcpLabClientError(`Health check timed out after ${timeoutMs}ms`, 'TIMEOUT');
      }
      if (err instanceof AcpLabClientError) {
        throw err;
      }
      throw new AcpLabClientError(err.message || 'Health check network error', 'NETWORK_ERROR', undefined, err);
    } finally {
      clearTimeout(timer);
    }
  }

  async prompt(request: PromptRequest): Promise<PromptResponse> {
    const url = `${this.baseUrl}/v1/transport/prompt`;
    const effectiveTimeoutMs = request.timeout_ms || this.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

    const requestId = request.request_id || `req_${randomUUID()}`;
    const payload = {
      request_id: requestId,
      prompt: request.prompt,
      session_id: request.session_id,
      timeout_ms: request.timeout_ms,
      options: request.options
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Request-ID': requestId
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      let json: any;
      try {
        json = await response.json();
      } catch (parseErr: any) {
        throw new AcpLabClientError(
          `Invalid JSON received from ACP-LAB: ${parseErr.message}`,
          'INVALID_RESPONSE',
          response.status
        );
      }

      if (!response.ok) {
        const errCode = json?.error?.code || 'REMOTE_ERROR';
        const errMsg = json?.error?.message || `ACP-LAB responded with HTTP ${response.status}`;
        throw new AcpLabClientError(errMsg, errCode, response.status, json);
      }

      return json as PromptResponse;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new AcpLabClientError(`Prompt timed out after ${effectiveTimeoutMs}ms`, 'TIMEOUT');
      }
      if (err instanceof AcpLabClientError) {
        throw err;
      }
      throw new AcpLabClientError(err.message || 'Prompt request network error', 'NETWORK_ERROR', undefined, err);
    } finally {
      clearTimeout(timer);
    }
  }
}
