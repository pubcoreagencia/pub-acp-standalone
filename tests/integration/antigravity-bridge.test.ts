import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AntigravityTransport, AntigravityBridge } from '../../src/antigravity/index.js';

test('Antigravity Transport & Bridge — Vertical Slices & Zero Copy/Paste Loop', { timeout: 300000 }, async (t) => {
  const bridge = new AntigravityBridge();
  const transport = bridge.getTransport();

  // Pre-flight health
  const health = await transport.health();
  if (health.status !== 'ok') {
    t.skip(`Antigravity CLI is not available on host: ${health.error}`);
    return;
  }

  const workspaceDir = process.cwd();
  const targetFile = path.resolve(workspaceDir, 'TEST_BRIDGE.txt');

  // Limpeza prévia caso exista
  if (fs.existsSync(targetFile)) {
    fs.unlinkSync(targetFile);
  }

  const sessionId = `test-bridge-session-${Date.now()}`;

  // --------------------------------------------------------------------------
  // SLICE 1: Criar TEST_BRIDGE.txt com "ACP-AG-TURN-1"
  // --------------------------------------------------------------------------
  console.log('\n[SLICE 1] Executing Turn 1 via AntigravityBridge...');
  const prompt1 = `Crie exatamente o arquivo no caminho "${targetFile}" contendo apenas o texto:\nACP-AG-TURN-1`;

  const res1 = await bridge.executeTurn(sessionId, prompt1, {
    cwd: workspaceDir,
    effort: 'low',
    timeout_ms: 120000
  });

  console.log('[SLICE 1 RESULT]:', {
    status: res1.status,
    conversation_id: res1.conversation_id,
    duration_ms: res1.duration_ms,
    response_snippet: res1.response.slice(0, 100)
  });

  assert.equal(res1.status, 'COMPLETED');
  assert.ok(res1.conversation_id, 'Expected conversation_id to be populated');
  assert.ok(fs.existsSync(targetFile), `TEST_BRIDGE.txt must physically exist at ${targetFile} after Turn 1`);

  const content1 = fs.readFileSync(targetFile, 'utf8').trim();
  assert.equal(content1, 'ACP-AG-TURN-1', `Expected content "ACP-AG-TURN-1", got "${content1}"`);

  // --------------------------------------------------------------------------
  // SLICE 2: Multi-turn na MESMA conversa — Ler e acrescentar "ACP-AG-TURN-2"
  // --------------------------------------------------------------------------
  console.log('\n[SLICE 2] Executing Turn 2 (multi-turn) via AntigravityBridge...');
  const prompt2 = `Leia o arquivo "${targetFile}" e acrescente uma nova linha contendo exatamente:\nACP-AG-TURN-2`;

  const res2 = await bridge.executeTurn(sessionId, prompt2, {
    cwd: workspaceDir,
    effort: 'low',
    timeout_ms: 120000
  });

  console.log('[SLICE 2 RESULT]:', {
    status: res2.status,
    conversation_id: res2.conversation_id,
    duration_ms: res2.duration_ms,
    response_snippet: res2.response.slice(0, 100)
  });

  assert.equal(res2.status, 'COMPLETED');
  assert.equal(res2.conversation_id, res1.conversation_id, 'Must reuse the exact same conversation_id');

  const content2 = fs.readFileSync(targetFile, 'utf8').replace(/\r\n/g, '\n').trim();
  const expectedContent = 'ACP-AG-TURN-1\nACP-AG-TURN-2';
  assert.equal(content2, expectedContent, `Expected content "${expectedContent}", got "${content2}"`);

  // --------------------------------------------------------------------------
  // SLICE 3: Programmatic Loop (Orchestrator Simulation)
  // --------------------------------------------------------------------------
  console.log('\n[SLICE 3] Executing programmatic loop simulation...');
  const loopSessionId = `test-loop-session-${Date.now()}`;
  const loopResults = await bridge.runLoop(
    loopSessionId,
    [
      'Diga exatamente a palavra: LOOP-STEP-1',
      (prev) => `Você disse "${prev.response.trim()}". Agora diga exatamente: LOOP-STEP-2`
    ],
    { effort: 'low', timeout_ms: 60000 }
  );

  assert.equal(loopResults.length, 2);
  assert.equal(loopResults[0].status, 'COMPLETED');
  assert.equal(loopResults[1].status, 'COMPLETED');
  assert.ok(loopResults[0].response.includes('LOOP-STEP-1'));
  assert.ok(loopResults[1].response.includes('LOOP-STEP-2'));
  assert.equal(loopResults[0].conversation_id, loopResults[1].conversation_id);

  console.log('[SLICE 3 PASS] Loop completed successfully without human intervention.');

  // Cleanup file
  if (fs.existsSync(targetFile)) {
    fs.unlinkSync(targetFile);
  }
});
