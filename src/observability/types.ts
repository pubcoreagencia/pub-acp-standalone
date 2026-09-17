export type AutonomyEventType =
  | 'RUN_CREATED'
  | 'RUN_STARTED'
  | 'PROJECT_RESOLUTION_STARTED'
  | 'PROJECT_RESOLVED'
  | 'WORKSPACE_VALIDATION_STARTED'
  | 'WORKSPACE_VALIDATED'
  | 'SAFETY_GATE_STARTED'
  | 'SAFETY_GATE_PASSED'
  | 'SAFETY_GATE_BLOCKED'
  | 'WORKSPACE_LOCK_ACQUIRED'
  | 'WORKSPACE_LOCK_BLOCKED'
  | 'WORKSPACE_LOCK_RELEASED'
  | 'GPT_DECISION'
  | 'AG_STARTED'
  | 'AG_OUTPUT'
  | 'AG_FINISHED'
  | 'GPT_REVIEW'
  | 'VALIDATION_STARTED'
  | 'VALIDATION_RESULT'
  | 'CORRECTION'
  | 'DEPLOY_STARTED'
  | 'DEPLOY_RESULT'
  | 'RUN_COMPLETED'
  | 'RUN_FAILED';

export type RunState =
  | 'IDLE'
  | 'STARTING'
  | 'GPT_THINKING'
  | 'AG_RUNNING'
  | 'VALIDATING'
  | 'WAITING'
  | 'DEPLOYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'STOPPED';

export type ValidationStatus =
  | 'PASS'
  | 'FAIL'
  | 'RUNNING'
  | 'SKIPPED'
  | 'NOT_AVAILABLE';

export type DeployStatus =
  | 'PASS'
  | 'FAIL'
  | 'RUNNING'
  | 'SKIPPED'
  | 'NOT_AVAILABLE';

export interface AutonomyEvent {
  id: string;
  runId: string;
  timestamp: string;
  type: AutonomyEventType;
  turn?: number;
  summary: string;
  details?: Record<string, unknown> | null;
}

export interface ValidationSummary {
  build: ValidationStatus;
  unit: ValidationStatus;
  integration: ValidationStatus;
  e2e: ValidationStatus;
  smoke: ValidationStatus;
  lastRunAt?: string;
  details?: string;
}

export interface DeploySummary {
  status: DeployStatus;
  publicUrl: string | 'NOT_AVAILABLE';
  httpStatus: number | 'NOT_AVAILABLE';
  lastDeploy: string | 'NOT_AVAILABLE';
  version: string | 'NOT_AVAILABLE';
}

export interface WorkspaceSummary {
  path: string;
  expectedRepo?: string | 'NOT_AVAILABLE';
  actualRepo?: string | 'NOT_AVAILABLE';
  branch?: string | 'NOT_AVAILABLE';
  changedFiles: string[];
  fileCount: number | 'NOT_AVAILABLE';
  gitStatus: string | 'NOT_AVAILABLE';
  lastCommit: string | 'NOT_AVAILABLE';
}

export interface GptDecisionView {
  lastDecision: string | 'NOT_AVAILABLE';
  contextSummary: string | 'NOT_AVAILABLE';
  analyzedResult: string | 'NOT_AVAILABLE';
  nextAction: string | 'NOT_AVAILABLE';
  timestamp: string | 'NOT_AVAILABLE';
}

export interface AntigravityExecutionView {
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'NOT_AVAILABLE';
  currentExecution: string | 'NOT_AVAILABLE';
  commandOrAction: string | 'NOT_AVAILABLE';
  durationMs: number | 'NOT_AVAILABLE';
  stdoutSummary: string | 'NOT_AVAILABLE';
  stderrSummary: string | 'NOT_AVAILABLE';
  changedFiles: string[];
  result: string | 'NOT_AVAILABLE';
}

export interface RunModel {
  runId: string;
  projectId?: string;
  projectName?: string;
  taskId?: string;
  project: string;
  status: RunState;
  isDemo?: boolean;
  startedAt: string;
  finishedAt?: string | null;
  durationMs: number;
  gptTurns: number;
  agExecutions: number;
  corrections: number;
  tests: ValidationSummary;
  deployStatus: DeploySummary;
  workspace: WorkspaceSummary;
  gptView: GptDecisionView;
  agView: AntigravityExecutionView;
  events: AutonomyEvent[];
}
