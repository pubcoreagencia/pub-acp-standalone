import { ExecutionCapability } from '../actions/types.js';

export type ToolCategory = 'workspace' | 'git' | 'npm' | 'node' | 'process';

export interface ToolRequest {
  tool: string;
  operation: string;
  args: Record<string, unknown>;
  rawDirective?: string;
  legacyExec?: boolean;
}

export interface ToolResult {
  tool: string;
  operation: string;
  capability: ExecutionCapability;
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  output?: unknown;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  blockedReason?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionTelemetry {
  runId?: string;
  turn?: number;
  provider: string;
  tool: string;
  operation: string;
  capability: ExecutionCapability;
  args: Record<string, unknown>;
  workspace: string;
  policyDecision: 'ALLOW' | 'BLOCK';
  executionProvider: string;
  result: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  exitCode?: number;
  durationMs: number;
  blockedReason?: string;
  legacyExec?: boolean;
}

export interface IToolAdapter {
  readonly name: ToolCategory;
  readonly supportedOperations: string[];

  getRequiredCapability(operation: string, args: Record<string, unknown>): ExecutionCapability;

  execute(
    workspaceRoot: string,
    operation: string,
    args: Record<string, unknown>,
    options?: Record<string, unknown>
  ): ToolResult;
}

export interface ToolBatchResult {
  results: ToolResult[];
  telemetry: ToolExecutionTelemetry[];
  summary: string;
}
