import { ValidationPolicy } from '../validation/types.js';

export interface ProjectDefinition {
  projectId: string;
  projectName: string;
  workspacePath: string;
  repository: string;
  defaultBranch: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
  validationPolicy?: ValidationPolicy;
}

export type ExecutorMode = 'gpt-direct' | 'gpt-antigravity';

export interface ExecutionContext {
  runId: string;
  taskId: string;
  projectId: string;
  projectName: string;
  workspacePath: string;
  repository: string;
  branch: string;

  commit?: string;
  trigger?: string;
  parentRunId?: string;
  actor?: string;
  validationPolicy?: ValidationPolicy;
  conversationId?: string;
  executorMode?: ExecutorMode;
}

export type SafetyBlockReason =
  | 'UNKNOWN_PROJECT'
  | 'PROJECT_DISABLED'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_INVALID'
  | 'NOT_A_GIT_REPOSITORY'
  | 'WORKSPACE_REPOSITORY_MISMATCH'
  | 'WORKSPACE_BRANCH_MISMATCH'
  | 'SECURITY_RULE_VIOLATION'
  | 'WORKSPACE_ALREADY_LOCKED';

export interface ResolutionResult {
  ok: boolean;
  context?: ExecutionContext;
  reason?: SafetyBlockReason;
  message?: string;
  details?: {
    expectedRepo?: string;
    actualRepo?: string;
    expectedBranch?: string;
    actualBranch?: string;
    workspacePath?: string;
    [key: string]: unknown;
  };
}

export interface SafetyGateResult {
  passed: boolean;
  context?: ExecutionContext;
  reason?: SafetyBlockReason;
  message?: string;
  details?: Record<string, unknown>;
}
