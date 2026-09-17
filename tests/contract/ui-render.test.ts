import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlRoomServer } from '../../src/server/ControlRoomServer.js';

test('Web UI Rendering Contract - Serves index.html, styles.css, app.js with required panels', async () => {
  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1'
  });

  const { url } = await server.start();

  try {
    // 1. GET / -> index.html
    const resHtml = await fetch(`${url}/`);
    assert.equal(resHtml.status, 200);
    assert.ok(resHtml.headers.get('content-type')?.includes('text/html'));
    const htmlText = await resHtml.text();

    // Verify critical UI elements and panels
    assert.ok(htmlText.includes('PUB ACP CONTROL ROOM'));
    assert.ok(htmlText.includes('DEMO MODE'));
    assert.ok(htmlText.includes('LIVE EVENT TIMELINE'));
    assert.ok(htmlText.includes('GPT REASONING & DECISION'));
    assert.ok(htmlText.includes('ANTIGRAVITY EXECUTION'));
    assert.ok(htmlText.includes('VALIDATION MATRIX'));
    assert.ok(htmlText.includes('DEPLOY'));
    assert.ok(htmlText.includes('WORKSPACE'));
    assert.ok(htmlText.includes('PAUSE (UNAVAILABLE)'));
    assert.ok(htmlText.includes('STOP (UNAVAILABLE)'));
    assert.ok(htmlText.includes('NOVA EXECUÇÃO'));
    assert.ok(htmlText.includes('select-project'));
    assert.ok(htmlText.includes('select-conversation'));
    assert.ok(htmlText.includes('input-instruction'));
    assert.ok(htmlText.includes('btn-dispatch'));

    // 2. GET /styles.css
    const resCss = await fetch(`${url}/styles.css`);
    assert.equal(resCss.status, 200);
    assert.ok(resCss.headers.get('content-type')?.includes('text/css'));
    const cssText = await resCss.text();
    assert.ok(cssText.includes('.timeline-panel'));
    assert.ok(cssText.includes('.state-pill'));
    assert.ok(cssText.includes('.dispatch-panel'));
    assert.ok(cssText.includes('.btn-primary'));

    // 3. GET /app.js
    const resJs = await fetch(`${url}/app.js`);
    assert.equal(resJs.status, 200);
    assert.ok(resJs.headers.get('content-type')?.includes('application/javascript'));
    const jsText = await resJs.text();
    assert.ok(jsText.includes('fetchRuns'));
    assert.ok(jsText.includes('connectSSE'));
    assert.ok(jsText.includes('renderRunDetail'));
    assert.ok(jsText.includes('loadProjects'));
    assert.ok(jsText.includes('loadConversations'));
  } finally {
    await server.stop();
  }
});
