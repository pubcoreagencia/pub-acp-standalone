import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentRuntimeRegistry } from '../../src/runtime/AgentRuntimeRegistry.js';
import { AgentRuntimeRouter } from '../../src/runtime/AgentRuntimeRouter.js';
import { IAgentRuntime } from '../../src/runtime/IAgentRuntime.js';
import { ExecutionPlan, ExecutionResult, RuntimeHealth } from '../../src/runtime/types.js';

function runtime(id: string, supported: IAgentRuntime['capabilities']['supported'], healthy = true): IAgentRuntime {
  return {
    id,
    provider: 'test',
    version: '1.0.0',
    capabilities: {
      supported,
      supportsStreaming: false,
      requiresHumanApproval: false,
      isHeadless: true
    },
    async checkHealth(): Promise<RuntimeHealth> {
      return { healthy, availableCapacity: healthy ? 1 : 0 };
    },
    async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
      return { runId: plan.request.taskId, status: 'COMPLETED', output: 'ok' };
    }
  };
}

test('AgentRuntimeRegistry normalizes ids and checks health', async () => {
  const registry = new AgentRuntimeRegistry();
  registry.register(runtime(' GPT ', ['filesystem.read']));

  assert.equal(registry.get('gpt')?.id, ' GPT ');
  const health = await registry.checkAllHealth();
  assert.equal(health[' GPT '].healthy, true);
});

test('AgentRuntimeRouter selects a healthy runtime with required capabilities', async () => {
  const registry = new AgentRuntimeRegistry();
  registry.register(runtime('unhealthy', ['filesystem.read'], false));
  registry.register(runtime('gpt', ['filesystem.read', 'filesystem.write']));

  const router = new AgentRuntimeRouter(registry);
  const plan = await router.plan({
    taskId: 'task-1',
    projectId: 'pub-machine',
    workspacePath: '/workspace/pub-machine',
    prompt: 'implement task',
    requiredCapabilities: ['filesystem.write']
  });

  assert.equal(plan.runtimeId, 'gpt');
  assert.match(plan.planId, /^plan-/);
});

test('AgentRuntimeRouter rejects unsupported capabilities', async () => {
  const registry = new AgentRuntimeRegistry();
  registry.register(runtime('gpt', ['filesystem.read']));

  const router = new AgentRuntimeRouter(registry);
  await assert.rejects(
    router.plan({
      taskId: 'task-1',
      projectId: 'pub-machine',
      workspacePath: '/workspace/pub-machine',
      prompt: 'implement task',
      requiredCapabilities: ['shell.execute']
    }),
    /No registered runtime/
  );
});
