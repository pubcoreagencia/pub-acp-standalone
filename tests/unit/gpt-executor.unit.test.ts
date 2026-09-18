import test from 'node:test';
import assert from 'node:assert/strict';
import { ClosedLoopEngine, IExecutionTransport, ExecutionResult } from '../../src/bridge/index.js';
import { IGptTransport } from '../../src/gpt/index.js';
import { IAntigravityTransport } from '../../src/antigravity/index.js';

test('ClosedLoopEngine - GPT executor provider runs a real multi-turn transport chain with zero copy/paste', async () => {
  const gptPrompts: string[] = [];
  const executorPrompts: string[] = [];
  const executorSessionIds: string[] = [];

  const mockOrchestrator: IGptTransport = {
    health: async () => ({ status: 'ok', initialized: true }),
    createSession: () => 'orchestrator-session',
    sendPrompt: async () => ({
      request_id: 'unused',
      session_id: 'orchestrator-session',
      status: 'COMPLETED',
      text: 'unused',
      duration_ms: 1
    }),
    continueSession: async (sessionId, prompt, options) => {
      gptPrompts.push(prompt);
      const turn = gptPrompts.length;
      return {
        request_id: options?.request_id || `gpt-${turn}`,
        session_id: sessionId,
        status: 'COMPLETED',
        text: turn === 1
          ? 'Create GPT_EXECUTOR_PROOF.txt containing exactly GPT EXECUTOR PASS'
          : 'Verify GPT_EXECUTOR_PROOF.txt and report READY',
        duration_ms: 1
      };
    }
  };

  const mockAg: IAntigravityTransport = {
    health: async () => ({ status: 'ok', agyPath: 'unused' }),
    sendPrompt: async () => ({
      request_id: 'unused',
      session_id: 'unused',
      conversation_id: null,
      status: 'COMPLETED',
      response: 'unused',
      duration_ms: 1
    })
  };

  const mockExecutor: IExecutionTransport = {
    health: async () => ({ status: 'ok' }),
    executeTurn: async (sessionId, prompt, options = {}): Promise<ExecutionResult> => {
      executorSessionIds.push(sessionId);
      executorPrompts.push(prompt);
      const turn = executorPrompts.length;
      return {
        request_id: options.request_id || `executor-${turn}`,
        session_id: sessionId,
        status: 'COMPLETED',
        response: turn === 1
          ? 'Created GPT_EXECUTOR_PROOF.txt with GPT EXECUTOR PASS'
          : 'Verified GPT_EXECUTOR_PROOF.txt: GPT EXECUTOR PASS',
        duration_ms: 1
      };
    }
  };

  const engine = new ClosedLoopEngine(
    mockOrchestrator,
    mockAg,
    { executorProvider: 'gpt', cwd: process.cwd(), defaultTimeoutMs: 1000, executorTimeoutMs: 1000 },
    mockExecutor
  );

  const report = await engine.runLoop('Initial autonomous task', {
    loopId: 'gpt-executor-unit',
    maxTurns: 2
  });

  assert.equal(report.status, 'COMPLETED');
  assert.equal(report.executor_provider, 'gpt');
  assert.equal(report.total_turns, 2);
  assert.equal(report.manual_copy_paste_operations, 0);
  assert.equal(gptPrompts.length, 2);
  assert.equal(executorPrompts.length, 2);
  assert.deepEqual(executorSessionIds, [executorSessionIds[0], executorSessionIds[0]]);
  assert.match(executorPrompts[0], /GPT_EXECUTOR_PROOF/);
  assert.match(executorPrompts[1], /GPT_EXECUTOR_PROOF/);
  assert.equal(report.turns[0].executor_provider, 'gpt');
  assert.equal(report.turns[1].executor_provider, 'gpt');
});
