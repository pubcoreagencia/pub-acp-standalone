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
      text: JSON.stringify({ action: 'shell', command: "node -e \"process.stdout.write('runtime-ok')\"" }),
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
  assert.equal(result.output, '[[ACP_COMPLETE]] done');
});


test('GptRuntimeAdapter planning prompt explicitly requires workspace-relative shell commands', async () => {
  let capturedPrompt = '';
  const captureGpt: IGptTransport = {
    async health() { return { status: 'ok', initialized: true, isProcessing: false }; },
    async sendPrompt(prompt: string) {
      capturedPrompt = prompt;
      return {
        request_id: 'req-3',
        session_id: 'session-3',
        status: 'COMPLETED',
        text: JSON.stringify({ action: 'complete', message: 'done' }),
        duration_ms: 1
      };
    },
    createSession() { return 'session-3'; },
    async continueSession() { return this.sendPrompt(''); }
  };

  const runtime = new GptRuntimeAdapter({ gptTransport: captureGpt });
  const result = await runtime.execute({
    planId: 'plan-prompt-safety',
    runtimeId: runtime.id,
    request: {
      taskId: 'task-prompt-safety',
      projectId: 'test-project',
      workspacePath: 'C:\\workspace\\project',
      prompt: 'inspect the repository',
      requiredCapabilities: ['shell.execute']
    },
    createdAt: new Date().toISOString()
  });

  assert.equal(result.status, 'COMPLETED');
  assert.match(capturedPrompt, /Use workspace-relative paths only/i);
  assert.match(capturedPrompt, /NEVER put an absolute filesystem path/i);
  assert.match(capturedPrompt, /NEVER use cd/i);
});
