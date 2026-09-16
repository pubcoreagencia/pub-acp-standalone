export type GptTransportStatus =
  | 'IDLE'
  | 'DISPATCHING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'TIMEOUT'
  | 'UNKNOWN'
  | 'HUMAN_REQUIRED';

export interface GptHealthResult {
  status: 'ok' | 'error' | 'human_required';
  initialized: boolean;
  isProcessing?: boolean;
  details?: Record<string, unknown>;
  error?: string;
  humanRequiredReason?: string;
}

export interface GptPromptOptions {
  request_id?: string;
  session_id?: string;
  timeout_ms?: number;
  options?: Record<string, unknown>;
}

export interface GptPromptResponse {
  request_id: string;
  session_id: string;
  status: GptTransportStatus;
  text: string;
  duration_ms: number;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  metadata?: Record<string, unknown>;
}

export interface IGptTransport {
  health(timeoutMs?: number): Promise<GptHealthResult>;
  sendPrompt(prompt: string, options?: GptPromptOptions): Promise<GptPromptResponse>;
  createSession(): string;
  continueSession(sessionId: string, prompt: string, options?: Omit<GptPromptOptions, 'session_id'>): Promise<GptPromptResponse>;
  recover?(): Promise<boolean>;
}
