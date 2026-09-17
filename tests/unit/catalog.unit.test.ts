import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryProjectCatalog, FileProjectCatalog } from '../../src/catalog/FileProjectCatalog.js';
import { ProjectCatalogLoader } from '../../src/catalog/ProjectCatalogLoader.js';
import { ProjectRegistry } from '../../src/multiproject/ProjectRegistry.js';
import { WorkspaceResolver, GitInspector } from '../../src/multiproject/WorkspaceResolver.js';
import { createControlPlane } from '../../src/bootstrap/createControlPlane.js';
import { ControlRoomServer } from '../../src/server/ControlRoomServer.js';
import { MemoryWorkspaceLock } from '../../src/multiproject/WorkspaceLock.js';

// Helper mock git inspector
function createMockGitInspector(repos: Record<string, { remote: string; branch: string; isRepo?: boolean }>): GitInspector {
  return {
    isGitRepo: (p: string) => {
      const match = repos[p];
      return match ? (match.isRepo !== undefined ? match.isRepo : true) : false;
    },
    getRemoteUrl: (p: string) => {
      const match = repos[p];
      return match ? match.remote : null;
    },
    getCurrentBranch: (p: string) => {
      const match = repos[p];
      return match ? match.branch : null;
    },
    getLastCommit: () => 'abc1234'
  };
}

function createRealTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `acp-test-${prefix}-`));
}

test('Test A - Single Project: Catalog with one project populates registry (registry = 1)', async () => {
  const wsAlpha = createRealTmpDir('alpha');
  const gitInspector = createMockGitInspector({
    [wsAlpha]: { remote: 'https://github.com/pubcoreagencia/project-alpha.git', branch: 'main' }
  });

  try {
    const catalog = new MemoryProjectCatalog([
      {
        projectId: 'pubcoreagencia-project-alpha',
        workspacePath: wsAlpha,
        enabled: true
      }
    ]);

    const registry = new ProjectRegistry();
    const resolver = new WorkspaceResolver(registry, gitInspector);
    const loader = new ProjectCatalogLoader(catalog, resolver, registry);

    const report = await loader.loadAndRegister();
    assert.equal(report.loadedCount, 1);
    assert.equal(report.skippedCount, 0);
    assert.equal(registry.listProjects().length, 1);

    const proj = registry.getProject('pubcoreagencia-project-alpha');
    assert.ok(proj);
    assert.equal(proj.projectId, 'pubcoreagencia-project-alpha');
    assert.equal(proj.workspacePath, wsAlpha);
  } finally {
    rmSync(wsAlpha, { recursive: true, force: true });
  }
});

test('Test B - Multi-Project: Catalog with 2 projects loads both and GET /api/projects returns 2', async () => {
  const wsAlpha = createRealTmpDir('alpha');
  const wsBeta = createRealTmpDir('beta');
  const wsCwd = createRealTmpDir('cwd-unrelated');

  const gitInspector = createMockGitInspector({
    [wsAlpha]: { remote: 'https://github.com/pubcoreagencia/project-alpha.git', branch: 'main' },
    [wsBeta]: { remote: 'https://github.com/pubcoreagencia/project-beta.git', branch: 'dev' },
    [wsCwd]: { remote: 'https://github.com/pubcoreagencia/project-alpha.git', branch: 'main' } // or any
  });

  try {
    const catalog = new MemoryProjectCatalog([
      {
        projectId: 'pubcoreagencia-project-alpha',
        projectName: 'Project Alpha',
        workspacePath: wsAlpha,
        enabled: true
      },
      {
        projectId: 'pubcoreagencia-project-beta',
        projectName: 'Project Beta',
        workspacePath: wsBeta,
        defaultBranch: 'dev',
        enabled: true
      }
    ]);

    const controlPlane = await createControlPlane({
      projectCatalog: catalog,
      gitInspector,
      cwd: wsAlpha // cwd matches alpha
    });

    assert.equal(controlPlane.projectRegistry.listProjects().length, 2);

    const server = new ControlRoomServer({
      port: 0,
      host: '127.0.0.1',
      projectRegistry: controlPlane.projectRegistry
    });

    const { url } = await server.start();
    try {
      const res = await fetch(`${url}/api/projects`);
      assert.equal(res.status, 200);
      const body = await res.json() as any[];

      assert.equal(body.length, 2);
      const ids = body.map(p => p.projectId).sort();
      assert.deepEqual(ids, ['pubcoreagencia-project-alpha', 'pubcoreagencia-project-beta']);
    } finally {
      await server.stop();
    }
  } finally {
    rmSync(wsAlpha, { recursive: true, force: true });
    rmSync(wsBeta, { recursive: true, force: true });
    rmSync(wsCwd, { recursive: true, force: true });
  }
});

