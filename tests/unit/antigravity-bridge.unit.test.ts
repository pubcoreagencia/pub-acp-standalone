import test from 'node:test';
import assert from 'node:assert/strict';
import { AntigravityTransport, AntigravityBridge } from '../../src/antigravity/index.js';

test('AntigravityTransport - unit test handling invalid/unreachable CLI path', async () => {
  const invalidTransport = new AntigravityTransport({
    agyPath: 'C:\\NonExistentPath\\agy.exe',
    defaultTimeoutMs: 2000
  });

  const health = await invalidTransport.health();
  assert.equal(health.status, 'error');
  assert.ok(health.error?.includes('Failed to spawn agy'));

  const res = await invalidTransport.sendPrompt('Test prompt', { timeout_ms: 2000 });
  assert.equal(res.status, 'FAILED');
  assert.equal(res.error?.code, 'SPAWN_ERROR');
});

test('AntigravityBridge - unit test session state tracking and turn sequencing', async () => {
  // Mock transport implementing sendPrompt
  const mockTransport = {
    health: async () => ({ status: 'ok' as const, agyPath: 'mock' }),
    sendPrompt: async (prompt: string, opts: any = {}) => ({
      request_id: opts.request_id || 'req-mock',
      session_id: opts.session_id || 'session-mock',
      conversation_id: opts.conversation_id || 'conv-mock-123',
      status: 'COMPLETED' as const,
      response: `MOCK_ECHO: ${prompt}`,
      duration_ms: 10
    }),
    sendPromptInConversation: async () => { throw new Error('not used'); }
  } as unknown as AntigravityTransport;

  const bridge = new AntigravityBridge(mockTransport);
  const sessionId = 'unit-session-001';

  // Turn 1
  const t1 = await bridge.executeTurn(sessionId, 'Turn 1 prompt');
  assert.equal(t1.status, 'COMPLETED');
  assert.equal(t1.conversation_id, 'conv-mock-123');
  assert.equal(t1.response, 'MOCK_ECHO: Turn 1 prompt');

  // Turn 2 in same session
  const t2 = await bridge.executeTurn(sessionId, 'Turn 2 prompt');
  assert.equal(t2.status, 'COMPLETED');
  assert.equal(t2.conversation_id, 'conv-mock-123');

  const sessionRecord = bridge.getSession(sessionId);
  assert.ok(sessionRecord);
  assert.equal(sessionRecord.conversationId, 'conv-mock-123');
  assert.equal(sessionRecord.history.length, 2);
  assert.equal(sessionRecord.history[0].turn, 1);
  assert.equal(sessionRecord.history[1].turn, 2);
});

test('AntigravityBridge - unit test loop halts on failed turn', async () => {
  let callCount = 0;
  const failingTransport = {
    health: async () => ({ status: 'ok' as const, agyPath: 'mock' }),
    sendPrompt: async () => {
      callCount++;
      return {
        request_id: 'req-fail',
        session_id: 'session-fail',
        conversation_id: null,
        status: 'FAILED' as const,
        response: '',
        duration_ms: 5,
        error: { code: 'TEST_FAIL', message: 'Simulated failure' }
      };
    },
    sendPromptInConversation: async () => { throw new Error('not used'); }
  } as unknown as AntigravityTransport;

  const bridge = new AntigravityBridge(failingTransport);
  const loopRes = await bridge.runLoop('fail-session', ['p1', 'p2', 'p3']);

  assert.equal(loopRes.length, 1);
  assert.equal(callCount, 1);
  assert.equal(loopRes[0].status, 'FAILED');
});
