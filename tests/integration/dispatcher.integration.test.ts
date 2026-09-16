import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ProjectRegistry } from '../../src/multiproject/ProjectRegistry.js';
import { WorkspaceResolver } from '../../src/multiproject/WorkspaceResolver.js';
import { SafetyGate } from '../../src/multiproject/SafetyGate.js';
import { ProjectDispatcher } from '../../src/multiproject/ProjectDispatcher.js';
import { ClosedLoopEngine } from '../../src/bridge/index.js';
import { EventBus } from '../../src/observability/EventBus.js';
import { MemoryProjectContextStore } from '../../src/context/MemoryProjectContextStore.js';
import { FileProjectContextStore } from '../../src/context/FileProjectContextStore.js';
import { ExecutionContext } from '../../src/multiproject/types.js';

function createControlledGitRepo(prefix: string, originUrl: string, branch = 'main'): string {
  const dir = mkdtempSync(join(tmpdir(), `acp-disp-${prefix}-`));
  execFileSync('git', ['init', '-b', branch], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ACP Tester'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'tester@acp.local'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', originUrl], { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), `# ${prefix}\nControlled repo for dispatcher tests`);
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', `initial commit for ${prefix}`], { cwd: dir, stdio: 'ignore' });
  return dir;
}

test('ProjectDispatcher - ACTIVE: executes ClosedLoopEngine and invokes AG', async (t) => {
  const repoDir = createControlledGitRepo('active', 'https://github.com/pubcoreagencia/repo-active.git');
  t.after(() => rmSync(repoDir, { recursive: true, force: true }));

  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-active',
    projectName: 'Active Project',
    workspacePath: repoDir,
    repository: 'https://github.com/pubcoreagencia/repo-active.git',
    defaultBranch: 'main',
    enabled: true
  });

  const contextStore = new MemoryProjectContextStore();
  const initCtx = await contextStore.createInitialContext('proj-active');
  assert.equal(initCtx.status, 'ACTIVE');

  let agCallCount = 0;
  let engineRunCount = 0;

  const resolver = new WorkspaceResolver(registry);
  const safetyGate = new SafetyGate();
  const eventBus = new EventBus();

  const engineFactory = (ctx: ExecutionContext) => {
    engineRunCount++;
    return new ClosedLoopEngine(
      {
        sendPrompt: async () => ({
          request_id: 'r1',
          session_id: 's1',
          status: 'COMPLETED',
          text: 'Task done [[STATUS: READY]]',
          duration_ms: 5
        }),
        continueSession: async () => ({
          request_id: 'r2',
          session_id: 's2',
          status: 'COMPLETED',
          text: '[[STATUS: READY]]',
          duration_ms: 5
        })
      },
      {
        health: async () => ({ status: 'ok', agyPath: 'mock' }),
        sendPrompt: async () => {
          agCallCount++;
          return {
            request_id: 'ag-1',
            session_id: 's1',
            conversation_id: 'c1',
            status: 'COMPLETED',
            response: 'ok',
            duration_ms: 5
          };
        }
      },
      {
        eventBus,
        executionContext: ctx
      }
    );
  };

  const dispatcher = new ProjectDispatcher(registry, contextStore, resolver, safetyGate, engineFactory, eventBus);
  const result = await dispatcher.dispatch({
    projectId: 'proj-active',
    initialPrompt: 'Do work in active project',
    runId: 'RUN-ACTIVE-001',
    maxTurns: 1
  });

  assert.equal(result.ok, true);
  assert.equal(result.projectContextBlocked, undefined);
  assert.equal(result.safetyBlocked, false);
  assert.equal(engineRunCount, 1);
  assert.ok(agCallCount > 0);
  assert.equal(result.context?.projectId, 'proj-active');
  assert.equal(result.context?.workspacePath, repoDir);
});