test('Test C - Invalid Workspace: Non-existent or non-git workspace is not available for execution', async () => {
  const wsValid = createRealTmpDir('valid');
  const wsInvalid = join(tmpdir(), 'non-existent-ghost-ws-' + Date.now());

  const gitInspector = createMockGitInspector({
    [wsValid]: { remote: 'https://github.com/pubcoreagencia/valid-project.git', branch: 'main' },
    [wsInvalid]: { remote: '', branch: '', isRepo: false }
  });

  try {
    const catalog = new MemoryProjectCatalog([
      {
        projectId: 'pubcoreagencia-valid-project',
        workspacePath: wsValid,
        enabled: true
      },
      {
        projectId: 'pubcoreagencia-ghost-project',
        workspacePath: wsInvalid,
        enabled: true
      }
    ]);

    const registry = new ProjectRegistry();
    const resolver = new WorkspaceResolver(registry, gitInspector);
    const loader = new ProjectCatalogLoader(catalog, resolver, registry);

    const report = await loader.loadAndRegister();
    assert.equal(report.loadedCount, 1);
    assert.equal(report.skippedCount, 1);
    assert.equal(registry.listProjects().length, 1);
    assert.ok(registry.hasProject('pubcoreagencia-valid-project'));
    assert.equal(registry.hasProject('pubcoreagencia-ghost-project'), false);

    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0].projectId, 'pubcoreagencia-ghost-project');
    assert.equal(report.errors[0].reason, 'WORKSPACE_NOT_FOUND');
  } finally {
    rmSync(wsValid, { recursive: true, force: true });
  }
});

test('Test D - Duplicate projectId: Deterministic behavior, no silent overwrite', async () => {
  const wsAlpha = createRealTmpDir('alpha');
  const wsDuplicate = createRealTmpDir('alpha-dup');

  const gitInspector = createMockGitInspector({
    [wsAlpha]: { remote: 'https://github.com/pubcoreagencia/project-alpha.git', branch: 'main' },
    [wsDuplicate]: { remote: 'https://github.com/pubcoreagencia/project-alpha.git', branch: 'main' }
  });

  try {
    const catalog = new MemoryProjectCatalog([
      {
        projectId: 'pubcoreagencia-project-alpha',
        projectName: 'Original Alpha',
        workspacePath: wsAlpha,
        enabled: true
      },
      {
        projectId: 'pubcoreagencia-project-alpha',
        projectName: 'Duplicate Alpha',
        workspacePath: wsDuplicate,
        enabled: true
      }
    ]);

    const registry = new ProjectRegistry();
    const resolver = new WorkspaceResolver(registry, gitInspector);
    const loader = new ProjectCatalogLoader(catalog, resolver, registry);

    const report = await loader.loadAndRegister();
    assert.equal(report.loadedCount, 1);
    assert.equal(report.skippedCount, 1);
    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0].reason, 'DUPLICATE_PROJECT_ID');

    const registered = registry.getProject('pubcoreagencia-project-alpha');
    assert.ok(registered);
    assert.equal(registered.projectName, 'Original Alpha');
    assert.equal(registered.workspacePath, wsAlpha);
  } finally {
    rmSync(wsAlpha, { recursive: true, force: true });
    rmSync(wsDuplicate, { recursive: true, force: true });
  }
});

