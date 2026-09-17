import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlRoomServer } from '../../src/server/ControlRoomServer.js';
import { EventBus } from '../../src/observability/EventBus.js';
import { MemoryRunStore } from '../../src/observability/RunStore.js';
import { ProjectRegistry } from '../../src/multiproject/ProjectRegistry.js';
import { IProjectDispatcher, DispatchRequest, DispatchResult } from '../../src/multiproject/ProjectDispatcher.js';

test('ControlRoomServer - GET /api/projects returns registered projects without filesystem paths', async () => {
  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'test-proj-1',
    projectName: 'Test Project One',
    workspacePath: 'C:\\secret\\path\\test-proj-1',
    repository: 'pubcoreagencia/test-repo-1',
    defaultBranch: 'main',
    enabled: true
  });

  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    projectRegistry: registry
  });

  const { url } = await server.start();

  try {
    const res = await fetch(`${url}/api/projects`);
    assert.equal(res.status, 200);
    const body = await res.json() as any[];

    assert.equal(body.length, 1);
    assert.equal(body[0].projectId, 'test-proj-1');
    assert.equal(body[0].projectName, 'Test Project One');
    assert.equal(body[0].repository, 'pubcoreagencia/test-repo-1');
    assert.equal(body[0].defaultBranch, 'main');
    assert.equal(body[0].enabled, true);

    // CRITICAL: Must not leak workspacePath or internal filesystem paths
    assert.equal(body[0].workspacePath, undefined);
    assert.equal(body[0].workspaceUri, undefined);
  } finally {
    await server.stop();
  }
});

test('ControlRoomServer - POST /api/runs validation rules (empty, missing, out-of-bounds, not found)', async () => {
  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'valid-project',
    projectName: 'Valid Project',
    workspacePath: process.cwd(),
    repository: 'pubcoreagencia/valid-repo',
    defaultBranch: 'main',
    enabled: true
  });

  const mockDispatcher: IProjectDispatcher = {
    dispatch: async (req: DispatchRequest): Promise<DispatchResult> => {
      return { ok: true, runId: req.runId || 'run-mock' };
    }
  };

  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    projectRegistry: registry,
    dispatcher: mockDispatcher
  });

  const { url } = await server.start();

  try {
    // 1. Missing projectId -> 400
    const res1 = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'Do work' })
    });
    assert.equal(res1.status, 400);

    // 2. Empty projectId -> 400
    const res2 = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: '   ', instruction: 'Do work' })
    });
    assert.equal(res2.status, 400);

    // 3. Unknown projectId -> 404
    const res3 = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'non-existent-proj', instruction: 'Do work' })
    });
    assert.equal(res3.status, 404);

    // 4. Missing instruction -> 400
    const res4 = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'valid-project' })
    });
    assert.equal(res4.status, 400);

    // 5. Empty instruction -> 400
    const res5 = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'valid-project', instruction: '   ' })
    });
    assert.equal(res5.status, 400);

    // 6. Invalid maxTurns (zero) -> 400
    const res6 = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'valid-project', instruction: 'Do work', maxTurns: 0 })
    });
    assert.equal(res6.status, 400);

    // 7. Invalid maxTurns (> 20) -> 400
    const res7 = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'valid-project', instruction: 'Do work', maxTurns: 21 })
    });
    assert.equal(res7.status, 400);

    // 8. Invalid maxTurns (non-integer string) -> 400
    const res8 = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'valid-project', instruction: 'Do work', maxTurns: 'five' })
    });
    assert.equal(res8.status, 400);

    // 9. Empty conversationId -> 400
    const res9 = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'valid-project', instruction: 'Do work', conversationId: '  ' })
    });
    assert.equal(res9.status, 400);
  } finally {
    await server.stop();
  }
});

