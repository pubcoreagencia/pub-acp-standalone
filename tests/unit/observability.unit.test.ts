import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../src/observability/EventBus.js';
import { MemoryRunStore } from '../../src/observability/RunStore.js';
import { sanitizeText, sanitizeObject } from '../../src/observability/sanitizer.js';
import { wireEventBusToRunStore } from '../../src/observability/wireEventBus.js';
import { DemoFeedGenerator } from '../../src/observability/DemoFeed.js';
import { AutonomyEvent } from '../../src/observability/types.js';

test('Sanitization - strips API keys, bearer tokens, passwords, cookies, and secrets', () => {
  const dirtyText = 'Use bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and secret sk-1234567890123456789012345678 with ghp_123456789012345678901234567890123456';
  const cleanText = sanitizeText(dirtyText);
  assert.ok(!cleanText.includes('eyJhbGci'));
  assert.ok(!cleanText.includes('1234567890123456789012345678'));
  assert.ok(cleanText.includes('Bearer [REDACTED]'));
  assert.ok(cleanText.includes('sk-[REDACTED]'));
  assert.ok(cleanText.includes('ghp_[REDACTED]'));

  const dirtyObj = {
    apiKey: 'sk-99999999999999999999',
    token: 'my-secret-token',
    password: 'super-password',
    nested: {
      credentials: { user: 'admin', key: 'secret' },
      info: 'Safe text with bearer secret-token-xyz'
    }
  };

  const cleanObj = sanitizeObject(dirtyObj) as any;
  assert.equal(cleanObj.apiKey, '[REDACTED]');
  assert.equal(cleanObj.token, '[REDACTED]');
  assert.equal(cleanObj.password, '[REDACTED]');
  assert.equal(cleanObj.nested.credentials, '[REDACTED]');
  assert.ok(!cleanObj.nested.info.includes('secret-token-xyz'));
});

test('EventBus - publishes, subscribes, unsubscribes, buffers history, and enforces run isolation', () => {
  const bus = new EventBus(10);
  const eventsReceivedRun1: AutonomyEvent[] = [];
  const eventsReceivedAll: AutonomyEvent[] = [];

  const unsubRun1 = bus.subscribe('run-1', e => eventsReceivedRun1.push(e));
  const unsubAll = bus.subscribe('*', e => eventsReceivedAll.push(e));

  const evt1: AutonomyEvent = {
    id: 'e1',
    runId: 'run-1',
    timestamp: new Date().toISOString(),
    type: 'RUN_STARTED',
    summary: 'Run 1 started'
  };

  const evt2: AutonomyEvent = {
    id: 'e2',
    runId: 'run-2',
    timestamp: new Date().toISOString(),
    type: 'RUN_STARTED',
    summary: 'Run 2 started'
  };

  bus.publish(evt1);
  bus.publish(evt2);

  assert.equal(eventsReceivedRun1.length, 1);
  assert.equal(eventsReceivedRun1[0].runId, 'run-1');

  assert.equal(eventsReceivedAll.length, 2);
  assert.equal(eventsReceivedAll[0].runId, 'run-1');
  assert.equal(eventsReceivedAll[1].runId, 'run-2');

  // Verify history
  const run1History = bus.getRecentEvents('run-1');
  assert.equal(run1History.length, 1);
  assert.equal(run1History[0].id, 'e1');

  const allHistory = bus.getRecentEvents();
  assert.equal(allHistory.length, 2);

  // Verify unsubscribe
  unsubRun1();
  bus.publish({
    id: 'e3',
    runId: 'run-1',
    timestamp: new Date().toISOString(),
    type: 'RUN_COMPLETED',
    summary: 'Run 1 done'
  });
  assert.equal(eventsReceivedRun1.length, 1); // No new events received

  unsubAll();
});

test('MemoryRunStore - stores multiple runs, updates state, and appends events', () => {
  const store = new MemoryRunStore();

  store.saveRun({
    runId: 'RUN-001',
    project: 'SAGAZ',
    status: 'STARTING',
    startedAt: new Date().toISOString(),
    durationMs: 0,
    gptTurns: 0,
    agExecutions: 0,
    corrections: 0,
    tests: {
      build: 'NOT_AVAILABLE',
      unit: 'NOT_AVAILABLE',
      integration: 'NOT_AVAILABLE',
      e2e: 'NOT_AVAILABLE',
      smoke: 'NOT_AVAILABLE'
    },
    deployStatus: {
      status: 'NOT_AVAILABLE',
      publicUrl: 'NOT_AVAILABLE',
      httpStatus: 'NOT_AVAILABLE',
      lastDeploy: 'NOT_AVAILABLE',
      version: 'NOT_AVAILABLE'
    },
    workspace: {
      path: '/mock/sagaz',
      changedFiles: [],
      fileCount: 5,
      gitStatus: 'clean',
      lastCommit: 'abc1234'
    },
    gptView: {
      lastDecision: 'NOT_AVAILABLE',
      contextSummary: 'NOT_AVAILABLE',
      analyzedResult: 'NOT_AVAILABLE',
      nextAction: 'NOT_AVAILABLE',
      timestamp: 'NOT_AVAILABLE'
    },
    agView: {
      status: 'IDLE',
      currentExecution: 'NOT_AVAILABLE',
      commandOrAction: 'NOT_AVAILABLE',
      durationMs: 'NOT_AVAILABLE',
      stdoutSummary: 'NOT_AVAILABLE',
      stderrSummary: 'NOT_AVAILABLE',
      changedFiles: [],
      result: 'NOT_AVAILABLE'
    },
    events: []
  });

  assert.equal(store.getRuns().length, 1);
  assert.equal(store.getRun('RUN-001')?.project, 'SAGAZ');

  store.appendEvent('RUN-001', {
    id: 'evt-100',
    runId: 'RUN-001',
    timestamp: new Date().toISOString(),
    type: 'RUN_STARTED',
    summary: 'Started'
  });

  assert.equal(store.getRun('RUN-001')?.events.length, 1);

  store.updateState('RUN-001', 'COMPLETED', { gptTurns: 3 });
  const updated = store.getRun('RUN-001');
  assert.equal(updated?.status, 'COMPLETED');
  assert.equal(updated?.gptTurns, 3);
  assert.ok(updated?.finishedAt);
});

