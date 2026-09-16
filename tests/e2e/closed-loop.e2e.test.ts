import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ClosedLoopEngine } from '../../src/bridge/index.js';
import { GptTransport } from '../../src/gpt/index.js';
import { AntigravityTransport } from '../../src/antigravity/index.js';

test('Real E2E: GPT Free <-> ACP-STANDALONE <-> Antigravity Closed Loop', { timeout: 600000 }, async (t) => {
  const gptTransport = new GptTransport({ baseUrl: 'http://127.0.0.1:5125' });
  const agTransport = new AntigravityTransport();

  // Pre-flight 1: AG health
  const agHealth = await agTransport.health();
  if (agHealth.status !== 'ok') {
    t.skip(`Antigravity is not available: ${agHealth.error}`);
    return;
  }

  // Pre-flight 2: GPT health
  const gptHealth = await gptTransport.health(5000);
  if (gptHealth.status !== 'ok') {
    t.skip(`Live GPT endpoint (ACP-LAB on 5125) is not available: ${gptHealth.error || gptHealth.humanRequiredReason}`);
    return;
  }

  const workspaceDir = process.cwd();
  const targetFile = path.resolve(workspaceDir, 'TEST_CLOSED_LOOP.txt');

  if (fs.existsSync(targetFile)) {
    fs.unlinkSync(targetFile);
  }

  const engine = new ClosedLoopEngine(gptTransport, agTransport, {
    cwd: workspaceDir,
    effort: 'low',
    defaultTimeoutMs: 120000
  });

  try {
    console.log('\n[REAL E2E] Starting autonomous 3-turn Closed Loop between GPT Free and Antigravity...');

    // Turn 1 prompt sent to GPT Free:
    const initialInstruction = `Crie exatamente o arquivo no caminho "${targetFile}" contendo apenas o texto: GPT-LOOP-1. Responda apenas com a instrução de execução para o Antigravity.`;

    const report = await engine.runLoop(initialInstruction, {
      maxTurns: 3,
      loopId: `real-e2e-loop-${Date.now()}`,
      turnPromptBuilder: (prevResponse, turn) => {
        if (turn === 2) {
          return `O Antigravity concluiu a instrução anterior. Agora instrua o Antigravity a ler "${targetFile}" e acrescentar a linha "GPT-LOOP-2". Responda apenas com a instrução de execução.`;
        } else {
          return `O Antigravity concluiu a instrução anterior. Agora instrua o Antigravity a ler "${targetFile}" e acrescentar a linha "GPT-LOOP-3". Responda apenas com a instrução de execução.`;
        }
      }
    });

    console.log('\n[REAL E2E RESULT REPORT]:', JSON.stringify({
      loop_id: report.loop_id,
      status: report.status,
      total_turns: report.total_turns,
      total_duration_ms: report.total_duration_ms,
      manual_copy_paste_operations: report.manual_copy_paste_operations,
      error: report.error,
      turns: report.turns
    }, null, 2));

    assert.equal(report.status, 'COMPLETED');
    assert.equal(report.total_turns, 3);
    assert.equal(report.manual_copy_paste_operations, 0);
    assert.ok(fs.existsSync(targetFile), 'Target file must exist physically');

    const fileContent = fs.readFileSync(targetFile, 'utf8').replace(/\r\n/g, '\n').trim();
    assert.ok(fileContent.includes('GPT-LOOP-1'), 'File must contain GPT-LOOP-1');
    assert.ok(fileContent.includes('GPT-LOOP-2'), 'File must contain GPT-LOOP-2');
    assert.ok(fileContent.includes('GPT-LOOP-3'), 'File must contain GPT-LOOP-3');
    console.log('[REAL E2E PASS] All 3 turns autonomously orchestrated by real GPT Free and executed by Antigravity!');
  } finally {
    if (fs.existsSync(targetFile)) {
      fs.unlinkSync(targetFile);
    }
  }
});
