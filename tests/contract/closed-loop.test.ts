import test from 'node:test';
import assert from 'node:assert/strict';
import { ClosedLoopEngine } from '../../src/bridge/index.js';
import { GptTransport } from '../../src/gpt/index.js';
import { AntigravityBridge } from '../../src/antigravity/index.js';

test('ClosedLoopEngine - contract test with simulated GPT and Antigravity', async () => {
  const engine = new ClosedLoopEngine(
    {
      health: async () => ({ status: 'ok', initialized: true }),
      createSession: () => 'sim-sess',
      sendPrompt: async (prompt, opts) => ({
        request_id: opts?.request_id || 'sim-req',
        session_id: opts?.session_id || 'sim-sess',
        status: 'COMPLETED',
        text: `SIMULATED_PROMPT_RESPONSE: ${prompt}`,
        duration_ms: 10
      }),
      continueSession: async (sess, prompt, opts) => ({
        request_id: opts?.request_id || 'sim-req',
        session_id: sess,
        status: 'COMPLETED',
        text: `SIMULATED_PROMPT_RESPONSE: ${prompt}`,
        duration_ms: 10
      })
    },
    {
      health: async () => ({ status: 'ok', agyPath: 'sim' }),
      sendPrompt: async (prompt, opts) => ({
        request_id: opts?.request_id || 'sim-ag-req',
        session_id: opts?.session_id || 'sim-ag-sess',
        conversation_id: 'conv-sim',
        status: 'COMPLETED',
        response: `SIMULATED_AG_OUTPUT: ${prompt}`,
        duration_ms: 10
      })
    }
  );

  const report = await engine.runLoop('Run step 1', { maxTurns: 2 });
  assert.equal(report.status, 'COMPLETED');
  assert.equal(report.total_turns, 2);
  assert.equal(report.manual_copy_paste_operations, 0);
  assert.equal(report.turns[0].status, 'COMPLETED');
  assert.equal(report.turns[1].status, 'COMPLETED');
});
