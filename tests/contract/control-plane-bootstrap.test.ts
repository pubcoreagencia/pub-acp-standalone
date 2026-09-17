import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createControlPlane } from '../../src/bootstrap/createControlPlane.js';
import { ControlRoomServer } from '../../src/server/ControlRoomServer.js';
import { GitInspector } from '../../src/multiproject/WorkspaceResolver.js';
import { ProjectRegistry } from '../../src/multiproject/ProjectRegistry.js';

test('Bootstrap Test A - createControlPlane in valid Git workspace registers current project in ProjectRegistry', async () => {
  const controlPlane = await createControlPlane({ cwd: process.cwd() });

  assert.ok(controlPlane.currentProject, 'currentProject should be resolved');
  assert.equal(controlPlane.currentProject.projectId, 'pubcoreagencia-pub-acp-standalone');
  assert.equal(controlPlane.currentProject.enabled, true);
  assert.equal(controlPlane.currentProject.workspacePath, path.resolve(process.cwd()));
  assert.ok(controlPlane.projectRegistry.hasProject('pubcoreagencia-pub-acp-standalone'));

  const registered = controlPlane.projectRegistry.getProject('pubcoreagencia-pub-acp-standalone');
  assert.ok(registered);
  assert.equal(registered.workspacePath, path.resolve(process.cwd()));
});

test('Bootstrap Test B - createControlPlane injects real ProjectDispatcher into ControlRoomServer', async () => {
  const controlPlane = await createControlPlane({ cwd: process.cwd() });
  assert.ok(controlPlane.dispatcher, 'Dispatcher must be instantiated');

  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    dispatcher: controlPlane.dispatcher,
    projectRegistry: controlPlane.projectRegistry,
    sessionStore: controlPlane.sessionStore,
    eventBus: controlPlane.eventBus,
    runStore: controlPlane.runStore
  });

  // Verify server can start without errors
  const { url } = await server.start();
  try {
    assert.ok(url.startsWith('http://127.0.0.1:'));
  } finally {
    await server.stop();
  }
});

test('Bootstrap Test C - GET /api/projects returns the current project discovered by bootstrap', async () => {
  const controlPlane = await createControlPlane({ cwd: process.cwd() });
  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    dispatcher: controlPlane.dispatcher,
    projectRegistry: controlPlane.projectRegistry,
    sessionStore: controlPlane.sessionStore,
    eventBus: controlPlane.eventBus,
    runStore: controlPlane.runStore
  });

  const { url } = await server.start();
  try {
    const res = await fetch(`${url}/api/projects`);
    assert.equal(res.status, 200);
    const projects = await res.json() as any[];

    assert.ok(Array.isArray(projects));
    assert.ok(projects.length >= 1);
    const proj = projects.find(p => p.projectId === 'pubcoreagencia-pub-acp-standalone');
    assert.ok(proj, 'Current project must be listed');
    assert.equal(proj.projectId, 'pubcoreagencia-pub-acp-standalone');
    assert.equal(proj.enabled, true);
    // Filesystem path must be sanitized/not leaked
    assert.equal(proj.workspacePath, undefined);
  } finally {
    await server.stop();
  }
});

test('Bootstrap Test D - POST /api/runs does not return 501 and reaches Dispatcher', async () => {
  let dispatcherCalledWith: any = null;
  const mockEngineFactory = (ctx: any) => ({
    runLoop: async () => ({
      success: true,
      turnsCompleted: 1,
      totalDurationMs: 50,
      runId: ctx.runId,
      finalResponse: 'ok',
      toolCallsCount: 0,
      turns: []
    })
  }) as any;

  const controlPlane = await createControlPlane({
    cwd: process.cwd(),
    engineFactory: mockEngineFactory
  });

  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    dispatcher: controlPlane.dispatcher,
    projectRegistry: controlPlane.projectRegistry,
    sessionStore: controlPlane.sessionStore,
    eventBus: controlPlane.eventBus,
    runStore: controlPlane.runStore
  });

  const { url } = await server.start();
  try {
    const res = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'pubcoreagencia-pub-acp-standalone',
        instruction: 'Run unit verification task'
      })
    });

    // Must NOT be 501
    assert.notEqual(res.status, 501, 'Must not return 501 Dispatcher not configured');
    assert.equal(res.status, 202, 'Should accept run initiation');

    const body = await res.json() as any;
    assert.ok(body.runId);
    assert.equal(body.status, 'STARTING');
    assert.equal(body.projectId, 'pubcoreagencia-pub-acp-standalone');
  } finally {
    await server.stop();
  }
});

test('Bootstrap Test E - Shared EventBus and RunStore between Control Room and Dispatcher', async () => {
  const controlPlane = await createControlPlane({ cwd: process.cwd() });
  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    dispatcher: controlPlane.dispatcher,
    projectRegistry: controlPlane.projectRegistry,
    sessionStore: controlPlane.sessionStore,
    eventBus: controlPlane.eventBus,
    runStore: controlPlane.runStore
  });

  // Verify reference equality of shared infrastructure
  assert.strictEqual(server.getEventBus(), controlPlane.eventBus, 'EventBus must be the exact same instance');
  assert.strictEqual(server.getRunStore(), controlPlane.runStore, 'RunStore must be the exact same instance');
});

test('Bootstrap Test F - Workspace invalid or non-git fails safely and explicitly without creating fictitious projects', async () => {
  const nonGitInspector: GitInspector = {
    isGitRepo: () => false,
    getRemoteUrl: () => null,
    getCurrentBranch: () => null,
    getLastCommit: () => null
  };

  const controlPlane = await createControlPlane({
    cwd: process.cwd(),
    gitInspector: nonGitInspector
  });

  assert.equal(controlPlane.currentProject, undefined, 'No project should be resolved for non-git directory');
  assert.equal(controlPlane.projectRegistry.listProjects().length, 0, 'Registry must not invent fictitious projects');
});

test('Bootstrap Test G - Idempotency: Does not duplicate project registration in the same registry', async () => {
  const registry = new ProjectRegistry();
  const controlPlane1 = await createControlPlane({ cwd: process.cwd(), projectRegistry: registry });
  const controlPlane2 = await createControlPlane({ cwd: process.cwd(), projectRegistry: registry });

  const matching = registry.listProjects().filter(p => p.projectId === 'pubcoreagencia-pub-acp-standalone');
  assert.equal(matching.length, 1, 'Project must only be registered once in registry');
});
