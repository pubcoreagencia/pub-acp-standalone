import { randomUUID } from 'node:crypto';
import { IGptTransport, GptTransport } from '../gpt/index.js';
import { IAntigravityTransport, AntigravityTransport, AntigravityBridge } from '../antigravity/index.js';
import {
  AntigravityExecutionTransport,
  ExecutionProviderKind,
  GptExecutionTransport,
  IExecutionTransport
} from './execution.js';
import { ClosedLoopConfig, ClosedLoopRunReport, ClosedLoopTurnSummary } from './types.js';
import { ExecutionContext } from '../multiproject/types.js';
import { IEventBus } from '../observability/EventBus.js';
import { AutonomyEvent } from '../observability/types.js';

export class ClosedLoopEngine {
  private readonly gptTransport: IGptTransport;
  private readonly agBridge: AntigravityBridge;
  private readonly executor: IExecutionTransport;
  private readonly executorProvider: ExecutionProviderKind;
  private readonly config: ClosedLoopConfig;
  private readonly executedRequests = new Set<string>();

  constructor(
    gptTransport?: IGptTransport,
    agTransportOrBridge?: IAntigravityTransport | AntigravityBridge,
    config: ClosedLoopConfig = {},
    executorTransport?: IExecutionTransport
  ) {
    this.gptTransport = gptTransport || new GptTransport();
    if (agTransportOrBridge instanceof AntigravityBridge) {
      this.agBridge = agTransportOrBridge;
    } else {
      this.agBridge = new AntigravityBridge(agTransportOrBridge || new AntigravityTransport());
    }

    this.executorProvider = config.executorProvider || 'antigravity';
    this.executor = executorTransport ||
      (this.executorProvider === 'gpt'
        ? new GptExecutionTransport()
        : new AntigravityExecutionTransport(this.agBridge.getTransport()));

    this.config = {
      defaultTimeoutMs: config.defaultTimeoutMs || 300000,
      executorTimeoutMs: config.executorTimeoutMs || config.defaultTimeoutMs || 300000,
      cwd: config.cwd || process.cwd(),
      effort: config.effort || 'low',
      model: config.model,
      executorProvider: this.executorProvider,
      eventBus: config.eventBus,
      projectName: config.projectName,
      executionContext: config.executionContext
    };
  }

