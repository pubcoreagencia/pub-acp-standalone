export type AgentCapability =
  | 'filesystem.read'
  | 'filesystem.write'
  | 'shell.execute'
  | 'git.read'
  | 'git.write'
  | 'test.execute'
  | 'network.access'
  | 'interactive'
  | 'streaming'
  | 'headless'
  | 'approval'
  | 'sandbox';

export interface AgentRuntimeCapabilities {
  supported: AgentCapability[];
  maxConcurrency?: number;
  supportsStreaming: boolean;
  requiresHumanApproval: boolean;
  isHeadless: boolean;
}

export interface RuntimeHealth {
  healthy: boolean;
  latencyMs?: number;
  availableCapacity: number;
  message?: string;
}

export type RunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABORTED';

export interface ExecutionRequest {
  taskId: string;
  projectId: string;
  workspacePath: string;
  prompt: string;
  requiredCapabilities: AgentCapability[];
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ExecutionPlan {
  planId: string;
  runtimeId: string;
  request: ExecutionRequest;
  allocatedAccount?: string;
  createdAt: string;
}

export interface ExecutionEvent {
  runId: string;
  type: 'CHUNK' | 'TOOL_CALL' | 'STATUS_CHANGE' | 'ERROR';
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface ExecutionResult {
  runId: string;
  status: RunStatus;
  output: string;
  diagnostics?: string[];
  metrics?: {
    durationMs: number;
    tokensPrompt?: number;
    tokensCompletion?: number;
    turnsCount?: number;
  };
}

export interface RuntimeSelectionPolicy {
  allowedRuntimeIds?: string[];
  requireHeadless?: boolean;
  requireStreaming?: boolean;
  requireHumanApproval?: boolean;
}