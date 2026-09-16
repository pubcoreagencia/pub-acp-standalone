import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AcpLabClient } from '../../src/client/acp-lab-client.js';

test('AcpLabClient - health() contract with mock server', async () => {
  const mockServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        initialized: true,
        isProcessing: false,
        sessionsCount: 0,
        health: {
          transport_healthy: true,
          browser_healthy: true,
          cdp_connected: true,
          backend_type: 'mock'
        }
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve()));
  const address = mockServer.address() as any;
  const client = new AcpLabClient({ baseUrl: `http://127.0.0.1:${address.port}` });

  try {
    const health = await client.health();
    assert.equal(health.status, 'ok');
    assert.equal(health.initialized, true);
    assert.equal(health.isProcessing, false);
    assert.equal(typeof health.health, 'object');
  } finally {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  }
});

test('AcpLabClient - health() contract handles HTTP error', async () => {
  const mockServer = http.createServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'UNAVAILABLE' }));
  });

  await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve()));
  const address = mockServer.address() as any;
  const client = new AcpLabClient({ baseUrl: `http://127.0.0.1:${address.port}` });

  try {
    await assert.rejects(
      async () => await client.health(),
      (err: any) => {
        assert.equal(err.code, 'HTTP_ERROR');
        assert.equal(err.status, 503);
        return true;
      }
    );
  } finally {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  }
});
