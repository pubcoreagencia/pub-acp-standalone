import test from 'node:test';
import assert from 'node:assert/strict';
import { AcpLabClient } from '../../src/client/acp-lab-client.js';

test('Real Prompt E2E — First turn, second turn continuity, idempotency and error contracts', { timeout: 300000 }, async (t) => {
  const client = new AcpLabClient();

  // Pre-flight: verify ACP-LAB is reachable
  let health;
  try {
    health = await client.health(10000);
  } catch (err: any) {
    t.skip(`ACP-LAB is not available: ${err.message}`);
    return;
  }

  assert.equal(health.status, 'ok', 'ACP-LAB status should be ok');

  // --------------------------------------------------------------------------
  // ETAPA 3 — REAL PROMPT E2E (Turn 1)
  // --------------------------------------------------------------------------
  const sessionId = 'standalone-e2e-session';
  const requestId1 = 'standalone-req-turn1-001';
  const prompt1 = 'Responda exatamente com: ACP-STANDALONE-E2E-OK';

  console.log(`\n[STAGE 3] Sending Turn 1 prompt to session "${sessionId}"...`);
  const res1 = await client.prompt({
    request_id: requestId1,
    session_id: sessionId,
    prompt: prompt1,
    timeout_ms: 120000
  });

  console.log('[STAGE 3 RESULT]:', {
    request_id: res1.request_id,
    session_id: res1.session_id,
    status: res1.status,
    response: res1.response,
    duration_ms: res1.duration_ms,
    metadata: res1.metadata
  });

  assert.equal(res1.status, 'completed');
  assert.equal(res1.request_id, requestId1);
  assert.equal(res1.session_id, sessionId);
  assert.ok(res1.response, 'Expected response text to be populated');
  assert.ok(res1.response.includes('ACP-STANDALONE-E2E-OK'), `Expected response to include ACP-STANDALONE-E2E-OK, got: "${res1.response}"`);
  assert.ok(typeof res1.duration_ms === 'number', 'Expected duration_ms');

  // --------------------------------------------------------------------------
  // ETAPA 4 — SEGUNDO TURN NA MESMA SESSÃO (Continuity)
  // --------------------------------------------------------------------------
  const requestId2 = 'standalone-req-turn2-002';
  const prompt2 = 'Qual foi o código exato que você acabou de responder? Responda somente com esse código.';

  console.log(`\n[STAGE 4] Sending Turn 2 continuity prompt to same session "${sessionId}"...`);
  const res2 = await client.prompt({
    request_id: requestId2,
    session_id: sessionId,
    prompt: prompt2,
    timeout_ms: 120000
  });

  console.log('[STAGE 4 RESULT]:', {
    request_id: res2.request_id,
    session_id: res2.session_id,
    status: res2.status,
    response: res2.response,
    duration_ms: res2.duration_ms,
    metadata: res2.metadata
  });

  assert.equal(res2.status, 'completed');
  assert.equal(res2.request_id, requestId2);
  assert.equal(res2.session_id, sessionId);
  assert.ok(res2.response, 'Expected response text to be populated');
  assert.ok(res2.response.includes('ACP-STANDALONE-E2E-OK'), `Expected second response to maintain continuity and include ACP-STANDALONE-E2E-OK, got: "${res2.response}"`);

  // --------------------------------------------------------------------------
  // ETAPA 5 — REQUEST_ID E IDEMPOTÊNCIA
  // --------------------------------------------------------------------------
  const idempotencyRequestId = 'standalone-idempotency-e2e-001';
  const idempotencyPrompt = 'Responda exatamente com: IDEMPOTENCY-TEST-TOKEN';

  console.log(`\n[STAGE 5] Sending initial request for idempotency test (request_id: "${idempotencyRequestId}")...`);
  const idempRes1 = await client.prompt({
    request_id: idempotencyRequestId,
    session_id: 'standalone-idempotency-session',
    prompt: idempotencyPrompt,
    timeout_ms: 120000
  });

  console.log('[STAGE 5 - Call 1 Result]:', {
    request_id: idempRes1.request_id,
    status: idempRes1.status,
    response: idempRes1.response
  });

  assert.equal(idempRes1.status, 'completed');
  assert.equal(idempRes1.request_id, idempotencyRequestId);
  assert.ok(idempRes1.response?.includes('IDEMPOTENCY-TEST-TOKEN'));

  console.log(`\n[STAGE 5] Resending IDENTICAL request_id ("${idempotencyRequestId}")...`);
  const startTimeResend = Date.now();
  const idempRes2 = await client.prompt({
    request_id: idempotencyRequestId,
    session_id: 'standalone-idempotency-session',
    prompt: idempotencyPrompt,
    timeout_ms: 120000
  });
  const resendElapsed = Date.now() - startTimeResend;

  console.log(`[STAGE 5 - Call 2 Result] (returned in ${resendElapsed}ms):`, {
    request_id: idempRes2.request_id,
    status: idempRes2.status,
    response: idempRes2.response
  });

  assert.equal(idempRes2.status, 'completed');
  assert.equal(idempRes2.request_id, idempotencyRequestId);
  assert.equal(idempRes2.response, idempRes1.response, 'Idempotent replay should return identical response without re-executing prompt physically');
  assert.ok(resendElapsed < 1000, `Expected instant cached replay without physical re-execution, took ${resendElapsed}ms`);

  // --------------------------------------------------------------------------
  // ETAPA 6 — ERROS: INVALID REQUEST & IDEMPOTENCY CONFLICT
  // --------------------------------------------------------------------------
  console.log('\n[STAGE 6] Testing invalid request contract (empty prompt)...');
  await assert.rejects(
    async () => {
      await client.prompt({
        prompt: ''
      });
    },
    (err: any) => {
      console.log('[STAGE 6 - Invalid prompt caught]:', err.code, err.message);
      assert.equal(err.code, 'INVALID_REQUEST');
      return true;
    }
  );

  console.log('\n[STAGE 6] Testing idempotency conflict (same request_id, different prompt)...');
  await assert.rejects(
    async () => {
      await client.prompt({
        request_id: idempotencyRequestId,
        prompt: 'Completely different prompt payload trying to hijack request_id'
      });
    },
    (err: any) => {
      console.log('[STAGE 6 - Idempotency conflict caught]:', err.code, err.message);
      assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
      return true;
    }
  );
});
