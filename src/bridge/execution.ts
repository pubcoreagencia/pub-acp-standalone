import { GptTransport, IGptTransport, GptPromptResponse } from '../gpt/index.js';
import { AntigravityBridge, IAntigravityTransport, AntigravityTransport } from '../antigravity/index.js';

export type ExecutionProviderKind = 'antigravity' | 'gpt';

export interface ExecutionPromptOptions {
  request_id?: string;
  session_id?: string;
  timeout_ms?: number;
  cwd?: string;
  effort?: 'low' | 'medium' | 'high';
  model?: string;
  options?: Record<string, unknown>;
}

export interface ExecutionResult {
  request_id: string;
  session_id: string;
  status: 'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'HUMAN_REQUIRED';
  response: string;
  duration_ms: number;
  error?: { code: string; message: string; details?: unknown };
  metadata?: Record<string, unknown>;
}

export interface IExecutionTransport {
  health(timeoutMs?: number): Promise<{ status: 'ok' | 'error' | 'human_required'; error?: string }>;
  executeTurn(sessionId: string, prompt: string, options?: ExecutionPromptOptions): Promise<ExecutionResult>;
}

export class AntigravityExecutionTransport implements IExecutionTransport {
  private readonly bridge: AntigravityBridge;

  constructor(transport?: IAntigravityTransport) {
    this.bridge = new AntigravityBridge(transport || new AntigravityTransport());
  }

  async health(): Promise<{ status: 'ok' | 'error'; error?: string }> {
    const h = await this.bridge.getTransport().health();
    return { status: h.status, error: h.error };
  }

  async executeTurn(sessionId: string, prompt: string, options: ExecutionPromptOptions = {}): Promise<ExecutionResult> {
    const r = await this.bridge.executeTurn(sessionId, prompt, options as any);
    return {
      request_id: r.request_id,
      session_id: r.session_id,
      status: r.status,
      response: r.response,
      duration_ms: r.duration_ms,
      error: r.error,
      metadata: r.metadata
    };
  }

  getBridge(): AntigravityBridge {
    return this.bridge;
  }
}

export class GptExecutionTransport implements IExecutionTransport {
  private readonly transport: IGptTransport;

  constructor(transport?: IGptTransport) {
    this.transport = transport || new GptTransport();
  }

  async health(timeoutMs = 5000): Promise<{ status: 'ok' | 'error' | 'human_required'; error?: string }> {
    return this.transport.health(timeoutMs);
  }

  async executeTurn(sessionId: string, prompt: string, options: ExecutionPromptOptions = {}): Promise<ExecutionResult> {
    const r: GptPromptResponse = await this.transport.continueSession(sessionId, prompt, {
      request_id: options.request_id,
      timeout_ms: options.timeout_ms,
      options: options.options
    });
    return {
      request_id: r.request_id,
      session_id: r.session_id,
      status: r.status === 'HUMAN_REQUIRED' ? 'HUMAN_REQUIRED' :
        r.status === 'TIMEOUT' ? 'TIMEOUT' :
        r.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
      response: r.text,
      duration_ms: r.duration_ms,
      error: r.error,
      metadata: r.metadata
    };
  }

  getTransport(): IGptTransport {
    return this.transport;
  }
}
