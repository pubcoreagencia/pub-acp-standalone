import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectRegistry } from '../../src/multiproject/ProjectRegistry.js';
import { WorkspaceResolver, GitInspector } from '../../src/multiproject/WorkspaceResolver.js';
import { SafetyGate } from '../../src/multiproject/SafetyGate.js';
import { ProjectDispatcher } from '../../src/multiproject/ProjectDispatcher.js';
import { ClosedLoopEngine } from '../../src/bridge/index.js';
import { EventBus } from '../../src/observability/EventBus.js';
import { AutonomyEvent } from '../../src/observability/types.js';
import { MemoryProjectContextStore } from '../../src/context/MemoryProjectContextStore.js';

class MockGitInspector implements GitInspector {
  constructor(
    private readonly repoMap: Record<string, { isRepo: boolean; remote?: string; branch?: string; commit?: string }> = {}
  ) {}

  isGitRepo(path: string): boolean {
    return this.repoMap[path]?.isRepo ?? true;
  }
  getRemoteUrl(path: string): string | null {
    return this.repoMap[path]?.remote ?? 'https://github.com/pubcoreagencia/mock-repo';
  }
  getCurrentBranch(path: string): string | null {
    return this.repoMap[path]?.branch ?? 'main';
  }
  getLastCommit(path: string): string | null {
    return this.repoMap[path]?.commit ?? 'a1b2c3d initial commit';
  }
}

test('ProjectRegistry - registers, finds, lists, and blocks unknown/disabled', () => {
  const registry = new ProjectRegistry();

  registry.registerProject({
    projectId: 'project-a',
    projectName: 'Project Alpha',
    workspacePath: process.cwd(),
    repository: 'pubcoreagencia/project-a',
    defaultBranch: 'main',
    enabled: true
  });

  registry.registerProject({
    projectId: 'project-disabled',
    projectName: 'Disabled Project',
    workspacePath: process.cwd(),
    repository: 'pubcoreagencia/project-disabled',
    defaultBranch: 'main',
    enabled: false
  });

  assert.equal(registry.hasProject('project-a'), true);
  assert.equal(registry.hasProject('project-a '), true); // trim case insensitive
  assert.equal(registry.getProject('project-a')?.projectName, 'Project Alpha');
  assert.equal(registry.hasProject('unknown-proj'), false);
  assert.equal(registry.getProject('unknown-proj'), undefined);
  assert.equal(registry.listProjects().length, 2);
});

test('WorkspaceResolver - passes on valid workspace and repo match', () => {
  const registry = new ProjectRegistry([
    {
      projectId: 'proj-ok',
      projectName: 'OK Project',
      workspacePath: process.cwd(),
      repository: 'pubcoreagencia/pub-acp-standalone',
      defaultBranch: 'main',
      enabled: true
    }
  ]);

  const gitInspector = new MockGitInspector({
    [process.cwd()]: {
      isRepo: true,
      remote: 'https://github.com/pubcoreagencia/pub-acp-standalone.git',
      branch: 'main',
      commit: '01a12e2 feat: ok'
    }
  });

  const resolver = new WorkspaceResolver(registry, gitInspector);
  const res = resolver.resolve('proj-ok', { taskId: 'task-123' });

  assert.equal(res.ok, true);
  assert.ok(res.context);
  assert.equal(res.context.projectId, 'proj-ok');
  assert.equal(res.context.workspacePath, process.cwd());
  assert.equal(res.context.taskId, 'task-123');
  assert.equal(res.context.branch, 'main');
});

test('WorkspaceResolver - blocks unknown project, disabled project, missing workspace, not a git repo, repo mismatch, and branch mismatch', () => {
  const registry = new ProjectRegistry([
    {
      projectId: 'disabled-proj',
      projectName: 'Disabled',
      workspacePath: process.cwd(),
      repository: 'pubcoreagencia/repo',
      defaultBranch: 'main',
      enabled: false
    },
    {
      projectId: 'non-existent-ws',
      projectName: 'Non Existent WS',
      workspacePath: 'C:\\non_existent_folder_xyz_12345',
      repository: 'pubcoreagencia/repo',
      defaultBranch: 'main',
      enabled: true
    },
    {
      projectId: 'not-git-repo',
      projectName: 'Not Git',
      workspacePath: process.cwd(),
      repository: 'pubcoreagencia/repo',
      defaultBranch: 'main',
      enabled: true
    },
    {
      projectId: 'repo-mismatch',
      projectName: 'Repo Mismatch',
      workspacePath: process.cwd(),
      repository: 'pubcoreagencia/expected-repo',
      defaultBranch: 'main',
      enabled: true
    },
    {
      projectId: 'branch-mismatch',
      projectName: 'Branch Mismatch',
      workspacePath: process.cwd(),
      repository: 'pubcoreagencia/expected-repo',
      defaultBranch: 'main',
      enabled: true
    }
  ]);

  const gitInspector = new MockGitInspector({
    [process.cwd()]: {
      isRepo: true,
      remote: 'https://github.com/pubcoreagencia/other-repo.git',
      branch: 'feature/other-branch'
    }
  });

  const resolver = new WorkspaceResolver(registry, gitInspector);

  // 1. Unknown
  const resUnknown = resolver.resolve('ghost-project');
  assert.equal(resUnknown.ok, false);
  assert.equal(resUnknown.reason, 'UNKNOWN_PROJECT');

  // 2. Disabled
  const resDisabled = resolver.resolve('disabled-proj');
  assert.equal(resDisabled.ok, false);
  assert.equal(resDisabled.reason, 'PROJECT_DISABLED');

  // 3. Workspace not found
  const resMissing = resolver.resolve('non-existent-ws');
  assert.equal(resMissing.ok, false);
  assert.equal(resMissing.reason, 'WORKSPACE_NOT_FOUND');

  // 4. Not a git repo
  const notGitInspector = new MockGitInspector({
    [process.cwd()]: { isRepo: false }
  });
  const resolverNotGit = new WorkspaceResolver(registry, notGitInspector);
  const resNotGit = resolverNotGit.resolve('not-git-repo');
  assert.equal(resNotGit.ok, false);
  assert.equal(resNotGit.reason, 'NOT_A_GIT_REPOSITORY');

  // 5. Repo mismatch
  const resMismatch = resolver.resolve('repo-mismatch');
  assert.equal(resMismatch.ok, false);
  assert.equal(resMismatch.reason, 'WORKSPACE_REPOSITORY_MISMATCH');

  // 6. Branch mismatch
  const gitInspectorBranch = new MockGitInspector({
    [process.cwd()]: {
      isRepo: true,
      remote: 'https://github.com/pubcoreagencia/expected-repo',
      branch: 'develop'
    }
  });
  const resolverBranch = new WorkspaceResolver(registry, gitInspectorBranch);
  const resBranchMismatch = resolverBranch.resolve('branch-mismatch');
  assert.equal(resBranchMismatch.ok, false);
  assert.equal(resBranchMismatch.reason, 'WORKSPACE_BRANCH_MISMATCH');
});