test('ProjectDispatcher - PAUSED: blocks before WorkspaceResolver, SafetyGate, Engine, and AG (AG_CALL_COUNT = 0)', async (t) => {
  const repoDir = createControlledGitRepo('paused', 'https://github.com/pubcoreagencia/repo-paused.git');
  t.after(() => rmSync(repoDir, { recursive: true, force: true }));

  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-paused',
    projectName: 'Paused Project',
    workspacePath: repoDir,
    repository: 'https://github.com/pubcoreagencia/repo-paused.git',
    defaultBranch: 'main',
    enabled: true
  });

  const contextStore = new MemoryProjectContextStore();
  await contextStore.createInitialContext('proj-paused');
  await contextStore.updateContext('proj-paused', () => ({ status: 'PAUSED' }), 1);

  let agCallCount = 0;
  let engineRunCount = 0;
  let resolverCalled = false;
  let safetyGateCalled = false;

  const baseResolver = new WorkspaceResolver(registry);
  const spyResolver = {
    resolve: (id: string, opts: any) => {
      resolverCalled = true;
      return baseResolver.resolve(id, opts);
    },
    resolveWorkspace: (p: string, o?: any) => baseResolver.resolveWorkspace(p, o)
  } as unknown as WorkspaceResolver;

  const baseGate = new SafetyGate();
  const spyGate = {
    evaluate: (res: any) => {
      safetyGateCalled = true;
      return baseGate.evaluate(res);
    }
  } as unknown as SafetyGate;

  const engineFactory = (ctx: ExecutionContext) => {
    engineRunCount++;
    return new ClosedLoopEngine(
      {
        sendPrompt: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'no', duration_ms: 1 }),
        continueSession: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'no', duration_ms: 1 })
      },
      {
        health: async () => ({ status: 'ok', agyPath: 'mock' }),
        sendPrompt: async () => {
          agCallCount++;
          return { request_id: 'r', session_id: 's', conversation_id: 'c', status: 'COMPLETED', response: 'err', duration_ms: 1 };
        }
      }
    );
  };

  const dispatcher = new ProjectDispatcher(registry, contextStore, spyResolver, spyGate, engineFactory);
  const result = await dispatcher.dispatch({
    projectId: 'proj-paused',
    initialPrompt: 'Try run on paused project',
    runId: 'RUN-PAUSED-001'
  });

  assert.equal(result.ok, false);
  assert.equal(result.projectContextBlocked, true);
  assert.equal(result.projectContextErrorCode, 'PROJECT_CONTEXT_PAUSED');
  assert.ok(result.projectContextErrorMessage?.includes('PAUSED'));
  assert.equal(result.safetyBlocked, undefined);
  assert.equal(resolverCalled, false, 'WorkspaceResolver must NOT be executed for PAUSED context');
  assert.equal(safetyGateCalled, false, 'SafetyGate must NOT be executed for PAUSED context');
  assert.equal(engineRunCount, 0, 'ClosedLoopEngine must NOT be created/run for PAUSED context');
  assert.equal(agCallCount, 0, 'AG must NEVER be called when project context is PAUSED');
});