test('wireEventBusToRunStore - updates store state reactively on bus events', () => {
  const bus = new EventBus();
  const store = new MemoryRunStore();
  wireEventBusToRunStore(bus, store);

  bus.publish({
    id: 'evt-1',
    runId: 'RUN-AUTO',
    timestamp: new Date().toISOString(),
    type: 'RUN_STARTED',
    summary: 'Autonomous run starting',
    details: { project: 'Todo App' }
  });

  let run = store.getRun('RUN-AUTO');
  assert.ok(run);
  assert.equal(run?.project, 'Todo App');
  assert.equal(run?.status, 'STARTING');

  bus.publish({
    id: 'evt-2',
    runId: 'RUN-AUTO',
    timestamp: new Date().toISOString(),
    type: 'GPT_DECISION',
    turn: 1,
    summary: 'Generate scaffolding'
  });

  run = store.getRun('RUN-AUTO');
  assert.equal(run?.status, 'GPT_THINKING');
  assert.equal(run?.gptTurns, 1);

  bus.publish({
    id: 'evt-3',
    runId: 'RUN-AUTO',
    timestamp: new Date().toISOString(),
    type: 'RUN_COMPLETED',
    summary: 'All done'
  });

  run = store.getRun('RUN-AUTO');
  assert.equal(run?.status, 'COMPLETED');
  assert.equal(run?.events.length, 3);
});

test('wireEventBusToRunStore - gpt-direct mode state and metrics are isolated from AG', () => {
  const bus = new EventBus();
  const store = new MemoryRunStore();
  wireEventBusToRunStore(bus, store);

  bus.publish({
    id: 'evt-d1',
    runId: 'RUN-DIRECT',
    timestamp: new Date().toISOString(),
    type: 'RUN_STARTED',
    summary: 'Direct run starting',
    details: { project: 'Direct App', executorMode: 'gpt-direct', provider: 'gpt' }
  });

  bus.publish({
    id: 'evt-d2',
    runId: 'RUN-DIRECT',
    timestamp: new Date().toISOString(),
    type: 'TOOL_STARTED',
    turn: 1,
    summary: 'Tool started'
  });

  let run = store.getRun('RUN-DIRECT');
  assert.equal(run?.status, 'TOOL_RUNNING');
  assert.equal(run?.agExecutions, 0);
  assert.equal(run?.toolExecutions, 1);
  assert.equal(run?.agView.status, 'IDLE'); // Unpolluted

  bus.publish({
    id: 'evt-d3',
    runId: 'RUN-DIRECT',
    timestamp: new Date().toISOString(),
    type: 'SANDBOX_EXECUTION',
    turn: 1,
    summary: 'Sandbox execution'
  });

  run = store.getRun('RUN-DIRECT');
  assert.equal(run?.status, 'TOOL_RUNNING');
  assert.equal(run?.agExecutions, 0);

  bus.publish({
    id: 'evt-d4',
    runId: 'RUN-DIRECT',
    timestamp: new Date().toISOString(),
    type: 'TOOL_FINISHED',
    turn: 1,
    summary: 'Tool finished'
  });

  run = store.getRun('RUN-DIRECT');
  assert.equal(run?.status, 'DIRECT_RUNNING');
  assert.equal(run?.agExecutions, 0);
  assert.equal(run?.toolExecutions, 1);

  bus.publish({
    id: 'evt-d5',
    runId: 'RUN-DIRECT',
    timestamp: new Date().toISOString(),
    type: 'RUN_COMPLETED',
    summary: 'Run completed'
  });

  run = store.getRun('RUN-DIRECT');
  assert.equal(run?.status, 'COMPLETED');
});

test('DemoFeedGenerator - creates deterministic demo run with clear DEMO flag', async () => {
  const bus = new EventBus();
  const store = new MemoryRunStore();
  const demoFeed = new DemoFeedGenerator(bus, store);

  const runId = demoFeed.generateDemoRun('DEMO-TEST-RUN');
  assert.equal(runId, 'DEMO-TEST-RUN');

  const run = store.getRun('DEMO-TEST-RUN');
  assert.ok(run);
  assert.equal(run?.isDemo, true);
  assert.ok(run?.project.includes('Demo'));

  demoFeed.stop();
});
