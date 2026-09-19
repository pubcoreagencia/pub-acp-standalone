import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ClosedLoopEngine } from '../../src/bridge/index.js';
import { GptTransport } from '../../src/gpt/index.js';
import { GptRuntimeAdapter } from '../../src/runtime/gpt/GptRuntimeAdapter.js';

test('Integration: ClosedLoop with simulated GPT Runtime and workspace execution', { timeout: 120000 }, async () => {
  const workspaceDir = process.cwd();
  const targetFile = path.resolve(workspaceDir, 'TEST_INTEGRATION_LOOP.txt');

  if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);

  let turnCounter = 0;
  const simulatedGpt: GptTransport = {
    health: async () => ({ status: 'ok', initialized: true }),
    createSession: () => 'sim-gpt-session',
    sendPrompt: async (_prompt, opts) => {
      turnCounter++;
      const request_id = opts?.request_id || `gpt-req-${turnCounter}`;
      const session_id = opts?.session_id || 'gpt-sess';
      const command = turnCounter === 1
        ? `node -e "require('fs').writeFileSync('TEST_INTEGRATION_LOOP.txt','GPT-LOOP-1\\n')"`
        : `node -e "require('fs').appendFileSync('TEST_INTEGRATION_LOOP.txt','GPT-LOOP-${turnCounter}\\n')"`;
      return {
        request_id,
        session_id,
        status: 'COMPLETED',
        text: JSON.stringify({ action: 'shell', command }),
        duration_ms: 10
      };
    },
    continueSession: async (sessionId, prompt, opts) =>
      (simulatedGpt as any).sendPrompt(prompt, { ...opts, session_id: sessionId })
  } as unknown as GptTransport;

  const runtime = new GptRuntimeAdapter({
    gptTransport: simulatedGpt,
    defaultTimeoutMs: 30000
  });
  const engine = new ClosedLoopEngine(undefined, runtime, {
    cwd: workspaceDir,
    effort: 'low',
    defaultTimeoutMs: 30000
  });

  try {
    const report = await engine.runLoop('Execute the workspace task', {
      maxTurns: 3,
      loopId: `integration-loop-${Date.now()}`
    });

    assert.equal(report.status, 'COMPLETED');
    assert.equal(report.total_turns, 3);
    assert.equal(report.manual_copy_paste_operations, 0);
    assert.ok(fs.existsSync(targetFile), 'Target file must exist after 3 turns');

    const fileContent = fs.readFileSync(targetFile, 'utf8').replace(/\\r\\n/g, '\\n').trim();
    const expected = 'GPT-LOOP-1\\nGPT-LOOP-2\\nGPT-LOOP-3';
    assert.equal(fileContent, expected, `Expected file content to be "${expected}", got "${fileContent}"`);
  } finally {
    if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
  }
});