  getGptTransport(): IGptTransport { return this.gptTransport; }
  getAntigravityBridge(): AntigravityBridge { return this.agBridge; }
  getExecutor(): IExecutionTransport { return this.executor; }
  getExecutorProvider(): ExecutionProviderKind { return this.executorProvider; }

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
      executorSessionId?: string;
      agSessionId?: string;
      turnPromptBuilder?: (prevExecutorResponse: string, turn: number) => string;
      stopCondition?: (executorResponse: string, turn: number) => boolean;
      executionContext?: ExecutionContext;
      cwd?: string;
      conversationId?: string;
    } = {}
  ): Promise<ClosedLoopRunReport> {
    const execCtx = options.executionContext || this.config.executionContext;
    const loopId = options.loopId || execCtx?.runId || `loop-${randomUUID()}`;
    const maxTurns = options.maxTurns || 3;
    const gptSessionId = options.gptSessionId || `gpt-loop-${randomUUID()}`;
    const executorSessionId = options.executorSessionId || options.agSessionId ||
      `${this.executorProvider}-executor-${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const overallStartTime = Date.now();
    const effectiveCwd = options.cwd || execCtx?.workspacePath || this.config.cwd;
    const effectiveProject = execCtx?.projectName || this.config.projectName || 'ACP Standalone';

    this.emitEvent({
      id: `evt-${randomUUID()}`,
      runId: loopId,
      timestamp: startedAt,
      type: 'RUN_STARTED',
      summary: `ClosedLoop run ${loopId} initiated with maxTurns=${maxTurns} using ${this.executorProvider} executor.`,
      details: {
        loopId,
        project: effectiveProject,
        projectId: execCtx?.projectId,
        projectName: execCtx?.projectName,
        taskId: execCtx?.taskId,
        workspacePath: effectiveCwd,
        repository: execCtx?.repository,
        branch: execCtx?.branch,
        commit: execCtx?.commit,
        maxTurns,
        cwd: effectiveCwd,
        executorProvider: this.executorProvider
      }
    });

    const turnSummaries: ClosedLoopTurnSummary[] = [];
    let currentExecutorResponse = '';
    let overallStatus: ClosedLoopRunReport['status'] = 'RUNNING';
    let loopError: ClosedLoopRunReport['error'] | undefined;
    let effectiveGptSessionId = gptSessionId;

    for (let turn = 1; turn <= maxTurns; turn++) {
      const gptStartedAt = new Date().toISOString();
      const gptStartTime = Date.now();
      const gptPrompt = turn === 1
        ? initialPromptOrInstructions
        : options.turnPromptBuilder
          ? options.turnPromptBuilder(currentExecutorResponse, turn)
          : `O executor (${this.executorProvider}) executou o turno anterior com o seguinte resultado:\n"""\n${currentExecutorResponse}\n"""\nAnalise o resultado real acima e gere a instrução técnica exata para o próximo passo (Turno ${turn}). Se estiver completamente pronto, testado e validado, encerre com [[STATUS: READY]].`;

      const gptRequestId = `${loopId}-t${turn}-gpt-${randomUUID().slice(0, 8)}`;
      if (this.executedRequests.has(gptRequestId)) throw new Error(`Idempotency conflict: GPT request_id ${gptRequestId} already processed.`);
      this.executedRequests.add(gptRequestId);

      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId: loopId,
        timestamp: gptStartedAt,
        type: 'GPT_DECISION',
        turn,
        summary: `Turn ${turn}: Dispatching prompt to GPT planner.`,
        details: { requestId: gptRequestId, turn, promptSnippet: gptPrompt.slice(0, 300), prompt: gptPrompt }
      });

      const gptResult = await this.gptTransport.continueSession(effectiveGptSessionId, gptPrompt, {
        request_id: gptRequestId,
        timeout_ms: this.config.defaultTimeoutMs
      });
      if (gptResult.session_id) effectiveGptSessionId = gptResult.session_id;

      const gptCompletedAt = new Date().toISOString();
      const gptDurationMs = Date.now() - gptStartTime;

      if (gptResult.status !== 'COMPLETED') {
        overallStatus = gptResult.status === 'TIMEOUT' ? 'TIMEOUT' : gptResult.status === 'HUMAN_REQUIRED' ? 'HUMAN_REQUIRED' : 'FAILED';
        loopError = {
          code: gptResult.error?.code || 'GPT_ERROR',
          message: gptResult.error?.message || `GPT failed on turn ${turn}`,
          where: 'gpt'
        };
        this.emitEvent({
          id: `evt-${randomUUID()}`,
          runId: loopId,
          timestamp: gptCompletedAt,
          type: 'RUN_FAILED',
          turn,
          summary: `Turn ${turn}: GPT failed (${gptResult.status}) - ${loopError.message}`,
          details: { error: loopError }
        });
        turnSummaries.push({
          turn,
          executor_provider: this.executorProvider,
          gpt_request_id: gptRequestId,
          prompt_sent_to_gpt: gptPrompt,
          gpt_response: gptResult.text,
          antigravity_instruction: '',
          antigravity_response: '',
          timestamps: {
            gpt_started_at: gptStartedAt,
            gpt_completed_at: gptCompletedAt,
            antigravity_started_at: gptCompletedAt,
            antigravity_completed_at: gptCompletedAt
          },
          durations: { gpt_duration_ms: gptDurationMs, antigravity_duration_ms: 0, total_turn_duration_ms: gptDurationMs },
          status: overallStatus as any,
          error: gptResult.error
        });
        break;
      }

      const instructionForExecutor = gptResult.text.trim();
      const executorStartedAt = new Date().toISOString();
      const executorStartTime = Date.now();
      const executorRequestId = `${loopId}-t${turn}-${this.executorProvider}-${randomUUID().slice(0, 8)}`;
      if (this.executedRequests.has(executorRequestId)) throw new Error(`Idempotency conflict: executor request_id ${executorRequestId} already processed.`);
      this.executedRequests.add(executorRequestId);

      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId: loopId,
        timestamp: executorStartedAt,
        type: 'AG_STARTED',
        turn,
        summary: `Turn ${turn}: Executing ${this.executorProvider} instruction.`,
        details: { requestId: executorRequestId, provider: this.executorProvider, instructionSnippet: instructionForExecutor.slice(0, 300), instruction: instructionForExecutor }
      });

      const executorResult = await this.executor.executeTurn(executorSessionId, instructionForExecutor, {
        request_id: executorRequestId,
        cwd: effectiveCwd,
        effort: this.config.effort,
        model: this.config.model,
        timeout_ms: this.config.executorTimeoutMs
      });

      const executorCompletedAt = new Date().toISOString();
      const executorDurationMs = Date.now() - executorStartTime;
      currentExecutorResponse = executorResult.response;

      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId: loopId,
        timestamp: executorCompletedAt,
        type: 'AG_OUTPUT',
        turn,
        summary: `Turn ${turn}: ${this.executorProvider} responded in ${executorDurationMs}ms (${executorResult.status}).`,
        details: {
          provider: this.executorProvider,
          status: executorResult.status,
          durationMs: executorDurationMs,
          outputSnippet: executorResult.response.slice(0, 300),
          response: executorResult.response
        }
      });

      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId: loopId,
        timestamp: executorCompletedAt,
        type: 'AG_FINISHED',
        turn,
        summary: `Turn ${turn}: ${this.executorProvider} execution finished.`,
        details: { provider: this.executorProvider, status: executorResult.status }
      });

      turnSummaries.push({
        turn,
        executor_provider: this.executorProvider,
        gpt_request_id: gptRequestId,
        antigravity_request_id: this.executorProvider === 'antigravity' ? executorRequestId : undefined,
        prompt_sent_to_gpt: gptPrompt,
        gpt_response: gptResult.text,
        antigravity_instruction: instructionForExecutor,
        antigravity_response: executorResult.response,
        timestamps: {
          gpt_started_at: gptStartedAt,
          gpt_completed_at: gptCompletedAt,
          antigravity_started_at: executorStartedAt,
          antigravity_completed_at: executorCompletedAt
        },
        durations: {
          gpt_duration_ms: gptDurationMs,
          antigravity_duration_ms: executorDurationMs,
          total_turn_duration_ms: gptDurationMs + executorDurationMs
        },
        status: executorResult.status,
        error: executorResult.error ? { code: executorResult.error.code, message: executorResult.error.message } : undefined
      });

      if (executorResult.status !== 'COMPLETED') {
        overallStatus = executorResult.status === 'TIMEOUT' ? 'TIMEOUT' : executorResult.status === 'HUMAN_REQUIRED' ? 'HUMAN_REQUIRED' : 'FAILED';
        loopError = {
          code: executorResult.error?.code || 'EXECUTOR_ERROR',
          message: executorResult.error?.message || `Executor failed on turn ${turn}`,
          where: 'loop_engine'
        };
        this.emitEvent({
          id: `evt-${randomUUID()}`,
          runId: loopId,
          timestamp: executorCompletedAt,
          type: 'RUN_FAILED',
          turn,
          summary: `Turn ${turn}: ${this.executorProvider} execution failed.`,
          details: { provider: this.executorProvider, error: loopError }
        });
        break;
      }

      if (options.stopCondition?.(currentExecutorResponse, turn)) break;
      if (gptResult.text.includes('[[STATUS: READY]]')) break;
    }

    if (overallStatus === 'RUNNING') overallStatus = 'COMPLETED';
    const agSession = this.agBridge.getSession(options.agSessionId || executorSessionId);
    const completedAt = new Date().toISOString();

    if (overallStatus === 'COMPLETED') {
      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId: loopId,
        timestamp: completedAt,
        type: 'RUN_COMPLETED',
        summary: `ClosedLoop run ${loopId} completed successfully across ${turnSummaries.length} turns.`,
        details: { totalTurns: turnSummaries.length, totalDurationMs: Date.now() - overallStartTime, executorProvider: this.executorProvider }
      });
    }

    return {
      loop_id: loopId,
      executor_provider: this.executorProvider,
      gpt_session_id: effectiveGptSessionId,
      antigravity_session_id: this.executorProvider === 'antigravity' ? executorSessionId : '',
      antigravity_conversation_id: this.executorProvider === 'antigravity' ? (agSession?.conversationId || null) : null,
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
