import { randomUUID } from 'node:crypto';
import { IGptTransport, GptTransport } from '../gpt/index.js';
import { IAntigravityTransport, AntigravityTransport, AntigravityBridge } from '../antigravity/index.js';
import {
  ClosedLoopConfig,
  ClosedLoopRunReport,
  ClosedLoopTurnSummary,
  LoopEnvelope,
  LoopResultEnvelope
} from './types.js';

export class ClosedLoopEngine {
  private readonly gptTransport: IGptTransport;
  private readonly agBridge: AntigravityBridge;
  private readonly config: ClosedLoopConfig;
  private readonly executedRequests = new Set<string>();

  constructor(
    gptTransport?: IGptTransport,
    agTransportOrBridge?: IAntigravityTransport | AntigravityBridge,
    config: ClosedLoopConfig = {}
  ) {
    this.gptTransport = gptTransport || new GptTransport();
    if (agTransportOrBridge instanceof AntigravityBridge) {
      this.agBridge = agTransportOrBridge;
    } else {
      this.agBridge = new AntigravityBridge(agTransportOrBridge || new AntigravityTransport());
    }
    this.config = {
      defaultTimeoutMs: config.defaultTimeoutMs || 300000,
      cwd: config.cwd || process.cwd(),
      effort: config.effort || 'low',
      model: config.model
    };
  }

  getGptTransport(): IGptTransport {
    return this.gptTransport;
  }

  getAntigravityBridge(): AntigravityBridge {
    return this.agBridge;
  }

  async runLoop(
    initialPromptOrInstructions: string,
    options: {
      loopId?: string;
      maxTurns?: number;
      gptSessionId?: string;
      agSessionId?: string;
      turnPromptBuilder?: (prevAgResponse: string, turn: number) => string;
      stopCondition?: (agResponse: string, turn: number) => boolean;
    } = {}
  ): Promise<ClosedLoopRunReport> {
    const loopId = options.loopId || `loop-${randomUUID()}`;
    const maxTurns = options.maxTurns || 3;
    const gptSessionId = options.gptSessionId || `gpt-loop-${randomUUID()}`;
    const agSessionId = options.agSessionId || `ag-loop-${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const overallStartTime = Date.now();

    const turnSummaries: ClosedLoopTurnSummary[] = [];
    let currentAgResponse = '';
    let overallStatus: ClosedLoopRunReport['status'] = 'RUNNING';
    let loopError: ClosedLoopRunReport['error'] | undefined;

    let effectiveGptSessionId = gptSessionId;

    for (let turn = 1; turn <= maxTurns; turn++) {
      const gptStartedAt = new Date().toISOString();
      const gptStartTime = Date.now();

      // 1. Prepare envelope for GPT prompt
      let gptPrompt: string;
      if (turn === 1) {
        gptPrompt = initialPromptOrInstructions;
      } else if (options.turnPromptBuilder) {
        gptPrompt = options.turnPromptBuilder(currentAgResponse, turn);
      } else {
        gptPrompt = `O Antigravity executou o turno anterior com o seguinte resultado:\n"""\n${currentAgResponse}\n"""\nPor favor gere a instrução exata para o próximo passo (Turno ${turn}).`;
      }

      const gptRequestId = `${loopId}-t${turn}-gpt-${randomUUID().slice(0, 8)}`;
      if (this.executedRequests.has(gptRequestId)) {
        throw new Error(`Idempotency conflict: GPT request_id ${gptRequestId} already processed.`);
      }
      this.executedRequests.add(gptRequestId);

      // 2. Dispatch to GPT Free
      const gptResult = await this.gptTransport.continueSession(effectiveGptSessionId, gptPrompt, {
        request_id: gptRequestId,
        timeout_ms: this.config.defaultTimeoutMs
      });

      if (gptResult.session_id) {
        effectiveGptSessionId = gptResult.session_id;
      }

      const gptCompletedAt = new Date().toISOString();
      const gptDurationMs = Date.now() - gptStartTime;

      if (gptResult.status !== 'COMPLETED') {
        overallStatus = gptResult.status === 'TIMEOUT' ? 'TIMEOUT' :
          gptResult.status === 'HUMAN_REQUIRED' ? 'HUMAN_REQUIRED' : 'FAILED';
        loopError = {
          code: gptResult.error?.code || 'GPT_ERROR',
          message: gptResult.error?.message || `GPT failed on turn ${turn} with status ${gptResult.status}`,
          where: 'gpt'
        };

        turnSummaries.push({
          turn,
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
          durations: {
            gpt_duration_ms: gptDurationMs,
            antigravity_duration_ms: 0,
            total_turn_duration_ms: gptDurationMs
          },
          status: gptResult.status as any,
          error: gptResult.error
        });
        break;
      }

      // 3. Forward GPT output instruction to Antigravity CLI
      const instructionForAg = gptResult.text.trim();
      const agStartedAt = new Date().toISOString();
      const agStartTime = Date.now();
      const agRequestId = `${loopId}-t${turn}-ag-${randomUUID().slice(0, 8)}`;

      if (this.executedRequests.has(agRequestId)) {
        throw new Error(`Idempotency conflict: AG request_id ${agRequestId} already processed.`);
      }
      this.executedRequests.add(agRequestId);

      const agResult = await this.agBridge.executeTurn(agSessionId, instructionForAg, {
        request_id: agRequestId,
        cwd: this.config.cwd,
        effort: this.config.effort,
        model: this.config.model,
        timeout_ms: this.config.defaultTimeoutMs
      });

      const agCompletedAt = new Date().toISOString();
      const agDurationMs = Date.now() - agStartTime;
      currentAgResponse = agResult.response;

      const turnSummary: ClosedLoopTurnSummary = {
        turn,
        gpt_request_id: gptRequestId,
        antigravity_request_id: agRequestId,
        prompt_sent_to_gpt: gptPrompt,
        gpt_response: gptResult.text,
        antigravity_instruction: instructionForAg,
        antigravity_response: agResult.response,
        timestamps: {
          gpt_started_at: gptStartedAt,
          gpt_completed_at: gptCompletedAt,
          antigravity_started_at: agStartedAt,
          antigravity_completed_at: agCompletedAt
        },
        durations: {
          gpt_duration_ms: gptDurationMs,
          antigravity_duration_ms: agDurationMs,
          total_turn_duration_ms: gptDurationMs + agDurationMs
        },
        status: agResult.status === 'COMPLETED' ? 'COMPLETED' :
          agResult.status === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED',
        error: agResult.error ? {
          code: agResult.error.code,
          message: agResult.error.message
        } : undefined
      };

      turnSummaries.push(turnSummary);

      if (agResult.status !== 'COMPLETED') {
        overallStatus = agResult.status === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED';
        loopError = {
          code: agResult.error?.code || 'ANTIGRAVITY_ERROR',
          message: agResult.error?.message || `Antigravity execution failed on turn ${turn}`,
          where: 'antigravity'
        };
        break;
      }

      if (options.stopCondition && options.stopCondition(currentAgResponse, turn)) {
        break;
      }
    }

    if (overallStatus === 'RUNNING') {
      overallStatus = 'COMPLETED';
    }

    const agSession = this.agBridge.getSession(agSessionId);

    return {
      loop_id: loopId,
      gpt_session_id: effectiveGptSessionId,
      antigravity_session_id: agSessionId,
      antigravity_conversation_id: agSession?.conversationId || null,
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