test('Test E - Current project: cwd matches a cataloged project sets correct currentProjectId', async () => {
  const wsCurrent = createRealTmpDir('current');
  const wsOther = createRealTmpDir('other');

  const gitInspector = createMockGitInspector({
    [wsCurrent]: { remote: 'https://github.com/pubcoreagencia/current-project.git', branch: 'main' },
    [wsOther]: { remote: 'https://github.com/pubcoreagencia/other-project.git', branch: 'main' }
  });

  try {
    const catalog = new MemoryProjectCatalog([
      {
        projectId: 'pubcoreagencia-current-project',
        workspacePath: wsCurrent,
        enabled: true
      },
      {
        projectId: 'pubcoreagencia-other-project',
        workspacePath: wsOther,
        enabled: true
      }
    ]);

    const controlPlane = await createControlPlane({
      cwd: wsCurrent,
      projectCatalog: catalog,
      gitInspector
    });

    assert.ok(controlPlane.currentProject);
    assert.equal(controlPlane.currentProject.projectId, 'pubcoreagencia-current-project');
    assert.equal(controlPlane.projectRegistry.listProjects().length, 2);
  } finally {
    rmSync(wsCurrent, { recursive: true, force: true });
    rmSync(wsOther, { recursive: true, force: true });
  }
});

test('Test F - Current project absent: cwd does not belong to any cataloged project', async () => {
  const wsCataloged = createRealTmpDir('cataloged');
  const wsUncatalogedCwd = createRealTmpDir('unknown-cwd');

  const gitInspector = createMockGitInspector({
    [wsCataloged]: { remote: 'https://github.com/pubcoreagencia/cataloged-project.git', branch: 'main' },
    [wsUncatalogedCwd]: { remote: 'https://github.com/random/unknown.git', branch: 'main' }
  });

  try {
    const catalog = new MemoryProjectCatalog([
      {
        projectId: 'pubcoreagencia-cataloged-project',
        workspacePath: wsCataloged,
        enabled: true
      }
    ]);

    const controlPlane = await createControlPlane({
      cwd: wsUncatalogedCwd,
      projectCatalog: catalog,
      gitInspector
    });

    // Both the cataloged project and current cwd project are registered in registry
    assert.ok(controlPlane.projectRegistry.hasProject('pubcoreagencia-cataloged-project'));
    assert.equal(controlPlane.currentProject?.projectId, 'random-unknown');
    assert.equal(controlPlane.projectRegistry.listProjects().length, 2);
  } finally {
    rmSync(wsCataloged, { recursive: true, force: true });
    rmSync(wsUncatalogedCwd, { recursive: true, force: true });
  }
});

test('Test G - Conversation isolation: Project A does not receive conversations of Project B', async () => {
  const wsA = 'C:\\workspaces\\project-a';
  const wsB = 'C:\\workspaces\\project-b';

  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-a',
    projectName: 'Project A',
    workspacePath: wsA,
    repository: 'pub/a',
    defaultBranch: 'main',
    enabled: true
  });
  registry.registerProject({
    projectId: 'proj-b',
    projectName: 'Project B',
    workspacePath: wsB,
    repository: 'pub/b',
    defaultBranch: 'main',
    enabled: true
  });

  const mockSessionStore = {
    async listConversationsForWorkspace(ws: string) {
      if (ws === wsA) {
        return [
          {
            conversationId: 'conv-a-1',
            title: 'Conv A',
            preview: 'Preview A',
            status: 'IDLE',
            lastModifiedTime: '2026-09-16T12:00:00Z',
            stepCount: 5
          }
        ];
      }
      if (ws === wsB) {
        return [
          {
            conversationId: 'conv-b-1',
            title: 'Conv B',
            preview: 'Preview B',
            status: 'IDLE',
            lastModifiedTime: '2026-09-16T12:00:00Z',
            stepCount: 10
          }
        ];
      }
      return [];
    },
    async getConversation() { return null; },
    async belongsToWorkspace(id: string, ws: string) {
      if (id === 'conv-a-1' && ws === wsA) return true;
      if (id === 'conv-b-1' && ws === wsB) return true;
      return false;
    }
  };

  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    projectRegistry: registry,
    sessionStore: mockSessionStore as any
  });

  const { url } = await server.start();
  try {
    const resA = await fetch(`${url}/api/projects/proj-a/conversations`);
    const dataA = await resA.json() as any;
    assert.equal(dataA.projectId, 'proj-a');
    assert.equal(dataA.conversations.length, 1);
    assert.equal(dataA.conversations[0].conversationId, 'conv-a-1');

    const resB = await fetch(`${url}/api/projects/proj-b/conversations`);
    const dataB = await resB.json() as any;
    assert.equal(dataB.projectId, 'proj-b');
    assert.equal(dataB.conversations.length, 1);
    assert.equal(dataB.conversations[0].conversationId, 'conv-b-1');

    // Cross-check: conv-a-1 does not belong to Project B
    const belongs = await mockSessionStore.belongsToWorkspace('conv-a-1', wsB);
    assert.equal(belongs, false);
  } finally {
    await server.stop();
  }
});

