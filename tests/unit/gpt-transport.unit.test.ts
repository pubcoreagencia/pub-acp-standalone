import test from 'node:test';
import assert from 'node:assert/strict';
import { GptTransport } from '../../src/gpt/index.js';

function installFetch(handler: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = original;
  };
}

test('GptTransport - health and chat completion use OpenAI-compatible endpoints', async () => {
  const calls: Array<{ url: string; method: string; body?: any; headers: Headers }> = [];

  const restore = installFetch((async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method || 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers
    });

    if (url.endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'gpt-test' }] })
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-test',
        choices: [{
          message: { role: 'assistant', content: '{"action":"complete","message":"done"}' },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 }
      })
    } as Response;
  }) as typeof fetch);

  try {
    const transport = new GptTransport({
      baseUrl: 'http://127.0.0.1:20128/v1',
      apiKey: 'test-key',
      model: 'gpt-test'
    });

    const health = await transport.health();
    assert.equal(health.status, 'ok');
    assert.equal(health.initialized, true);

    const res = await transport.sendPrompt('Hello world', {
      request_id: 'req-1',
      session_id: 'session-1'
    });

    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.request_id, 'chatcmpl-test');
    assert.equal(res.session_id, 'session-1');
    assert.equal(res.text, '{"action":"complete","message":"done"}');
    assert.equal(res.metadata?.model, 'gpt-test');

    assert.equal(calls[0].url, 'http://127.0.0.1:20128/v1/models');
    assert.equal(calls[0].headers.get('authorization'), 'Bearer test-key');
    assert.equal(calls[1].url, 'http://127.0.0.1:20128/v1/chat/completions');
    assert.equal(calls[1].body.model, 'gpt-test');
    assert.deepEqual(calls[1].body.messages, [{ role: 'user', content: 'Hello world' }]);
  } finally {
    restore();
  }
});

test('GptTransport - environment configuration is supported without exposing the API key', async () => {
  const oldBase = process.env.GPT_BASE_URL;
  const oldKey = process.env.GPT_API_KEY;
  const oldModel = process.env.GPT_MODEL;

  process.env.GPT_BASE_URL = 'http://localhost:9999/v1';
  process.env.GPT_API_KEY = 'secret-value';
  process.env.GPT_MODEL = 'test-model';

  const restore = installFetch((async (input, init) => {
    assert.equal(String(input), 'http://localhost:9999/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer secret-value');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-env',
        choices: [{ message: { role: 'assistant', content: '{"action":"complete","message":"env"}' } }]
      })
    } as Response;
  }) as typeof fetch);

  try {
    const transport = new GptTransport();
    const res = await transport.sendPrompt('env-test');
    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.metadata?.model, 'test-model');
    assert.equal(JSON.stringify(res.metadata).includes('secret-value'), false);
  } finally {
    restore();
    if (oldBase === undefined) delete process.env.GPT_BASE_URL; else process.env.GPT_BASE_URL = oldBase;
    if (oldKey === undefined) delete process.env.GPT_API_KEY; else process.env.GPT_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.GPT_MODEL; else process.env.GPT_MODEL = oldModel;
  }
});

test('GptTransport - fails clearly when no model is configured', async () => {
  const oldGpt = process.env.GPT_MODEL;
  const oldOpenAI = process.env.OPENAI_MODEL;
  const oldRouter = process.env.OPENROUTER_MODEL;
  delete process.env.GPT_MODEL;
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENROUTER_MODEL;

  try {
    const transport = new GptTransport({ baseUrl: 'http://localhost:9999/v1' });
    const res = await transport.sendPrompt('missing model');
    assert.equal(res.status, 'FAILED');
    assert.equal(res.error?.code, 'CONFIG_ERROR');
  } finally {
    if (oldGpt === undefined) delete process.env.GPT_MODEL; else process.env.GPT_MODEL = oldGpt;
    if (oldOpenAI === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = oldOpenAI;
    if (oldRouter === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = oldRouter;
  }
});

test('GptTransport - classifies timeout and network failures', async () => {
  const original = globalThis.fetch;

  try {
    globalThis.fetch = (async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }) as typeof fetch;

    const transport = new GptTransport({
      baseUrl: 'http://localhost:9999/v1',
      model: 'test-model'
    });
    const timeoutResult = await transport.sendPrompt('timeout');
    assert.equal(timeoutResult.status, 'TIMEOUT');

    globalThis.fetch = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as typeof fetch;

    const networkResult = await transport.sendPrompt('network');
    assert.equal(networkResult.status, 'FAILED');
    assert.equal(networkResult.error?.code, 'NETWORK_ERROR');
  } finally {
    globalThis.fetch = original;
  }
});
