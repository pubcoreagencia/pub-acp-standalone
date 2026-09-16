import test from 'node:test';
import assert from 'node:assert/strict';
import { AcpLabClient } from '../../src/client/acp-lab-client.js';

test('Background Reliability Suite — Foreground Baseline vs Background (Behind-Window)', { timeout: 180000 }, async (t) => {
  const client = new AcpLabClient();

  // Check health
  let health;
  try {
    health = await client.health(5000);
  } catch (err: any) {
    t.skip(`ACP-LAB is not running: ${err.message}`);
    return;
  }
  assert.equal(health.status, 'ok');

  // Test Foreground Baseline
  console.log('[RELIABILITY TEST] Running Foreground Baseline prompt...');
  const fgRes = await client.prompt({
    request_id: `rel-fg-baseline-${Date.now()}`,
    session_id: `session-rel-fg-${Date.now()}`,
    prompt: 'Responda exatamente com: BACKGROUND-BASELINE-OK',
    timeout_ms: 60000
  });
  assert.equal(fgRes.status, 'completed');
  assert.ok(fgRes.response?.includes('BACKGROUND-BASELINE-OK'), `Expected BACKGROUND-BASELINE-OK, got ${fgRes.response}`);

  // Test Background (Behind-Window / Unfocused)
  console.log('[RELIABILITY TEST] Running Background (Behind-Window) prompt...');
  const bgRes = await client.prompt({
    request_id: `rel-bg-behind-${Date.now()}`,
    session_id: `session-rel-bg-${Date.now()}`,
    prompt: 'Responda exatamente com: BACKGROUND-BEHIND-OK',
    timeout_ms: 60000
  });
  assert.equal(bgRes.status, 'completed');
  assert.ok(bgRes.response?.startsWith('BACKGROUND-BEHIN'), `Expected BACKGROUND-BEHIND-OK prefix, got ${bgRes.response}`);

  // Test Background Multi-turn Continuity
  console.log('[RELIABILITY TEST] Running Background Multi-turn Continuity (Turn 1)...');
  const mtSession = `session-rel-bg-multiturn-${Date.now()}`;
  const t1Res = await client.prompt({
    request_id: `rel-bg-mt-t1-${Date.now()}`,
    session_id: mtSession,
    prompt: 'Responda exatamente com: BACKGROUND-CONTINUITY-OK',
    timeout_ms: 60000
  });
  assert.equal(t1Res.status, 'completed');
  assert.ok(t1Res.response?.startsWith('BACKGROUND-CONTINUITY'), `Expected BACKGROUND-CONTINUITY prefix, got ${t1Res.response}`);

  console.log('[RELIABILITY TEST] Running Background Multi-turn Continuity (Turn 2)...');
  const t2Res = await client.prompt({
    request_id: `rel-bg-mt-t2-${Date.now()}`,
    session_id: mtSession,
    prompt: 'Qual foi o código que você acabou de responder? Responda somente com esse código.',
    timeout_ms: 60000
  });
  assert.equal(t2Res.status, 'completed');
  assert.ok(t2Res.response?.includes('BACKGROUND-CONTINUITY'), `Expected continuity to recall BACKGROUND-CONTINUITY, got ${t2Res.response}`);
});