test('ControlRoomServer - POST /api/runs returns 202 Accepted, registers RUN_CREATED and allows immediate SSE connection', async () => {
  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'test-project',
    projectName: 'Test Project',
    workspacePath: process.cwd(),
    repository: 'pubcoreagencia/test-repo',
    defaultBranch: 'main',
    enabled: true
  });

  const eventBus = new EventBus();
  const runStore = new MemoryRunStore();

  let dispatchedRequest: DispatchRequest | null = null;
  const mockDispatcher: IProjectDispatcher = {
    dispatch: async (req: DispatchRequest): Promise<DispatchResult> => {
      dispatchedRequest = req;
      return { ok: true, runId: req.runId || 'run-mock' };
    }
  };

  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    eventBus,
    runStore,
    projectRegistry: registry,
    dispatcher: mockDispatcher
  });

  const { url } = await server.start();

  try {
    const res = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'test-project',
        instruction: 'Execute automated regression turn',
        conversationId: 'conv-uuid-1234',
        maxTurns: 5,
        // Prohibited fields that must be ignored
        workspacePath: 'C:\\hack\\path',
        runId: 'injected-run-id'
      })
    });

    assert.equal(res.status, 202);
    const body = await res.json() as any;

    assert.ok(body.runId);
    assert.notEqual(body.runId, 'injected-run-id', 'Client must NEVER be able to inject runId');
    assert.equal(body.status, 'STARTING');
    assert.equal(body.projectId, 'test-project');

    // Verify run was recorded in RunStore immediately
    const recorded = runStore.getRun(body.runId);
    assert.ok(recorded, 'Run must exist in RunStore immediately upon 202');
    assert.equal(recorded?.status, 'STARTING');

    // Verify dispatcher was invoked with sanitized request
    assert.ok(dispatchedRequest);
    assert.equal((dispatchedRequest as any).projectId, 'test-project');
    assert.equal((dispatchedRequest as any).initialPrompt, 'Execute automated regression turn');
    assert.equal((dispatchedRequest as any).conversationId, 'conv-uuid-1234');
    assert.equal((dispatchedRequest as any).maxTurns, 5);
    assert.equal((dispatchedRequest as any).workspacePath, undefined);

    // Verify SSE stream connection receives RUN_CREATED event
    let sseReceivedChunk = '';
    const http = await import('node:http');
    const sseReq = await new Promise<import('node:http').ClientRequest>((resolveReq, reject) => {
      const parsedUrl = new URL(`${url}/api/runs/${body.runId}/stream`);
      const clientReq = http.request(parsedUrl, sseRes => {
        assert.equal(sseRes.statusCode, 200);
        assert.ok(sseRes.headers['content-type']?.includes('text/event-stream'));
        sseRes.on('data', chunk => {
          sseReceivedChunk += chunk.toString();
        });
      });
      clientReq.on('error', reject);
      clientReq.end();
      resolveReq(clientReq);
    });

    // Wait for SSE initial replay chunk
    await new Promise(r => setTimeout(r, 60));
    assert.ok(sseReceivedChunk.includes('RUN_CREATED'));
    assert.ok(sseReceivedChunk.includes('test-project'));

    sseReq.destroy();
  } finally {
    await server.stop();
  }
});

test('Hardening Test A - Exactly ONE RUN_CREATED in run.events when dispatched via ControlRoomServer', async () => {
  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-single-created',
    projectName: 'Single Created Project',
    workspacePath: process.cwd(),
    repository: 'pubcoreagencia/pub-acp-standalone',
    defaultBranch: 'main',
    enabled: true
  });

  const eventBus = new EventBus();
  const runStore = new MemoryRunStore();

  let receivedDispatcherRunId = '';
  const mockDispatcher: IProjectDispatcher = {
    dispatch: async (req: DispatchRequest): Promise<DispatchResult> => {
      receivedDispatcherRunId = req.runId || '';
      // Dispatcher would normally execute and emit subsequent events, NOT RUN_CREATED
      eventBus.publish({
        id: 'evt-res-1',
        runId: req.runId!,
        timestamp: new Date().toISOString(),
        type: 'PROJECT_RESOLUTION_STARTED',
        summary: 'Resolving project'
      });
      return { ok: true, runId: req.runId! };
    }
  };

  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    projectRegistry: registry,
    dispatcher: mockDispatcher,
    eventBus,
    runStore
  });

  const { url } = await server.start();

  try {
    const res = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-single-created',
        instruction: 'Verify single RUN_CREATED event'
      })
    });

    assert.equal(res.status, 202);
    const body = await res.json() as any;

    await new Promise(r => setTimeout(r, 50));

    const run = runStore.getRun(body.runId);
    assert.ok(run);
    assert.equal(run?.runId, body.runId);
    assert.equal(receivedDispatcherRunId, body.runId);

    const createdEvents = run!.events.filter(e => e.type === 'RUN_CREATED');
    assert.equal(createdEvents.length, 1, 'There must be EXACTLY ONE RUN_CREATED event');
    assert.equal(createdEvents[0].runId, body.runId);
  } finally {
    await server.stop();
  }
});

