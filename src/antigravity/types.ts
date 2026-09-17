export type AntigravityExecutionStatus =
  | 'IDLE'
  | 'DISPATCHING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'TIMEOUT'
  | 'UNKNOWN'
  | 'HUMAN_REQUIRED';

export interface AntigravityUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

export interface AntigravityRawCliResponse {
  conversation_id?: string;
  status?: string;
  response?: string;
  duration_seconds?: number;
  num_turns?: number;
  usage?: AntigravityUsage;
  error?: string;
}

export interface AntigravityExecutionResult {
  request_id: string;
  session_id: string;
  conversation_id: string | null;
  status: AntigravityExecutionStatus;
  response: string;
  duration_ms: number;
  num_turns?: number;
  usage?: AntigravityUsage;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  metadata?: Record<string, unknown>;
}

export interface AntigravityPromptOptions {
  request_id?: string;
  session_id?: string;
  conversation_id?: string;
  cwd?: string;
  timeout_ms?: number;
  dangerouslySkipPermissions?: boolean;
  effort?: 'low' | 'medium' | 'high';
  model?: string;
}

export interface AgConversationSummary {
  conversationId: string;
  title: string;
  preview: string;
  status: string;
  lastModifiedTime: string;
  stepCount: number;
}

export interface IAntigravitySessionStore {
  listConversationsForWorkspace(
    workspacePath: string
  ): Promise<AgConversationSummary[]>;

  getConversation(
    conversationId: string
  ): Promise<AgConversationSummary | null>;

  belongsToWorkspace(
    conversationId: string,
    workspacePath: string
  ): Promise<boolean>;
}