test('ProjectDispatcher - ARCHIVED: blocks before WorkspaceResolver, SafetyGate, Engine, and AG (AG_CALL_COUNT = 0)', async (t) => {
  const repoDir = createControlledGitRepo('archived', 'https://github.com/pubcoreagencia/repo-archived.git');
  t.after(() => rmSync(repoDir, { recursive: true, force: true }));

  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-archived',
    projectName: 'Archived Project',
    workspacePath: repoDir,
    repository: 'https://github.com/pubcoreagencia/repo-archived.git',
    defaultBranch: 'main',
    enabled: true
  });

  const contextStore = new MemoryProjectContextStore();
  await contextStore.createInitialContext('proj-archived');
  await contextStore.updateContext('proj-archived', () => ({ status: 'ARCHIVED' }), 1);

  let agCallCount = 0;
  let engineRunCount = 0;
  let resolverCalled = false;
  let safetyGateCalled = false;

  const baseResolver = new WorkspaceResolver(registry);
  const spyResolver = {
    resolve: (id: string, opts: any) => {
      resolverCalled = true;
      return baseResolver.resolve(id, opts);
    }
  } as unknown as WorkspaceResolver;

  const baseGate = new SafetyGate();
  const spyGate = {
    evaluate: (res: any) => {
      safetyGateCalled = true;
      return baseGate.evaluate(res);
    }
  } as unknown as SafetyGate;

  const engineFactory = (ctx: ExecutionContext) => {
    engineRunCount++;
    return new ClosedLoopEngine(
      {
        sendPrompt: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'no', duration_ms: 1 }),
        continueSession: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'no', duration_ms: 1 })
      },
      {
        health: async () => ({ status: 'ok', agyPath: 'mock' }),
        sendPrompt: async () => {
          agCallCount++;
          return { request_id: 'r', session_id: 's', conversation_id: 'c', status: 'COMPLETED', response: 'err', duration_ms: 1 };
        }
      }
    );
  };

  const dispatcher = new ProjectDispatcher(registry, contextStore, spyResolver, spyGate, engineFactory);
  const result = await dispatcher.dispatch({
    projectId: 'proj-archived',
    initialPrompt: 'Try run on archived project',
    runId: 'RUN-ARCHIVED-001'
  });

  assert.equal(result.ok, false);
  assert.equal(result.projectContextBlocked, true);
  assert.equal(result.projectContextErrorCode, 'PROJECT_CONTEXT_ARCHIVED');
  assert.ok(result.projectContextErrorMessage?.includes('ARCHIVED'));
  assert.equal(result.safetyBlocked, undefined);
  assert.equal(resolverCalled, false, 'WorkspaceResolver must NOT be executed for ARCHIVED context');
  assert.equal(safetyGateCalled, false, 'SafetyGate must NOT be executed for ARCHIVED context');
  assert.equal(engineRunCount, 0, 'ClosedLoopEngine must NOT be created/run for ARCHIVED context');
  assert.equal(agCallCount, 0, 'AG must NEVER be called when project context is ARCHIVED');
});

test('ProjectDispatcher - UNINITIALIZED: automatically bootstraps context and proceeds to execution', async (t) => {
  const repoDir = createControlledGitRepo('uninit', 'https://github.com/pubcoreagencia/repo-uninit.git');
  t.after(() => rmSync(repoDir, { recursive: true, force: true }));

  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-uninit',
    projectName: 'Uninit Project',
    workspacePath: repoDir,
    repository: 'https://github.com/pubcoreagencia/repo-uninit.git',
    defaultBranch: 'main',
    enabled: true
  });

  const contextStore = new MemoryProjectContextStore();
  // Ensure no context exists prior to dispatch
  assert.equal(await contextStore.getContext('proj-uninit'), null);

  let agCallCount = 0;
  let engineRunCount = 0;

  const resolver = new WorkspaceResolver(registry);
  const safetyGate = new SafetyGate();

  const engineFactory = (ctx: ExecutionContext) => {
    engineRunCount++;
    return new ClosedLoopEngine(
      {
        sendPrompt: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'bootstrapped [[STATUS: READY]]', duration_ms: 1 }),
        continueSession: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: '[[STATUS: READY]]', duration_ms: 1 })
      },
      {
        health: async () => ({ status: 'ok', agyPath: 'mock' }),
        sendPrompt: async () => {
          agCallCount++;
          return { request_id: 'r', session_id: 's', conversation_id: 'c', status: 'COMPLETED', response: 'ok', duration_ms: 1 };
        }
      },
      { executionContext: ctx }
    );
  };

  const dispatcher = new ProjectDispatcher(registry, contextStore, resolver, safetyGate, engineFactory);
  const result = await dispatcher.dispatch({
    projectId: 'proj-uninit',
    initialPrompt: 'First run bootstraps context',
    runId: 'RUN-UNINIT-001',
    maxTurns: 1
  });

  assert.equal(result.ok, true);
  assert.equal(engineRunCount, 1);
  assert.ok(agCallCount > 0);

  // Check that context was indeed created in store with version 1 and ACTIVE
  const storedCtx = await contextStore.getContext('proj-uninit');
  assert.ok(storedCtx);
  assert.equal(storedCtx.status, 'ACTIVE');
  assert.equal(storedCtx.contextVersion, 1);
});