test('SafetyGate - passes valid context and blocks invalid/root filesystem access', () => {
  const gate = new SafetyGate();

  const validRes = {
    ok: true,
    context: {
      runId: 'run-1',
      taskId: 'task-1',
      projectId: 'proj-1',
      projectName: 'Proj 1',
      workspacePath: process.cwd(),
      repository: 'pubcoreagencia/proj-1',
      branch: 'main'
    }
  };

  const gatePass = gate.evaluate(validRes);
  assert.equal(gatePass.passed, true);
  assert.equal(gatePass.context?.runId, 'run-1');

  // Root directory security violation
  const rootRes = {
    ok: true,
    context: {
      runId: 'run-2',
      taskId: 'task-2',
      projectId: 'proj-root',
      projectName: 'Root Proj',
      workspacePath: 'C:\\',
      repository: 'pubcoreagencia/root',
      branch: 'main'
    }
  };
  const gateRoot = gate.evaluate(rootRes);
  assert.equal(gateRoot.passed, false);
  assert.equal(gateRoot.reason, 'SECURITY_RULE_VIOLATION');
});

test('ProjectDispatcher - executes full flow and propagates execution context', async () => {
  const registry = new ProjectRegistry([
    {
      projectId: 'project-alpha',
      projectName: 'Alpha System',
      workspacePath: process.cwd(),
      repository: 'pubcoreagencia/pub-acp-standalone',
      defaultBranch: 'main',
      enabled: true
    }
  ]);

  const gitInspector = new MockGitInspector({
    [process.cwd()]: {
      isRepo: true,
      remote: 'https://github.com/pubcoreagencia/pub-acp-standalone',
      branch: 'main'
    }
  });

  const resolver = new WorkspaceResolver(registry, gitInspector);
  const safetyGate = new SafetyGate();
  const eventBus = new EventBus();

  const emittedEvents: AutonomyEvent[] = [];
  eventBus.subscribe('*', e => emittedEvents.push(e));

  let engineExecutedCwd = '';
  const engineFactory = (ctx: any) => {
    engineExecutedCwd = ctx.workspacePath;
    return new ClosedLoopEngine(
      {
        health: async () => ({ status: 'ok', initialized: true }),
        createSession: () => 'sess',
        sendPrompt: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'ok', duration_ms: 5 }),
        continueSession: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'ok', duration_ms: 5 })
      },
      {
        health: async () => ({ status: 'ok', agyPath: 'mock' }),
        sendPrompt: async () => ({ request_id: 'r', session_id: 's', conversation_id: 'c', status: 'COMPLETED', response: 'done', duration_ms: 5 })
      },
      {
        eventBus,
        executionContext: ctx
      }
    );
  };

  const contextStore = new MemoryProjectContextStore();
  const dispatcher = new ProjectDispatcher(registry, contextStore, resolver, safetyGate, engineFactory, eventBus);
  const result = await dispatcher.dispatch({
    projectId: 'project-alpha',
    initialPrompt: 'Run project turn',
    runId: 'RUN-DISPATCH-001',
    maxTurns: 1
  });

  assert.equal(result.ok, true);
  assert.equal(result.runId, 'RUN-DISPATCH-001');
  assert.equal(result.safetyBlocked, false);
  assert.equal(engineExecutedCwd, process.cwd());

  // Check lifecycle event progression
  const eventTypes = emittedEvents.map(e => e.type);
  assert.ok(eventTypes.includes('RUN_CREATED'));
  assert.ok(eventTypes.includes('PROJECT_RESOLUTION_STARTED'));
  assert.ok(eventTypes.includes('PROJECT_RESOLVED'));
  assert.ok(eventTypes.includes('WORKSPACE_VALIDATION_STARTED'));
  assert.ok(eventTypes.includes('WORKSPACE_VALIDATED'));
  assert.ok(eventTypes.includes('SAFETY_GATE_STARTED'));
  assert.ok(eventTypes.includes('SAFETY_GATE_PASSED'));
  assert.ok(eventTypes.includes('RUN_STARTED'));
  assert.ok(eventTypes.includes('RUN_COMPLETED'));
});
