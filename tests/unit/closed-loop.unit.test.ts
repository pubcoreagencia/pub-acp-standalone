import test from 'node:test';
import assert from 'node:assert/strict';
import { ClosedLoopEngine } from '../../src/bridge/index.js';
import { IGptTransport } from '../../src/gpt/index.js';
import { AntigravityBridge, IAntigravityTransport } from '../../src/antigravity/index.js';

test('ClosedLoopEngine - unit test executes multi-turn loop and tracks metrics without copy/paste', async () => {
  let gptCalls = 0;
  let agCalls = 0;

  const mockGpt: IGptTransport = {
    health: async () => ({ status: 'ok', initialized: true }),
    createSession: () => 'mock-gpt-session',
    sendPrompt: async (prompt, opts) => {
      gptCalls++;
      return {
        request_id: opts?.request_id || 'gpt-req',
        session_id: opts?.session_id || 'gpt-sess',
        status: 'COMPLETED',
        text: `INSTRUCTION_FOR_TURN_${gptCalls}`,
        duration_ms: 20
      };
    },
    continueSession: async (sess, prompt, opts) => {
      gptCalls++;
      return {
        request_id: opts?.request_id || 'gpt-req',
        session_id: sess,
        status: 'COMPLETED',
        text: `INSTRUCTION_FOR_TURN_${gptCalls}`,
        duration_ms: 20
      };
    }
  };

  const mockAg: IAntigravityTransport = {
    health: async () => ({ status: 'ok', agyPath: 'mock' }),
    sendPrompt: async (prompt, opts) => {
      agCalls++;
      return {
        request_id: opts?.request_id || 'ag-req',
        session_id: opts?.session_id || 'ag-sess',
        conversation_id: 'ag-conv-mock-123',
        status: 'COMPLETED',
        response: `EXECUTION_RESULT_TURN_${agCalls}`,
        duration_ms: 30
      };
    }
  };

  const engine = new ClosedLoopEngine(mockGpt, mockAg);

  const report = await engine.runLoop('Initial goal from user/orchestrator', {
    maxTurns: 3,
    loopId: 'test-loop-unit'
  });

  assert.equal(report.status, 'COMPLETED');
  assert.equal(report.total_turns, 3);
  assert.equal(report.manual_copy_paste_operations, 0);
  assert.equal(gptCalls, 3);
  assert.equal(agCalls, 3);
  assert.equal(report.antigravity_conversation_id, 'ag-conv-mock-123');

  // Verify turn chain
  assert.equal(report.turns[0].gpt_response, 'INSTRUCTION_FOR_TURN_1');
  assert.equal(report.turns[0].antigravity_response, 'EXECUTION_RESULT_TURN_1');
  assert.equal(report.turns[1].gpt_response, 'INSTRUCTION_FOR_TURN_2');
  assert.equal(report.turns[1].antigravity_response, 'EXECUTION_RESULT_TURN_2');
  assert.equal(report.turns[2].gpt_response, 'INSTRUCTION_FOR_TURN_3');
  assert.equal(report.turns[2].antigravity_response, 'EXECUTION_RESULT_TURN_3');
});

test('ClosedLoopEngine - unit test gracefully stops on failure at AG step', async () => {
  const mockGpt: IGptTransport = {
    health: async () => ({ status: 'ok', initialized: true }),
    createSession: () => 'mock-gpt-session',
    sendPrompt: async () => ({
      request_id: 'gpt-req',
      session_id: 'gpt-sess',
      status: 'COMPLETED',
      text: 'Do something',
      duration_ms: 10
    }),
    continueSession: async () => ({
      request_id: 'gpt-req',
      session_id: 'gpt-sess',
      status: 'COMPLETED',
      text: 'Do something',
      duration_ms: 10
    })
  };

  const failingAg: IAntigravityTransport = {
    health: async () => ({ status: 'ok', agyPath: 'mock' }),
    sendPrompt: async () => ({
      request_id: 'ag-req',
      session_id: 'ag-sess',
      conversation_id: null,
      status: 'FAILED',
      response: '',
      duration_ms: 10,
      error: { code: 'EXEC_ERROR', message: 'Command failed' }
    })
  };

  const engine = new ClosedLoopEngine(mockGpt, failingAg);
  const report = await engine.runLoop('Initial prompt', { maxTurns: 3 });

  assert.equal(report.status, 'FAILED');
  assert.equal(report.total_turns, 1);
  assert.equal(report.error?.where, 'antigravity');
  assert.equal(report.error?.code, 'EXEC_ERROR');
});
