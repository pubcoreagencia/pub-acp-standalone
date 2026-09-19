import test from 'node:test';
import assert from 'node:assert/strict';
import { ClosedLoopEngine } from '../../src/bridge/index.js';
import { IAgentRuntime } from '../../src/runtime/IAgentRuntime.js';
import { ExecutionPlan, ExecutionResult, RuntimeHealth } from '../../src/runtime/types.js';

class FakeRuntime implements IAgentRuntime {
  readonly id = 'fake-runtime';
  readonly provider = 'test';
  readonly version = '1';
  readonly capabilities = {
    supported: ['filesystem.read', 'filesystem.write', 'shell.execute'] as const,
    supportsStreaming: false,
    requiresHumanApproval: false,
    isHeadless: true
  };
  calls = 0;
  plans: ExecutionPlan[] = [];
  fail = false;
  async checkHealth(): Promise<RuntimeHealth> { return { healthy: true, availableCapacity: 1 }; }
  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    this.calls++;
    this.plans.push(plan);
    if (this.fail) return { runId: `runtime-run-${this.calls}`, status: 'FAILED', output: '', diagnostics: ['Command failed'], metrics: { durationMs: 1 } };
    return { runId: `runtime-run-${this.calls}`, status: 'COMPLETED', output: `EXECUTION_RESULT_TURN_${this.calls}`, metrics: { durationMs: 1, turnsCount: 1 } };
  }
}

test('ClosedLoopEngine executes multi-turn loop through generic runtime without copy/paste', async () => {
  const runtime = new FakeRuntime();
  const report = await new ClosedLoopEngine(undefined, runtime).runLoop('Initial goal from user/orchestrator', { maxTurns: 3, loopId: 'test-loop-unit' });
  assert.equal(report.status, 'COMPLETED');
  assert.equal(report.total_turns, 3);
  assert.equal(report.manual_copy_paste_operations, 0);
  assert.equal(runtime.calls, 3);
  assert.equal(report.turns[0].runtime_response, 'EXECUTION_RESULT_TURN_1');
  assert.equal(report.turns[1].runtime_response, 'EXECUTION_RESULT_TURN_2');
  assert.equal(report.turns[2].runtime_response, 'EXECUTION_RESULT_TURN_3');
});

test('ClosedLoopEngine retries generic runtime failure until the turn budget is exhausted', async () => {
  const runtime = new FakeRuntime();
  runtime.fail = true;
  const report = await new ClosedLoopEngine(undefined, runtime).runLoop('Initial prompt', { maxTurns: 3 });
  assert.equal(report.status, 'FAILED');
  assert.equal(report.total_turns, 3);
  assert.equal(runtime.calls, 3);
  assert.equal(report.error?.where, 'loop_engine');
  assert.equal(report.error?.code, 'RUNTIME_EXECUTION_FAILED');
});

test('ClosedLoopEngine preserves conversationId as runtime execution metadata', async () => {
  const runtime = new FakeRuntime();
  const report = await new ClosedLoopEngine(undefined, runtime).runLoop('Goal in existing conversation', { maxTurns: 2, conversationId: 'conv-existing-1234' });
  assert.equal(report.status, 'COMPLETED');
  assert.equal(report.total_turns, 2);
  assert.equal(runtime.plans.length, 2);
  assert.equal(runtime.plans[0].request.metadata?.conversationId, 'conv-existing-1234');
  assert.equal(runtime.plans[1].request.metadata?.conversationId, 'conv-existing-1234');
});