test('ProjectDispatcher - MISSING: surfaces PROJECT_CONTEXT_MISSING without converting to generic failure', async (t) => {
  const repoDir = createControlledGitRepo('missing', 'https://github.com/pubcoreagencia/repo-missing.git');
  const storeDataDir = mkdtempSync(join(tmpdir(), 'acp-store-missing-'));
  t.after(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(storeDataDir, { recursive: true, force: true });
  });

  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-missing',
    projectName: 'Missing Project',
    workspacePath: repoDir,
    repository: 'https://github.com/pubcoreagencia/repo-missing.git',
    defaultBranch: 'main',
    enabled: true
  });

  const fileStore = new FileProjectContextStore({ baseDataDir: storeDataDir });
  // Initialize context
  await fileStore.createInitialContext('proj-missing');

  // Simulate missing file by deleting context.json while keeping .initialized marker
  const contextFilePath = join(storeDataDir, 'projects', 'proj-missing', 'context.json');
  rmSync(contextFilePath, { force: true });

  let agCallCount = 0;
  let engineRunCount = 0;

  const resolver = new WorkspaceResolver(registry);
  const safetyGate = new SafetyGate();
  const engineFactory = () => {
    engineRunCount++;
    return new ClosedLoopEngine(
      { sendPrompt: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'no', duration_ms: 1 }), continueSession: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'no', duration_ms: 1 }) },
      { health: async () => ({ status: 'ok', agyPath: 'mock' }), sendPrompt: async () => { agCallCount++; return { request_id: 'r', session_id: 's', conversation_id: 'c', status: 'COMPLETED', response: 'err', duration_ms: 1 }; } }
    );
  };

  const dispatcher = new ProjectDispatcher(registry, fileStore, resolver, safetyGate, engineFactory);
  const result = await dispatcher.dispatch({
    projectId: 'proj-missing',
    initialPrompt: 'Run on missing context file',
    runId: 'RUN-MISSING-001'
  });

  assert.equal(result.ok, false);
  assert.equal(result.projectContextBlocked, true);
  assert.equal(result.projectContextErrorCode, 'PROJECT_CONTEXT_MISSING');
  assert.ok(result.projectContextErrorMessage?.includes('PROJECT_CONTEXT_MISSING'));
  assert.equal(engineRunCount, 0);
  assert.equal(agCallCount, 0);
});

test('ProjectDispatcher - CORRUPTED: surfaces PROJECT_CONTEXT_CORRUPTED without converting to generic failure', async (t) => {
  const repoDir = createControlledGitRepo('corrupted', 'https://github.com/pubcoreagencia/repo-corrupted.git');
  const storeDataDir = mkdtempSync(join(tmpdir(), 'acp-store-corrupted-'));
  t.after(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(storeDataDir, { recursive: true, force: true });
  });

  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-corrupted',
    projectName: 'Corrupted Project',
    workspacePath: repoDir,
    repository: 'https://github.com/pubcoreagencia/repo-corrupted.git',
    defaultBranch: 'main',
    enabled: true
  });

  const fileStore = new FileProjectContextStore({ baseDataDir: storeDataDir });
  await fileStore.createInitialContext('proj-corrupted');

  // Corrupt the context.json file
  const contextFilePath = join(storeDataDir, 'projects', 'proj-corrupted', 'context.json');
  writeFileSync(contextFilePath, '{ invalid_json_syntax: true');

  let agCallCount = 0;
  let engineRunCount = 0;

  const resolver = new WorkspaceResolver(registry);
  const safetyGate = new SafetyGate();
  const engineFactory = () => {
    engineRunCount++;
    return new ClosedLoopEngine(
      { sendPrompt: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'no', duration_ms: 1 }), continueSession: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'no', duration_ms: 1 }) },
      { health: async () => ({ status: 'ok', agyPath: 'mock' }), sendPrompt: async () => { agCallCount++; return { request_id: 'r', session_id: 's', conversation_id: 'c', status: 'COMPLETED', response: 'err', duration_ms: 1 }; } }
    );
  };

  const dispatcher = new ProjectDispatcher(registry, fileStore, resolver, safetyGate, engineFactory);
  const result = await dispatcher.dispatch({
    projectId: 'proj-corrupted',
    initialPrompt: 'Run on corrupted context file',
    runId: 'RUN-CORRUPTED-001'
  });

  assert.equal(result.ok, false);
  assert.equal(result.projectContextBlocked, true);
  assert.equal(result.projectContextErrorCode, 'PROJECT_CONTEXT_CORRUPTED');
  assert.ok(result.projectContextErrorMessage?.includes('PROJECT_CONTEXT_CORRUPTED'));
  assert.equal(engineRunCount, 0);
  assert.equal(agCallCount, 0);
});

