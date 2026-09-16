import test from 'node:test';
import assert from 'node:assert/strict';
import { AcpLabClient } from '../../src/client/acp-lab-client.js';

test('AcpLabClient - live ACP-LAB health verification', { timeout: 15000 }, async (t) => {
  const client = new AcpLabClient();
  let health;
  try {
    health = await client.health(5000);
  } catch (err: any) {
    t.skip(`Live ACP-LAB server is not running: ${err.message}`);
    return;
  }
  console.log('[LIVE ACP-LAB HEALTH RESPONSE]:', JSON.stringify(health, null, 2));

  assert.equal(health.status, 'ok');
  assert.equal(health.initialized, true);
  assert.equal(typeof health.isProcessing, 'boolean');
  assert.equal(typeof health.sessionsCount, 'number');
  assert.ok(health.health, 'Expected health object');
});
