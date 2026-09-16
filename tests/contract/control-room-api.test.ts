import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlRoomServer } from '../../src/server/ControlRoomServer.js';
import { ClosedLoopEngine } from '../../src/bridge/index.js';
import { EventBus } from '../../src/observability/EventBus.js';
import { MemoryRunStore } from '../../src/observability/RunStore.js';

test('ControlRoomServer - API endpoints and SSE stream contract', async () => {
  const eventBus = new EventBus();
  const runStore = new MemoryRunStore();
  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    eventBus,
    runStore
  });

  const { url } = await server.start();

  try {
    // 1. Initial /api/runs is empty
    const resInitial = await fetch(`${url}/api/runs`);
    assert.equal(resInitial.status, 200);
    const runs = await resInitial.json();
    assert.deepEqual(runs, []);

    // 2. Start demo run via POST /api/demo/start
    const resDemo = await fetch(`${url}/api/demo/start`, { method: 'POST' });
    assert.equal(resDemo.status, 201);
    const demoData = await resDemo.json() as { runId: string };
    assert.ok(demoData.runId);

    // 3. GET /api/runs shows demo run
    const resRunsAfter = await fetch(`${url}/api/runs`);
    assert.equal(resRunsAfter.status, 200);
    const runsAfter = await resRunsAfter.json() as any[];
    assert.equal(runsAfter.length, 1);
    assert.equal(runsAfter[0].runId, demoData.runId);

    // 4. GET /api/runs/:runId
    const resRunDetail = await fetch(`${url}/api/runs/${demoData.runId}`);
    assert.equal(resRunDetail.status, 200);
    const runDetail = await resRunDetail.json() as any;
    assert.equal(runDetail.runId, demoData.runId);

    // 5. GET /api/runs/:runId/events
    const resEvents = await fetch(`${url}/api/runs/${demoData.runId}/events`);
    assert.equal(resEvents.status, 200);
    const events = await resEvents.json() as any[];
    assert.ok(Array.isArray(events));

    // 6. Test SSE stream handshake and reception
    let sseReceivedChunk = '';
    const sseReq = await new Promise<import('node:http').ClientRequest>((resolve, reject) => {
      const parsedUrl = new URL(`${url}/api/runs/${demoData.runId}/stream`);
      const req = import('node:http').then(http => {
        const clientReq = http.request(parsedUrl, res => {
          assert.equal(res.statusCode, 200);
          assert.ok(res.headers['content-type']?.includes('text/event-stream'));
          res.on('data', chunk => {
            sseReceivedChunk += chunk.toString();
          });
        });
        clientReq.on('error', reject);
        clientReq.end();
        resolve(clientReq);
      });
    });

    // Wait for SSE handshake chunk
    await new Promise(r => setTimeout(r, 50));

    // Publish a live event through EventBus while SSE is open
    eventBus.publish({
      id: 'sse-live-event-1',
      runId: demoData.runId,
      timestamp: new Date().toISOString(),
      type: 'AG_STARTED',
      turn: 1,
      summary: 'Testing SSE transport live reception'
    });

    await new Promise(r => setTimeout(r, 80));
    assert.ok(sseReceivedChunk.includes('data:'));
    assert.ok(sseReceivedChunk.includes('Testing SSE transport live reception'));

    sseReq.destroy();
  } finally {
    await server.stop();
  }
});

test('Real Event Feed - ClosedLoopEngine connected to EventBus, RunStore, and SSE', async () => {
  const eventBus = new EventBus();
  const runStore = new MemoryRunStore();
  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    eventBus,
    runStore
  });

  const { url } = await server.start();

  try {
    const receivedEventsOverBus: string[] = [];
    eventBus.subscribe('*', evt => {
      receivedEventsOverBus.push(evt.type);
    });

    // Real ClosedLoopEngine instance wired directly to the real EventBus
    const loopId = 'real-closed-loop-run-001';
    const engine = new ClosedLoopEngine(
      {
        health: async () => ({ status: 'ok', initialized: true }),
        createSession: () => 'sess-1',
        sendPrompt: async (prompt, opts) => ({
          request_id: opts?.request_id || 'req-1',
          session_id: opts?.session_id || 'sess-1',
          status: 'COMPLETED',
          text: 'Scaffold application test files',
          duration_ms: 15
        }),
        continueSession: async (sess, prompt, opts) => ({
          request_id: opts?.request_id || 'req-2',
          session_id: sess,
          status: 'COMPLETED',
          text: 'Verify test results',
          duration_ms: 15
        })
      },
      {
        health: async () => ({ status: 'ok', agyPath: 'mock' }),
        sendPrompt: async (prompt, opts) => ({
          request_id: opts?.request_id || 'ag-req',
          session_id: opts?.session_id || 'ag-sess',
          conversation_id: 'conv-real-test',
          status: 'COMPLETED',
          response: 'Wrote files and verified test suite.',
          duration_ms: 25
        })
      },
      {
        eventBus,
        projectName: 'Real ClosedLoop Verification Run'
      }
    );

    // Open SSE client stream for this run BEFORE execution
    let sseRealText = '';
    const sseReq = await new Promise<import('node:http').ClientRequest>((resolve, reject) => {
      const parsedUrl = new URL(`${url}/api/runs/${loopId}/stream`);
      import('node:http').then(http => {
        const clientReq = http.request(parsedUrl, res => {
          assert.equal(res.statusCode, 200);
          res.on('data', chunk => {
            sseRealText += chunk.toString();
          });
        });
        clientReq.on('error', reject);
        clientReq.end();
        resolve(clientReq);
      });
    });

    // Execute real ClosedLoopEngine
    const report = await engine.runLoop('Initialize project verification', {
      loopId,
      maxTurns: 2
    });

    assert.equal(report.status, 'COMPLETED');
    assert.equal(report.total_turns, 2);

    // Verify events were emitted by the engine and recorded in EventBus
    assert.ok(receivedEventsOverBus.includes('RUN_STARTED'));
    assert.ok(receivedEventsOverBus.includes('GPT_DECISION'));
    assert.ok(receivedEventsOverBus.includes('AG_STARTED'));
    assert.ok(receivedEventsOverBus.includes('AG_OUTPUT'));
    assert.ok(receivedEventsOverBus.includes('AG_FINISHED'));
    assert.ok(receivedEventsOverBus.includes('RUN_COMPLETED'));

    // Verify RunStore recorded the run and its updated states
    const recordedRun = runStore.getRun(loopId);
    assert.ok(recordedRun);
    assert.equal(recordedRun.project, 'Real ClosedLoop Verification Run');
    assert.equal(recordedRun.status, 'COMPLETED');
    assert.equal(recordedRun.gptTurns, 2);
    assert.equal(recordedRun.agExecutions, 2);
    assert.ok(recordedRun.events.length >= 6);

    // Verify API returns the real execution run
    const resRun = await fetch(`${url}/api/runs/${loopId}`);
    const apiRun = await resRun.json() as any;
    assert.equal(apiRun.runId, loopId);
    assert.equal(apiRun.status, 'COMPLETED');

    // Allow event emission flush to reach SSE stream
    await new Promise(r => setTimeout(r, 60));
    assert.ok(sseRealText.includes(loopId));

    sseReq.destroy();
  } finally {
    await server.stop();
  }
});