test('ProjectDispatcher - UNKNOWN PROJECT: returns existing ProjectRegistry failure without context lookup', async () => {
  const registry = new ProjectRegistry();
  const contextStore = new MemoryProjectContextStore();
  const resolver = new WorkspaceResolver(registry);
  const safetyGate = new SafetyGate();

  let contextStoreQueried = false;
  const spyContextStore = {
    getContext: async (id: string) => {
      contextStoreQueried = true;
      return contextStore.getContext(id);
    },
    createInitialContext: (id: string) => contextStore.createInitialContext(id),
    updateContext: (id: string, u: any, v: number) => contextStore.updateContext(id, u, v),
    hasContext: (id: string) => contextStore.hasContext(id)
  };

  const engineFactory = () => {
    throw new Error('Should not be called');
  };

  const dispatcher = new ProjectDispatcher(registry, spyContextStore, resolver, safetyGate, engineFactory);
  const result = await dispatcher.dispatch({
    projectId: 'non-existent-project',
    initialPrompt: 'Run unknown'
  });

  assert.equal(result.ok, false);
  assert.equal(result.safetyBlocked, true);
  assert.equal(result.blockedReason, 'UNKNOWN_PROJECT');
  assert.equal(contextStoreQueried, false, 'Context store should NOT be queried if project resolution fails');
});

test('ProjectDispatcher - PROJECT/WORKSPACE MISMATCH: SafetyGate blocks execution with AG_CALL_COUNT = 0', async (t) => {
  const repoA = createControlledGitRepo('mismatch-a', 'https://github.com/pubcoreagencia/repo-a.git');
  const repoB = createControlledGitRepo('mismatch-b', 'https://github.com/pubcoreagencia/repo-b.git');
  t.after(() => {
    rmSync(repoA, { recursive: true, force: true });
    rmSync(repoB, { recursive: true, force: true });
  });

  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'project-a',
    projectName: 'Project A',
    // Incompatible: configured to point to repoB's workspace path
    workspacePath: repoB,
    repository: 'https://github.com/pubcoreagencia/repo-a.git',
    defaultBranch: 'main',
    enabled: true
  });

  const contextStore = new MemoryProjectContextStore();
  let agCallCount = 0;

  const resolver = new WorkspaceResolver(registry);
  const safetyGate = new SafetyGate();
  const engineFactory = () => {
    return new ClosedLoopEngine(
      { sendPrompt: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'no', duration_ms: 1 }), continueSession: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'no', duration_ms: 1 }) },
      { health: async () => ({ status: 'ok', agyPath: 'mock' }), sendPrompt: async () => { agCallCount++; return { request_id: 'r', session_id: 's', conversation_id: 'c', status: 'COMPLETED', response: 'err', duration_ms: 1 }; } }
    );
  };

  const dispatcher = new ProjectDispatcher(registry, contextStore, resolver, safetyGate, engineFactory);
  const result = await dispatcher.dispatch({
    projectId: 'project-a',
    initialPrompt: 'Dangerous instruction',
    runId: 'RUN-MISMATCH-001'
  });

  // ProjectContext passes (bootstraps ACTIVE), then SafetyGate blocks due to repo mismatch
  assert.equal(result.ok, false);
  assert.equal(result.safetyBlocked, true);
  assert.equal(result.blockedReason, 'WORKSPACE_REPOSITORY_MISMATCH');
  assert.equal(agCallCount, 0, 'AG must NEVER be invoked when safety gate blocks execution');
});
