import {
  ExecutionEvent,
  ExecutionPlan,
  ExecutionResult,
  RuntimeHealth,
  AgentRuntimeCapabilities
} from './types.js';

export interface IAgentRuntime {
  readonly id: string;
  readonly provider: string;
  readonly version: string;
  readonly capabilities: AgentRuntimeCapabilities;

  checkHealth(): Promise<RuntimeHealth>;

  execute(
    plan: ExecutionPlan,
    onEvent?: (event: ExecutionEvent) => void,
    signal?: AbortSignal
  ): Promise<ExecutionResult>;
}