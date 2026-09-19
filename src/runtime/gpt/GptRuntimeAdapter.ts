import { randomUUID } from 'node:crypto';
import { IGptTransport, GptTransport } from '../../gpt/index.js';
import { WorkspaceCommandExecutor } from '../execution/WorkspaceCommandExecutor.js';
import { IAgentRuntime } from '../IAgentRuntime.js';
import {
  AgentRuntimeCapabilities,
  ExecutionEvent,
  ExecutionPlan,
  ExecutionResult,
  RuntimeHealth
} from '../types.js';

interface RuntimeCommandResponse {
  action: 'shell' | 'complete' | 'fail';
  command?: string;
  message?: string;
}

function parseRuntimeCommand(text: string): RuntimeCommandResponse {
  const fenced = text.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/i);
  const candidate = (fenced?.[1] || text).trim();
  const parsed = JSON.parse(candidate);

  if (!parsed || typeof parsed !== 'object' || !['shell', 'complete', 'fail'].includes(parsed.action)) {
    throw new Error('GPT runtime response contains an unsupported action.');
  }

  if (parsed.action === 'shell' && (!parsed.command || typeof parsed.command !== 'string')) {
    throw new Error('GPT runtime shell action requires a command string.');
  }

  return parsed as RuntimeCommandResponse;
}

export interface GptRuntimeAdapterConfig {
  gptTransport?: IGptTransport;
  commandExecutor?: WorkspaceCommandExecutor;
  defaultTimeoutMs?: number;
}

export class GptRuntimeAdapter implements IAgentRuntime {
  readonly id = 'gpt-runtime';
  readonly provider = 'openai-chatgpt';
  readonly version = 'v1';

  readonly capabilities: AgentRuntimeCapabilities = {
    supported: [
      'filesystem.read',
      'filesystem.write',
      'shell.execute',
      'git.read',
      'git.write',
      'test.execute',
      'headless'
    ],
    supportsStreaming: false,
    requiresHumanApproval: false,
    isHeadless: true
  };

  private readonly gpt: IGptTransport;
  private readonly executor: WorkspaceCommandExecutor;
  private readonly defaultTimeoutMs: number;

  constructor(config: GptRuntimeAdapterConfig = {}) {
    this.gpt = config.gptTransport || new GptTransport();
    this.executor = config.commandExecutor || new WorkspaceCommandExecutor();
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 300000;
  }

  async checkHealth(): Promise<RuntimeHealth> {
    const started = Date.now();
    try {
      const health = await this.gpt.health(10000);
      return {
        healthy: health.status === 'ok',
        latencyMs: Date.now() - started,
        availableCapacity: health.status === 'ok' && !health.isProcessing ? 1 : 0,
        message: health.error || health.humanRequiredReason
      };
    } catch (error: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - started,
        availableCapacity: 0,
        message: error?.message || 'GPT health check failed.'
      };
    }
  }

  async execute(
    plan: ExecutionPlan,
    onEvent?: (event: ExecutionEvent) => void,
    signal?: AbortSignal
  ): Promise<ExecutionResult> {
    const started = Date.now();
    const runId = `run-${randomUUID()}`;
    const prompt = [
      'You are the execution planner for PUB ACP.',
      'Return exactly one JSON object and no other text.',
      'Allowed actions:',
      '{"action":"shell","command":"<single command to execute in the authorized workspace>"}',
      '{"action":"complete","message":"<task is complete>"}',
      '{"action":"fail","message":"<task cannot continue>"}',
      'The ACP runtime executes shell actions with the authorized workspace as the process cwd.',
      'Use workspace-relative paths only.',
      'NEVER put an absolute filesystem path in the shell command.',
      'NEVER use Windows drive paths, UNC paths, POSIX absolute paths, or parent traversal (../ or ..\\).',
      'NEVER use cd, chdir, pushd, Set-Location, git -C, --work-tree, or equivalent directory escape mechanisms.',
      'For repository inspection and tests, use commands that operate on the current workspace cwd, such as git status, git diff, Get-ChildItem, npm test, npm run build, and relative file paths.',
      'Do not request human interaction.',
      '',
      `Authorized workspace: ${plan.request.workspacePath}`,
      `Project: ${plan.request.projectId}`,
      `Task: ${plan.request.taskId}`,
      '',
      plan.request.prompt
    ].join('\n');

    onEvent?.({
      runId,
      type: 'STATUS_CHANGE',
      payload: { status: 'RUNNING', runtimeId: this.id },
      timestamp: new Date().toISOString()
    });

    if (signal?.aborted) {
      return {
        runId,
        status: 'ABORTED',
        output: 'Execution aborted before GPT planning.',
        metrics: { durationMs: Date.now() - started }
      };
    }

    try {
      const response = await this.gpt.sendPrompt(prompt, {
        request_id: plan.planId,
        timeout_ms: plan.request.timeoutMs || this.defaultTimeoutMs
      });

      if (response.status !== 'COMPLETED') {
        return {
          runId,
          status: response.status === 'TIMEOUT' ? 'FAILED' : 'FAILED',
          output: response.text || '',
          diagnostics: [response.error?.message || 'GPT runtime planning failed.'],
          metrics: { durationMs: Date.now() - started }
        };
      }

      const action = parseRuntimeCommand(response.text);

      if (action.action === 'complete') {
        return {
          runId,
          status: 'COMPLETED',
          output: `[[ACP_COMPLETE]] ${action.message || 'GPT marked execution complete.'}`,
          metrics: { durationMs: Date.now() - started, turnsCount: 1 }
        };
      }

      if (action.action === 'fail') {
        return {
          runId,
          status: 'FAILED',
          output: action.message || 'GPT marked execution failed.',
          metrics: { durationMs: Date.now() - started, turnsCount: 1 }
        };
      }

      onEvent?.({
        runId,
        type: 'TOOL_CALL',
        payload: { tool: 'shell', command: action.command },
        timestamp: new Date().toISOString()
      });

      const result = await this.executor.execute({
        workspacePath: plan.request.workspacePath,
        command: action.command!,
        timeoutMs: plan.request.timeoutMs || this.defaultTimeoutMs,
        runId,
        onOutput: chunk => onEvent?.({
          runId,
          type: 'CHUNK',
          payload: { output: chunk },
          timestamp: new Date().toISOString()
        })
      });

      const status = result.status === 'COMPLETED' ? 'COMPLETED' :
        result.status === 'TIMEOUT' ? 'FAILED' : 'FAILED';

      onEvent?.({
        runId,
        type: 'STATUS_CHANGE',
        payload: { status, exitCode: result.exitCode },
        timestamp: new Date().toISOString()
      });

      return {
        runId,
        status,
        output: result.output,
        diagnostics: result.status === 'FAILED'
          ? [`Command exited with code ${result.exitCode}`]
          : undefined,
        metrics: { durationMs: Date.now() - started, turnsCount: 1 }
      };
    } catch (error: any) {
      onEvent?.({
        runId,
        type: 'ERROR',
        payload: { message: error?.message || 'GPT runtime execution failed.' },
        timestamp: new Date().toISOString()
      });

      return {
        runId,
        status: 'FAILED',
        output: '',
        diagnostics: [error?.message || 'GPT runtime execution failed.'],
        metrics: { durationMs: Date.now() - started }
      };
    }
  }
}
