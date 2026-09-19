import { randomUUID } from 'node:crypto';
import { IAgentRuntime } from '../runtime/IAgentRuntime.js';
import { GptRuntimeAdapter } from '../runtime/gpt/GptRuntimeAdapter.js';
import { IGptTransport } from '../gpt/index.js';
import { IProjectValidator } from '../validation/types.js';
import {
  ClosedLoopConfig,
  ClosedLoopRunReport,
  ClosedLoopTurnSummary,
  ExecutionContext
} from './types.js';
import { IEventBus } from '../observability/EventBus.js';
import { AutonomyEvent } from '../observability/types.js';

export class ClosedLoopEngine {
  private readonly runtime: IAgentRuntime;
  private readonly validator?: IProjectValidator;
  private readonly config: ClosedLoopConfig;
  private readonly executedRequests = new Set<string>();

  constructor(
    gptTransport?: IGptTransport,
    runtime?: IAgentRuntime,
    config: ClosedLoopConfig = {}
  ) {
    this.runtime = runtime || new GptRuntimeAdapter({
      gptTransport,
      defaultTimeoutMs: config.defaultTimeoutMs
    });
    this.validator = config.validator;
    this.config = {
      defaultTimeoutMs: config.defaultTimeoutMs || 300000,
      cwd: config.cwd || config.executionContext?.workspacePath || process.cwd(),
      effort: config.effort || 'low',
      model: config.model,
      eventBus: config.eventBus,
      projectName: config.projectName || config.executionContext?.projectName,
      executionContext: config.executionContext,
      runtime: this.runtime,
      validator: this.validator
    };
  }

  getRuntime(): IAgentRuntime {
    return this.runtime;
  }

  private emitEvent(event: AutonomyEvent): void {
    if (this.config.eventBus) {
      try {
        this.config.eventBus.publish(event);
      } catch (err) {
        console.error('[ClosedLoopEngine] Failed to publish event:', err);
      }
    }
  }

  async runLoop(
    initialPromptOrInstructions: string,
    options: {
      loopId?: string;
      maxTurns?: number;
      gptSessionId?: string;
      turnPromptBuilder?: (previousRuntimeResponse: string, turn: number) => string;
      stopCondition?: (runtimeResponse: string, turn: number) => boolean;
      executionContext?: ExecutionContext;
      cwd?: string;
      conversationId?: string;
    } = {}
  ): Promise<ClosedLoopRunReport> {
    const execCtx = options.executionContext || this.config.executionContext;
    const loopId = options.loopId || execCtx?.runId || `loop-${randomUUID()}`;
    const maxTurns = options.maxTurns || 3;
    const startedAt = new Date().toISOString();
    const overallStartTime = Date.now();
    const effectiveCwd = options.cwd || execCtx?.workspacePath || this.config.cwd || process.cwd();
    const effectiveProject = execCtx?.projectName || this.config.projectName || 'ACP Standalone';

    this.emitEvent({
      id: `evt-${randomUUID()}`,
      runId: loopId,
      timestamp: startedAt,
      type: 'RUN_STARTED',
      summary: `ClosedLoop run ${loopId} initiated with maxTurns=${maxTurns} using runtime ${this.runtime.id}.`,
      details: {
        loopId,
        runtimeId: this.runtime.id,
        provider: this.runtime.provider,
        project: effectiveProject,
        projectId: execCtx?.projectId,
        taskId: execCtx?.taskId,
        workspacePath: effectiveCwd,
        repository: execCtx?.repository,
        branch: execCtx?.branch,
        commit: execCtx?.commit,
        maxTurns
      }
    });

    const turnSummaries: ClosedLoopTurnSummary[] = [];
    let previousRuntimeResponse = '';
    let overallStatus: ClosedLoopRunReport['status'] = 'RUNNING';
    let loopError: ClosedLoopRunReport['error'] | undefined;

    for (let turn = 1; turn <= maxTurns; turn++) {
      const turnStarted = Date.now();
      const turnStartedAt = new Date().toISOString();

      let prompt = initialPromptOrInstructions;
      if (turn > 1) {
        prompt = options.turnPromptBuilder
          ? options.turnPromptBuilder(previousRuntimeResponse, turn)
          : [
              `Continue task execution for turn ${turn}.`,
              'Previous runtime result:',
              '"""',
              previousRuntimeResponse,
              '"""',
              'Inspect the current workspace state and perform the next necessary action.',
              'If the task is complete, return the complete action.'
            ].join('\n');
      }

      const requestId = `${loopId}-t${turn}-runtime-${randomUUID().slice(0, 8)}`;
      if (this.executedRequests.has(requestId)) {
        throw new Error(`Idempotency conflict: runtime request_id ${requestId} already processed.`);
      }
      this.executedRequests.add(requestId);

      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId: loopId,
        timestamp: turnStartedAt,
        type: 'GPT_DECISION',
        turn,
        summary: `Turn ${turn}: preparing GPT runtime execution.`,
        details: {
          requestId,
          runtimeId: this.runtime.id,
          promptSnippet: prompt.slice(0, 300),
          prompt
        }
      });

