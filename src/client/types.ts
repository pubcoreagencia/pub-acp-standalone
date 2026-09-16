export interface AcpLabClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export interface HealthResponse {
  status: string;
  initialized: boolean;
  isProcessing: boolean;
  sessionsCount: number;
  health: {
    transport_healthy: boolean;
    browser_healthy: boolean;
    cdp_connected: boolean;
    backend_type?: string;
    [key: string]: unknown;
  } | string;
  [key: string]: unknown;
}

export interface PromptRequest {
  prompt: string;
  session_id?: string;
  request_id?: string;
  timeout_ms?: number;
  options?: Record<string, unknown>;
}

export interface PromptResponse {
  status: 'completed' | 'error';
  request_id: string;
  session_id: string;
  response?: string;
  duration_ms?: number;
  metadata?: {
    model?: string;
    stop_reason?: string;
    attempt?: number;
    url?: string;
    [key: string]: unknown;
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class AcpLabClientError extends Error {
  public readonly code: string;
  public readonly status?: number;
  public readonly details?: unknown;

  constructor(message: string, code = 'CLIENT_ERROR', status?: number, details?: unknown) {
    super(message);
    this.name = 'AcpLabClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
