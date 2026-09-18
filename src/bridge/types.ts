import { GptTransportStatus } from '../gpt/types.js';
import { AntigravityExecutionStatus } from '../antigravity/types.js';
import { ActionPolicy } from '../actions/types.js';

export type LoopStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'HUMAN_REQUIRED';

export interface LoopEnvelope {
  loop_id: string;
  turn: number;
  prompt: string;
  source: 'gpt' | 'antigravity';
  target: 'antigravity' | 'gpt';
  created_at: string;
  timeout_ms: number;
  request_id?: string;
  session_id?: string;
}

export interface LoopResultEnvelope {
  loop_id: string;
  turn: number;
  status: 'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'UNKNOWN' | 'HUMAN_REQUIRED';
  response: string;
  source: 'antigravity' | 'gpt';
  target: 'gpt' | 'antigravity';
  started_at: string;
  completed_at: string;
  duration_ms: number;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  metadata?: Record<string, unknown>;
}

export interface ClosedLoopTurnSummary {
  turn: number;
  executor_provider: 'antigravity' | 'gpt';
  gpt_request_id?: string;
  antigravity_request_id?: string;
  prompt_sent_to_gpt: string;
  gpt_response: string;
  antigravity_instruction: string;
  antigravity_response: string;
  timestamps: {
    gpt_started_at: string;
    gpt_completed_at: string;
    antigravity_started_at: string;
    antigravity_completed_at: string;
  };
  durations: {
    gpt_duration_ms: number;
    antigravity_duration_ms: number;
    total_turn_duration_ms: number;
  };
  status: 'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'HUMAN_REQUIRED';
  error?: {
    code: string;
    message: string;
  };
}

export interface ClosedLoopRunReport {
  loop_id: string;
  executor_provider: 'antigravity' | 'gpt';
  gpt_session_id: string;
  antigravity_session_id: string;
  antigravity_conversation_id: string | null;
  total_turns: number;
  status: LoopStatus;
  turns: ClosedLoopTurnSummary[];
  total_duration_ms: number;
  started_at: string;
  completed_at: string;
  manual_copy_paste_operations: 0;
  error?: {
    code: string;
    message: string;
    where: 'gpt' | 'antigravity' | 'loop_engine';
  };
}

import { IEventBus } from '../observability/EventBus.js';
export { ExecutionContext } from '../multiproject/types.js';
import { ExecutionContext } from '../multiproject/types.js';

export interface ClosedLoopConfig {
  executorProvider?: 'antigravity' | 'gpt';
  executorTimeoutMs?: number;
  defaultTimeoutMs?: number;
  cwd?: string;
  effort?: 'low' | 'medium' | 'high';
  model?: string;
  eventBus?: IEventBus;
  projectName?: string;
  executionContext?: ExecutionContext;
  actionPolicy?: ActionPolicy;
}
