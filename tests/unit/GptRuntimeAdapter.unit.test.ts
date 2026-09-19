import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GptRuntimeAdapter } from '../../src/runtime/gpt/GptRuntimeAdapter.js';
import { WorkspaceCommandExecutor } from '../../src/runtime/execution/WorkspaceCommandExecutor.js';
import { IGptTransport } from '../../src/gpt/types.js';

class FakeGpt implements IGptTransport {
  async health() { return { status: 'ok' as const, initialized: true, isProcessing: false }; }
  async sendPrompt() {
    return {
      request_id: 'req-1',
      session_id: 'session-1',
      status: 'COMPLETED' as const,
      text: JSON.stringify({ action: 'shell', command: 'node -e "process.stdout.write(\\'runtime-ok\\')" }),
      duration_ms: 1
    };
  }
  createSession() { return 'session-1'; }
  async continueSession() { return this.sendPrompt(); }
}

test('GptRuntimeAdapter advertises workspace execution capabilities', () => {
  const runtime = new GptRuntimeAdapter({ gptTransport: new FakeGpt() });
  assert.equal(runtime.id, 'gpt-runtime');
  assert.ok(runtime.capabilities.supported.includes('shell.execute'));
  assert.ok(runtime.capabilities.supported.includes('filesystem.write'));
});

test('GptRuntimeAdapter converts GPT action into workspace execution', async () => {
  const runtime = new GptRuntimeAdapter({
    gptTransport: new FakeGpt(),
    commandExecutor: new WorkspaceCommandExecutor()
  });

  const result = await runtime.execute({
    planId: 'plan-test',
    runtimeId: runtime.id,
    request: {
      taskId: 'task-test',
      projectId: 'test-project',
      workspacePath: process.cwd(),
      prompt: 'run the test action',
      requiredCapabilities: ['shell.execute']
    },
    createdAt: new Date().toISOString()
  });

  assert.equal(result.status, 'COMPLETED');
  assert.match(result.output, /runtime-ok/);
});

test('GptRuntimeAdapter completes without shell execution when GPT says complete', async () => {
  const completeGpt: IGptTransport = {
    async health() { return { status: 'ok', initialized: true, isProcessing: false }; },
    async sendPrompt() {
      return {
        request_id: 'req-2',
        session_id: 'session-2',
        status: 'COMPLETED',
        text: JSON.stringify({ action: 'complete', message: 'done' }),
        duration_ms: 1
      };
    },
    createSession() { return 'session-2'; },
    async continueSession() { return this.sendPrompt(); }
  };

  const runtime = new GptRuntimeAdapter({ gptTransport: completeGpt });
  const result = await runtime.execute({
    planId: 'plan-complete',
    runtimeId: runtime.id,
    request: {
      taskId: 'task-complete',
      projectId: 'test-project',
      workspacePath: process.cwd(),
      prompt: 'finish',
      requiredCapabilities: []
    },
    createdAt: new Date().toISOString()
  });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.output, 'done');
});
