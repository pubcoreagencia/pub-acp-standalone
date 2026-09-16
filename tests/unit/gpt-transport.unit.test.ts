import test from 'node:test';
import assert from 'node:assert/strict';
import { GptTransport } from '../../src/gpt/index.js';
import { AcpLabClient } from '../../src/client/acp-lab-client.js';

test('GptTransport - unit test maps responses correctly', async () => {
  const mockClient = {
    health: async () => ({
      status: 'ok',
      initialized: true,
      isProcessing: false,
      sessionsCount: 1,
      health: { cdp_connected: true }
    }),
    prompt: async (req: any) => ({
      status: 'completed',
      request_id: req.request_id,
      session_id: req.session_id,
      text: `MOCK_GPT_REPLY: ${req.prompt}`,
      response: `MOCK_GPT_REPLY: ${req.prompt}`,
      duration_ms: 15,
      metadata: { mock: true }
    })
  } as unknown as AcpLabClient;

  const transport = new GptTransport({ client: mockClient });

  const health = await transport.health();
  assert.equal(health.status, 'ok');
  assert.equal(health.initialized, true);

  const res = await transport.sendPrompt('Hello world', {
    request_id: 'test-req-1',
    session_id: 'test-sess-1'
  });

  assert.equal(res.status, 'COMPLETED');
  assert.equal(res.request_id, 'test-req-1');
  assert.equal(res.session_id, 'test-sess-1');
  assert.equal(res.text, 'MOCK_GPT_REPLY: Hello world');
  assert.equal(res.duration_ms, 15);
});

test('GptTransport - unit test handles error classifications', async () => {
  const failingClient = {
    health: async () => {
      const err = new Error('connect ECONNREFUSED');
      (err as any).code = 'NETWORK_ERROR';
      throw err;
    },
    prompt: async () => {
      const err = new Error('Prompt timed out');
      (err as any).code = 'TIMEOUT';
      throw err;
    }
  } as unknown as AcpLabClient;

  const transport = new GptTransport({ client: failingClient });

  const health = await transport.health();
  assert.equal(health.status, 'error');
  assert.ok(health.error?.includes('ECONNREFUSED'));

  const res = await transport.sendPrompt('Hello');
  assert.equal(res.status, 'TIMEOUT');
  assert.equal(res.error?.code, 'TIMEOUT');
});
