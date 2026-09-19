import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClosedLoopEngine } from '../../src/bridge/ClosedLoopEngine.js';
import { IAgentRuntime } from '../../src/runtime/IAgentRuntime.js';
import { ExecutionPlan, ExecutionResult, RuntimeHealth } from '../../src/runtime/types.js';
import { IProjectValidator } from '../../src/validation/types.js';

class FakeRuntime implements IAgentRuntime {
  readonly id = 'fake-runtime';
  readonly provider = 'test';
  readonly version = '1.0.0';
  readonly capabilities = {
    supported: ['filesystem.read', 'filesystem.write', 'shell.execute', 'headless'] as const,
    supportsStreaming: false,
    requiresHumanApproval: false,
    isHeadless: true
  };

  async checkHealth(): Promise<RuntimeHealth> {
    return { healthy: true, availableCapacity: 1 };
  }

  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    return {
      runId: plan.planId,
      status: 'COMPLETED',
      output: 'runtime completed',
      metrics: { durationMs: 1, turnsCount: 1 }
    };
  }
}

class PassingValidator implements IProjectValidator {
  async validate() {
    return {
      status: 'PASS' as const,
      exitCode: 0,
      summary: 'validation passed',
      durationMs: 1
    };
  }
}

test('ClosedLoopEngine executes through generic runtime without Antigravity', async () => {
  const runtime = new FakeRuntime();
  const engine = new ClosedLoopEngine(undefined, runtime, {
    cwd: process.cwd(),
    validator: new PassingValidator(),
    executionContext: {
      runId: 'run-runtime-test',
      taskId: 'task-runtime-test',
      projectId: 'test-project',
      projectName: 'Test Project',
      workspacePath: process.cwd(),
      repository: 'test/repo',
      branch: 'main',
      validationPolicy: {
        mode: 'REQUIRED',
        command: 'node -e "process.exit(0)"'
      }
    }
  });

  const report = await engine.runLoop('execute the task', {
    loopId: 'run-runtime-test',
    maxTurns: 1
  });

  assert.equal(report.status, 'COMPLETED');
  assert.equal(report.total_turns, 1);
  assert.equal(report.turns[0].runtime_request_id?.startsWith('run-runtime-test-t1-runtime-'), true);
  assert.equal(report.turns[0].runtime_response, 'runtime completed');
  assert.equal(engine.getRuntime().id, 'fake-runtime');
});

test('ClosedLoopEngine does not block on OPTIONAL validation failure', async () => {
  const runtime = new FakeRuntime();
  const validator: IProjectValidator = {
    async validate() {
      return {
        status: 'FAIL',
        exitCode: 1,
        summary: 'optional validation failed',
        durationMs: 1
      };
    }
  };

  const engine = new ClosedLoopEngine(undefined, runtime, {
    cwd: process.cwd(),
    validator,
    executionContext: {
      runId: 'run-optional-test',
      taskId: 'task-optional-test',
      projectId: 'test-project',
      projectName: 'Test Project',
      workspacePath: process.cwd(),
      repository: 'test/repo',
      branch: 'main',
      validationPolicy: {
        mode: 'OPTIONAL',
        command: 'npm test'
      }
    }
  });

  const report = await engine.runLoop('execute the task', {
    loopId: 'run-optional-test',
    maxTurns: 1
  });

  assert.equal(report.status, 'COMPLETED');
});


test('ClosedLoopEngine retries a failed runtime turn with diagnostics when turns remain', async () => {
  let calls = 0;
  const recoveringRuntime: IAgentRuntime = {
    id: 'recovering-runtime',
    provider: 'test',
    version: '1.0.0',
    capabilities: {
      supported: ['filesystem.read', 'filesystem.write', 'shell.execute', 'headless'] as const,
      supportsStreaming: false,
      requiresHumanApproval: false,
      isHeadless: true
    },
    async checkHealth() {
      return { healthy: true, availableCapacity: 1 };
    },
    async execute(plan: ExecutionPlan) {
      calls += 1;
      if (calls === 1) {
        return {
          runId: plan.planId,
          status: 'FAILED',
          output: 'Command rejected: explicit absolute or UNC filesystem paths are not allowed.',
          diagnostics: ['Workspace command was rejected before execution.'],
          metrics: { durationMs: 1, turnsCount: 1 }
        };
      }
      return {
        runId: plan.planId,
        status: 'COMPLETED',
        output: '[[ACP_COMPLETE]] corrected',
        metrics: { durationMs: 1, turnsCount: 1 }
      };
    }
  };

  const engine = new ClosedLoopEngine(undefined, recoveringRuntime, {
    cwd: process.cwd(),
    executionContext: {
      runId: 'run-recovery-test',
      taskId: 'task-recovery-test',
      projectId: 'test-project',
      projectName: 'Test Project',
      workspacePath: process.cwd(),
      repository: 'test/repo',
      branch: 'main'
    }
  });

  const report = await engine.runLoop('execute the task', {
    loopId: 'run-recovery-test',
    maxTurns: 2
  });

  assert.equal(calls, 2);
  assert.equal(report.status, 'COMPLETED');
  assert.equal(report.total_turns, 2);
  assert.equal(report.turns[0].status, 'FAILED');
  assert.equal(report.turns[1].runtime_response, '[[ACP_COMPLETE]] corrected');
});
