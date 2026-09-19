import test from 'node:test';
import assert from 'node:assert/strict';
import { ClosedLoopEngine } from '../../src/bridge/index.js';

test('ClosedLoopEngine - contract test with simulated GPT runtime', async () => {
  const runtime = {
    id: 'gpt-runtime-test',
    provider: 'test',
    version: '1',
    capabilities: {
      supported: ['filesystem.read', 'filesystem.write', 'shell.execute'],
      supportsStreaming: false,
      requiresHumanApproval: false,
      isHeadless: true
    },
    checkHealth: async () => ({
      healthy: true,
      availableCapacity: 1
    }),
    execute: async (plan: any, onEvent?: (event: any) => void) => {
      onEvent?.({
        runId: plan.planId,
        type: 'CHUNK',
        payload: { output: 'SIMULATED_RUNTIME_OUTPUT' },
        timestamp: new Date().toISOString()
      });
      return {
        runId: plan.planId,
        status: 'COMPLETED',
        output: 'SIMULATED_RUNTIME_OUTPUT',
        metrics: { durationMs: 5, turnsCount: 1 }
      };
    }
  };

  const engine = new ClosedLoopEngine(undefined, runtime);

  const report = await engine.runLoop('Run step 1', { maxTurns: 2 });
  assert.equal(report.status, 'COMPLETED');
  assert.equal(report.total_turns, 2);
  assert.equal(report.manual_copy_paste_operations, 0);
  assert.equal(report.turns[0].status, 'COMPLETED');
  assert.equal(report.turns[1].status, 'COMPLETED');
  assert.equal(report.turns[0].runtime_response, 'SIMULATED_RUNTIME_OUTPUT');
});