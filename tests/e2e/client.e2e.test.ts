import test from 'node:test';
import assert from 'node:assert/strict';
import { AcpLabClient } from '../../src/client/acp-lab-client.js';

test('AcpLabClient - E2E smoke placeholder for Phase 1', async () => {
  const client = new AcpLabClient();
  assert.ok(client);
  assert.equal(typeof client.health, 'function');
  assert.equal(typeof client.prompt, 'function');
});