test('Hardening Test B - ProjectDispatcher without runId preserves autonomous creation and emits exactly one RUN_CREATED', async () => {
  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-autonomous',
    projectName: 'Autonomous Project',
    workspacePath: process.cwd(),
    repository: 'pubcoreagencia/pub-acp-standalone',
    defaultBranch: 'main',
    enabled: true
  });

  const eventBus = new EventBus();
  const runStore = new MemoryRunStore();
  const { wireEventBusToRunStore } = await import('../../src/observability/wireEventBus.js');
  wireEventBusToRunStore(eventBus, runStore);

  const { WorkspaceResolver } = await import('../../src/multiproject/WorkspaceResolver.js');
  const { SafetyGate } = await import('../../src/multiproject/SafetyGate.js');
  const { MemoryProjectContextStore } = await import('../../src/context/MemoryProjectContextStore.js');
  const { ProjectDispatcher } = await import('../../src/multiproject/ProjectDispatcher.js');

  const resolver = new WorkspaceResolver(registry);
  const safetyGate = new SafetyGate();
  const contextStore = new MemoryProjectContextStore();

  const engineFactory = () => ({
    runLoop: async () => ({ status: 'COMPLETED', total_turns: 1, turns: [] })
  } as any);

  const dispatcher = new ProjectDispatcher(registry, contextStore, resolver, safetyGate, engineFactory, eventBus);

  // Dispatch WITHOUT runId
  const result = await dispatcher.dispatch({
    projectId: 'proj-autonomous',
    initialPrompt: 'Autonomous prompt execution'
  });

  assert.ok(result.runId);
  assert.ok(result.runId.startsWith('run-'));

  const run = runStore.getRun(result.runId);
  assert.ok(run);

  const createdEvents = run!.events.filter(e => e.type === 'RUN_CREATED');
  assert.equal(createdEvents.length, 1, 'Dispatcher must autonomously emit exactly ONE RUN_CREATED when runId is not supplied');
  assert.equal(createdEvents[0].runId, result.runId);
});

test('Hardening Test C - Unexpected background exception produces single RUN_FAILED and updates RunStore to FAILED', async () => {
  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-failing-bg',
    projectName: 'Failing BG Project',
    workspacePath: process.cwd(),
    repository: 'pubcoreagencia/pub-acp-standalone',
    defaultBranch: 'main',
    enabled: true
  });

  const eventBus = new EventBus();
  const runStore = new MemoryRunStore();

  const mockFailingDispatcher: IProjectDispatcher = {
    dispatch: async (): Promise<DispatchResult> => {
      // Simulate unexpected fatal asynchronous rejection (e.g. unhandled crash)
      throw new Error('synthetic unexpected failure');
    }
  };

  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    projectRegistry: registry,
    dispatcher: mockFailingDispatcher,
    eventBus,
    runStore
  });

  const { url } = await server.start();

  try {
    const res = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-failing-bg',
        instruction: 'Task that triggers crash'
      })
    });

    // 1. HTTP returns 202 Accepted
    assert.equal(res.status, 202);
    const body = await res.json() as any;
    assert.ok(body.runId);

    // Allow background rejection to flush to .catch() and EventBus
    await new Promise(r => setTimeout(r, 60));

    // Verify RunStore updated to FAILED and not stuck in STARTING
    const run = runStore.getRun(body.runId);
    assert.ok(run);
    assert.equal(run?.status, 'FAILED');

    // Verify exactly one RUN_FAILED event
    const failedEvents = run!.events.filter(e => e.type === 'RUN_FAILED');
    assert.equal(failedEvents.length, 1);
    assert.equal(failedEvents[0].runId, body.runId);
    assert.ok(failedEvents[0].summary.includes('synthetic unexpected failure'));
  } finally {
    await server.stop();
  }
});

test('Hardening Test D - Handled Dispatcher error does not cause duplicate RUN_FAILED', async () => {
  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-handled-err',
    projectName: 'Handled Error Project',
    workspacePath: process.cwd(),
    repository: 'pubcoreagencia/pub-acp-standalone',
    defaultBranch: 'main',
    enabled: true
  });

  const eventBus = new EventBus();
  const runStore = new MemoryRunStore();

  const mockHandledDispatcher: IProjectDispatcher = {
    dispatch: async (req: DispatchRequest): Promise<DispatchResult> => {
      // Dispatcher handles error normally, emits event and updates status
      eventBus.publish({
        id: 'evt-normal-blocked',
        runId: req.runId!,
        timestamp: new Date().toISOString(),
        type: 'SAFETY_GATE_BLOCKED',
        summary: 'Execution blocked safely'
      });
      return {
        ok: false,
        runId: req.runId!,
        safetyBlocked: true,
        blockedReason: 'SECURITY_RULE_VIOLATION'
      };
    }
  };

  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    projectRegistry: registry,
    dispatcher: mockHandledDispatcher,
    eventBus,
    runStore
  });

  const { url } = await server.start();

  try {
    const res = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-handled-err',
        instruction: 'Handled error test'
      })
    });

    assert.equal(res.status, 202);
    const body = await res.json() as any;

    await new Promise(r => setTimeout(r, 60));

    const run = runStore.getRun(body.runId);
    assert.ok(run);
    assert.equal(run?.status, 'BLOCKED');

    // Must NOT have any redundant RUN_FAILED event
    const failedEvents = run!.events.filter(e => e.type === 'RUN_FAILED');
    assert.equal(failedEvents.length, 0);
  } finally {
    await server.stop();
  }
});

