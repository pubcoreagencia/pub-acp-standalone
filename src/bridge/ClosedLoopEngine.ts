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

  getGptTransport(): IGptTransport {
    return this.gptTransport;
  }

  getAntigravityBridge(): AntigravityBridge {
    return this.agBridge;
  }

  getExecutor(): IExecutionTransport {
    return this.executor;
  }

  getExecutorProvider(): ExecutionProviderKind {
    return this.executorProvider;
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
    const loopId = options.loopId || `loop-${randomUUID()}`;
    const maxTurns = options.maxTurns || 3;
    const gptSessionId = options.gptSessionId || `gpt-loop-${randomUUID()}`;
    const executorSessionId = options.executorSessionId || options.agSessionId ||
      `${this.executorProvider}-executor-${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const overallStartTime = Date.now();
    const effectiveCwd = options.cwd || options.executionContext?.workspacePath || this.config.cwd;
    const effectiveConversationId = options.conversationId || options.executionContext?.conversationId;

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
      if (this.executedRequests.has(gptRequestId)) {
        throw new Error(`Idempotency conflict: GPT request_id ${gptRequestId} already processed.`);
      }
      this.executedRequests.add(gptRequestId);

      const gptResult = await this.gptTransport.continueSession(effectiveGptSessionId, gptPrompt, {
        request_id: gptRequestId,
        timeout_ms: this.config.defaultTimeoutMs
      });

      if (gptResult.session_id) effectiveGptSessionId = gptResult.session_id;
      const gptCompletedAt = new Date().toISOString();
      const gptDurationMs = Date.now() - gptStartTime;

      if (gptResult.status !== 'COMPLETED') {
        overallStatus = gptResult.status === 'TIMEOUT' ? 'TIMEOUT' :
          gptResult.status === 'HUMAN_REQUIRED' ? 'HUMAN_REQUIRED' : 'FAILED';
        loopError = {
          code: gptResult.error?.code || 'GPT_ERROR',
          message: gptResult.error?.message || `GPT failed on turn ${turn}`,
          where: 'gpt'
        };
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

      if (this.executedRequests.has(executorRequestId)) {
        throw new Error(`Idempotency conflict: executor request_id ${executorRequestId} already processed.`);
      }
      this.executedRequests.add(executorRequestId);

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
        error: executorResult.error ? {
          code: executorResult.error.code,
          message: executorResult.error.message
        } : undefined
      });

      if (executorResult.status !== 'COMPLETED') {
        overallStatus = executorResult.status === 'TIMEOUT' ? 'TIMEOUT' :
          executorResult.status === 'HUMAN_REQUIRED' ? 'HUMAN_REQUIRED' : 'FAILED';
        loopError = {
          code: executorResult.error?.code || 'EXECUTOR_ERROR',
          message: executorResult.error?.message || `Executor failed on turn ${turn}`,
          where: 'loop_engine'
        };
        break;
      }

      if (options.stopCondition?.(currentExecutorResponse, turn)) break;
      if (gptResult.text.includes('[[STATUS: READY]]')) break;
    }

    if (overallStatus === 'RUNNING') overallStatus = 'COMPLETED';

    const agSession = this.agBridge.getSession(options.agSessionId || executorSessionId);

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
      completed_at: new Date().toISOString(),
      manual_copy_paste_operations: 0,
      error: loopError
    };
  }
}