test('Test H - HTTP boundary: GET /api/projects does not leak workspacePath or internal details', async () => {
  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'secret-proj',
    projectName: 'Secret Project',
    workspacePath: 'C:\\Users\\Secret\\Documents\\SecretRepo',
    repository: 'pubcoreagencia/secret-repo',
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
    assert.equal(body[0].projectId, 'secret-proj');
    assert.equal(body[0].workspacePath, undefined);
    assert.equal(body[0].workspaceUri, undefined);
    assert.equal(body[0].absolutePath, undefined);
    assert.equal(body[0].path, undefined);
  } finally {
    await server.stop();
  }
});

test('Test I - Dispatch by projectId resolves workspace internally without caller knowledge', async () => {
  const wsTarget = createRealTmpDir('target');
  const gitInspector = createMockGitInspector({
    [wsTarget]: { remote: 'https://github.com/pubcoreagencia/target-project.git', branch: 'main' }
  });

  try {
    const registry = new ProjectRegistry();
    registry.registerProject({
      projectId: 'pubcoreagencia-target-project',
      projectName: 'Target Project',
      workspacePath: wsTarget,
      repository: 'https://github.com/pubcoreagencia/target-project.git',
      defaultBranch: 'main',
      enabled: true
    });

    let dispatchedCwd = '';
    const controlPlane = await createControlPlane({
      projectRegistry: registry,
      gitInspector,
      cwd: wsTarget,
      engineFactory: (ctx) => {
        dispatchedCwd = ctx.workspacePath;
        return {
          runLoop: async () => ({ status: 'COMPLETED', turnsTaken: 1 })
        } as any;
      }
    });

    const server = new ControlRoomServer({
      port: 0,
      host: '127.0.0.1',
      projectRegistry: controlPlane.projectRegistry,
      dispatcher: controlPlane.dispatcher,
      eventBus: controlPlane.eventBus,
      runStore: controlPlane.runStore
    });

    const { url } = await server.start();
    try {
      const res = await fetch(`${url}/api/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'pubcoreagencia-target-project',
          instruction: 'Execute test task'
        })
      });

      assert.equal(res.status, 202);
      const data = await res.json() as any;
      assert.ok(data.runId);

      // Wait briefly for async dispatcher to resolve context and invoke engine
      await new Promise(r => setTimeout(r, 150));
      assert.equal(dispatchedCwd, wsTarget);
    } finally {
      await server.stop();
    }
  } finally {
    rmSync(wsTarget, { recursive: true, force: true });
  }
});

test('Test J - Lock isolation: independent workspaces can acquire locks independently; same workspace blocks', () => {
  const lock = new MemoryWorkspaceLock();
  const wsA = 'C:\\workspaces\\repo-a';
  const wsB = 'C:\\workspaces\\repo-b';

  // 1. Acquire lock on wsA
  const resA = lock.acquire(wsA, 'run-1');
  assert.equal(resA.acquired, true, 'Lock A must be acquired');

  // 2. Acquire lock on wsB (different workspace -> independent lock success)
  const resB = lock.acquire(wsB, 'run-2');
  assert.equal(resB.acquired, true, 'Lock B must be acquired concurrently with Lock A');

  // 3. Attempt lock on wsA while held (must fail)
  const resA2 = lock.acquire(wsA, 'run-3');
  assert.equal(resA2.acquired, false, 'Lock on wsA must be blocked while run-1 holds it');

  // 4. Release wsA
  const released = lock.release(wsA, 'run-1');
  assert.equal(released, true);

  // 5. Now wsA can be acquired
  const resA3 = lock.acquire(wsA, 'run-4');
  assert.equal(resA3.acquired, true, 'Lock on wsA must succeed after release');

  lock.release(wsB, 'run-2');
  lock.release(wsA, 'run-4');
});
