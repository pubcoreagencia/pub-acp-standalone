import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ClosedLoopEngine } from '../../src/bridge/index.js';
import { GptTransport } from '../../src/gpt/index.js';
import { AntigravityBridge, AntigravityTransport } from '../../src/antigravity/index.js';

test('Integration: ClosedLoop with Live Antigravity and Simulated GPT Orchestrator', { timeout: 300000 }, async (t) => {
  const agTransport = new AntigravityTransport();
  const agHealth = await agTransport.health();
  if (agHealth.status !== 'ok') {
    t.skip(`Antigravity CLI is not available: ${agHealth.error}`);
    return;
  }

  const workspaceDir = process.cwd();
  const targetFile = path.resolve(workspaceDir, 'TEST_INTEGRATION_LOOP.txt');

  if (fs.existsSync(targetFile)) {
    fs.unlinkSync(targetFile);
  }

  // Simulated GPT Free orchestrator generating instructions sequentially
  let turnCounter = 0;
  const simulatedGpt: GptTransport = {
    health: async () => ({ status: 'ok', initialized: true }),
    createSession: () => 'sim-gpt-session',
    sendPrompt: async (prompt, opts) => {
      turnCounter++;
      if (turnCounter === 1) {
        return {
          request_id: opts?.request_id || 'gpt-req-1',
          session_id: opts?.session_id || 'gpt-sess',
          status: 'COMPLETED',
          text: `Crie exatamente o arquivo no caminho "${targetFile}" contendo apenas o texto:\nGPT-LOOP-1`,
          duration_ms: 10
        };
      } else if (turnCounter === 2) {
        return {
          request_id: opts?.request_id || 'gpt-req-2',
          session_id: opts?.session_id || 'gpt-sess',
          status: 'COMPLETED',
          text: `Leia o arquivo no caminho "${targetFile}" e acrescente uma nova linha contendo exatamente:\nGPT-LOOP-2`,
          duration_ms: 10
        };
      } else {
        return {
          request_id: opts?.request_id || 'gpt-req-3',
          session_id: opts?.session_id || 'gpt-sess',
          status: 'COMPLETED',
          text: `Leia o arquivo no caminho "${targetFile}" e acrescente uma nova linha contendo exatamente:\nGPT-LOOP-3`,
          duration_ms: 10
        };
      }
    },
    continueSession: async (sess, prompt, opts) => {
      return (simulatedGpt as any).sendPrompt(prompt, { ...opts, session_id: sess });
    }
  } as unknown as GptTransport;

  const engine = new ClosedLoopEngine(simulatedGpt, agTransport, {
    cwd: workspaceDir,
    effort: 'low',
    defaultTimeoutMs: 120000
  });

  try {
    const report = await engine.runLoop('Inicie o loop autônomo', {
      maxTurns: 3,
      loopId: `integration-loop-${Date.now()}`
    });

    assert.equal(report.status, 'COMPLETED');
    assert.equal(report.total_turns, 3);
    assert.equal(report.manual_copy_paste_operations, 0);
    assert.ok(fs.existsSync(targetFile), 'Target file must exist after 3 turns');

    const fileContent = fs.readFileSync(targetFile, 'utf8').replace(/\r\n/g, '\n').trim();
    const expected = 'GPT-LOOP-1\nGPT-LOOP-2\nGPT-LOOP-3';
    assert.equal(fileContent, expected, `Expected file content to be "${expected}", got "${fileContent}"`);
  } finally {
    if (fs.existsSync(targetFile)) {
      fs.unlinkSync(targetFile);
    }
  }
});