      const runtimeStartedAt = new Date().toISOString();

      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId: loopId,
        timestamp: runtimeStartedAt,
        type: 'RUNTIME_STARTED',
        turn,
        summary: `Turn ${turn}: runtime ${this.runtime.id} started.`,
        details: { requestId, runtimeId: this.runtime.id, workspacePath: effectiveCwd }
      });

      const runtimeResult = await this.runtime.execute({
        planId: requestId,
        runtimeId: this.runtime.id,
        request: {
          taskId: execCtx?.taskId || loopId,
          projectId: execCtx?.projectId || 'unknown-project',
          workspacePath: effectiveCwd,
          prompt,
          requiredCapabilities: ['filesystem.read', 'filesystem.write', 'shell.execute'],
          timeoutMs: this.config.defaultTimeoutMs,
          metadata: { runId: loopId, turn, conversationId: options.conversationId }
        },
        createdAt: runtimeStartedAt
      }, event => {
        if (event.type === 'CHUNK') {
          this.emitEvent({
            id: `evt-${randomUUID()}`,
            runId: loopId,
            timestamp: event.timestamp,
            type: 'RUNTIME_OUTPUT',
            turn,
            summary: 'Runtime produced output.',
            details: event.payload
          });
        }
      });

      const runtimeCompletedAt = new Date().toISOString();
      const runtimeDurationMs = Date.now() - turnStarted;
      previousRuntimeResponse = runtimeResult.output;

      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId: loopId,
        timestamp: runtimeCompletedAt,
        type: 'RUNTIME_FINISHED',
        turn,
        summary: `Turn ${turn}: runtime finished with status ${runtimeResult.status}.`,
        details: {
          runtimeId: this.runtime.id,
          status: runtimeResult.status,
          output: runtimeResult.output,
          diagnostics: runtimeResult.diagnostics,
          durationMs: runtimeDurationMs
        }
      });

      if (runtimeResult.status !== 'COMPLETED') {
        overallStatus = runtimeResult.status === 'ABORTED' ? 'ABORTED' : 'FAILED';
        loopError = {
          code: 'RUNTIME_EXECUTION_FAILED',
          message: runtimeResult.diagnostics?.join('; ') || `Runtime failed on turn ${turn}.`,
          where: 'loop_engine'
        };

        turnSummaries.push({
          turn,
          runtime_request_id: requestId,
          prompt_sent_to_gpt: prompt,
          gpt_response: '',
          antigravity_instruction: '',
          antigravity_response: '',
          runtime_response: runtimeResult.output,
          timestamps: {
            gpt_started_at: turnStartedAt,
            gpt_completed_at: runtimeCompletedAt,
            antigravity_started_at: runtimeStartedAt,
            antigravity_completed_at: runtimeCompletedAt,
            runtime_started_at: runtimeStartedAt,
            runtime_completed_at: runtimeCompletedAt
          },
          durations: {
            gpt_duration_ms: 0,
            antigravity_duration_ms: 0,
            runtime_duration_ms: runtimeDurationMs,
            total_turn_duration_ms: runtimeDurationMs
          },
          status: overallStatus === 'ABORTED' ? 'FAILED' : 'FAILED',
          error: {
            code: 'RUNTIME_EXECUTION_FAILED',
            message: loopError.message
          }
        });
        break;
      }

      let validationSummary = '';
      let validationFailed = false;

      if (this.validator && execCtx?.validationPolicy) {
        this.emitEvent({
          id: `evt-${randomUUID()}`,
          runId: loopId,
          timestamp: new Date().toISOString(),
          type: 'VALIDATION_STARTED',
          turn,
          summary: `Turn ${turn}: validating workspace.`,
          details: {
            policy: execCtx.validationPolicy,
            workspacePath: effectiveCwd
          }
        });

        const validation = await this.validator.validate(
          effectiveCwd,
          execCtx.validationPolicy,
          { runId: loopId, turn }
        );

        validationSummary = `${validation.status}: ${validation.summary}`;
        validationFailed =
          execCtx.validationPolicy.mode === 'REQUIRED' &&
          (validation.status === 'FAIL' || validation.status === 'ERROR');

        this.emitEvent({
          id: `evt-${randomUUID()}`,
          runId: loopId,
          timestamp: new Date().toISOString(),
          type: 'VALIDATION_RESULT',
          turn,
          summary: validation.summary,
          details: {
            status: validation.status,
            exitCode: validation.exitCode,
            durationMs: validation.durationMs,
            details: validation.details
          }
        });

        if (validationFailed && turn < maxTurns) {
          this.emitEvent({
            id: `evt-${randomUUID()}`,
            runId: loopId,
            timestamp: new Date().toISOString(),
            type: 'CORRECTION',
            turn,
            summary: 'Validation failed. Returning diagnostics to GPT runtime for correction.',
            details: {
              validation: validationSummary
            }
          });
        }
      }

      turnSummaries.push({
        turn,
        runtime_request_id: requestId,
        prompt_sent_to_gpt: prompt,
        gpt_response: '',
        antigravity_instruction: '',
        antigravity_response: '',
        runtime_response: previousRuntimeResponse,
        timestamps: {
          gpt_started_at: turnStartedAt,
          gpt_completed_at: runtimeCompletedAt,
          antigravity_started_at: runtimeStartedAt,
          antigravity_completed_at: runtimeCompletedAt,
          runtime_started_at: runtimeStartedAt,
          runtime_completed_at: runtimeCompletedAt
        },
        durations: {
          gpt_duration_ms: 0,
          antigravity_duration_ms: 0,
          runtime_duration_ms: runtimeDurationMs,
          total_turn_duration_ms: runtimeDurationMs
        },
        status: validationFailed ? 'FAILED' : 'COMPLETED',
        error: validationFailed
          ? { code: 'VALIDATION_FAILED', message: validationSummary }
          : undefined
      });

      if (options.stopCondition?.(previousRuntimeResponse, turn)) break;

      if (validationFailed) {
        if (turn === maxTurns) {
          overallStatus = 'FAILED';
          loopError = {
            code: 'VALIDATION_FAILED',
            message: validationSummary,
            where: 'loop_engine'
          };
        }
        continue;
      }

      if (turn === maxTurns) {
        overallStatus = 'COMPLETED';
      }
    }

    if (overallStatus === 'RUNNING') {
      overallStatus = 'COMPLETED';
    }

    const completedAt = new Date().toISOString();

    if (overallStatus === 'COMPLETED') {
      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId: loopId,
        timestamp: completedAt,
        type: 'RUN_COMPLETED',
        summary: `ClosedLoop run ${loopId} completed successfully across ${turnSummaries.length} turns.`,
        details: {
          runtimeId: this.runtime.id,
          totalTurns: turnSummaries.length,
          totalDurationMs: Date.now() - overallStartTime
        }
      });
    } else {
      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId: loopId,
        timestamp: completedAt,
        type: 'RUN_FAILED',
        summary: `ClosedLoop run ${loopId} ended with status ${overallStatus}.`,
        details: { error: loopError, runtimeId: this.runtime.id }
      });
    }

    return {
      loop_id: loopId,
      gpt_session_id: '',
      antigravity_session_id: '',
      antigravity_conversation_id: null,
      total_turns: turnSummaries.length,
      status: overallStatus,
      turns: turnSummaries,
      total_duration_ms: Date.now() - overallStartTime,
      started_at: startedAt,
      completed_at: completedAt,
      manual_copy_paste_operations: 0,
      error: loopError
    };
  }
}
