import test from 'node:test';
import assert from 'node:assert/strict';
import { AcpLabClient } from '../../src/client/acp-lab-client.js';

test('AcpLabClient - live ACP-LAB health verification', { timeout: 15000 }, async () => {
  const client = new AcpLabClient();
  const health = await client.health(5000);
  console.log('[LIVE ACP-LAB HEALTH RESPONSE]:', JSON.stringify(health, null, 2));

  assert.equal(health.status, 'ok');
  assert.equal(health.initialized, true);
  assert.equal(health.isProcessing, false);
  assert.equal(typeof health.sessionsCount, 'number');
  assert.ok(health.health, 'Expected health object');
});
