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
      undefined,
      {
        id: 'test-runtime',
        provider: 'test',
        version: '1',
        capabilities: {
          supported: ['filesystem.read', 'filesystem.write', 'shell.execute'],
          supportsStreaming: false,
          requiresHumanApproval: false,
          isHeadless: true
        },
        checkHealth: async () => ({ healthy: true, availableCapacity: 1 }),
        execute: async () => ({
          runId: 'runtime-run',
          status: 'COMPLETED',
          output: 'done',
          metrics: { durationMs: 1 }
        })
      } as any,
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

test('ProjectDispatcher - Conversation Safety: passes valid conversation belonging to workspace and propagates conversationId', async () => {
  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-valid-conv',
    projectName: 'Project Valid Conv',
    workspacePath: process.cwd(),
    repository: 'pubcoreagencia/pub-acp-standalone',
    defaultBranch: 'main',
    enabled: true
  });

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

  let receivedConversationId: string | undefined;
  const engineFactory = (ctx: any) => {
    return {
      runLoop: async (prompt: string, opts: any) => {
        receivedConversationId = opts.conversationId;
        return {
          loop_id: opts.loopId,
          gpt_session_id: 'gpt-s',
          antigravity_session_id: 'ag-s',
          antigravity_conversation_id: receivedConversationId || null,
          total_turns: 1,
          status: 'COMPLETED',
          turns: [],
          total_duration_ms: 10,
          started_at: '',
          completed_at: '',
          manual_copy_paste_operations: 0
        };
      }
    } as any;
  };

  const mockSessionStore = {
    listConversationsForWorkspace: async () => [],
    getConversation: async () => null,
    belongsToWorkspace: async (convId: string, wsPath: string) => {
      return convId === 'conv-valid-uuid' && wsPath === process.cwd();
    }
  };

  const contextStore = new MemoryProjectContextStore();
  const dispatcher = new ProjectDispatcher(registry, contextStore, resolver, safetyGate, engineFactory, eventBus, mockSessionStore);

  const result = await dispatcher.dispatch({
    projectId: 'proj-valid-conv',
    initialPrompt: 'Resume task in conversation',
    conversationId: 'conv-valid-uuid',
    maxTurns: 1
  });

  assert.equal(result.ok, true);
  assert.equal(result.safetyBlocked, false);
  assert.equal(result.context?.conversationId, 'conv-valid-uuid');
  assert.equal(receivedConversationId, 'conv-valid-uuid');
});

test('ProjectDispatcher - Conversation Safety: blocks non-existent or foreign conversation before engine execution (AG_CALL_COUNT = 0)', async () => {
  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-blocked-conv',
    projectName: 'Project Blocked Conv',
    workspacePath: process.cwd(),
    repository: 'pubcoreagencia/pub-acp-standalone',
    defaultBranch: 'main',
    enabled: true
  });

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

  let engineExecuted = false;
  const engineFactory = () => {
    engineExecuted = true;
    return {} as any;
  };

  const mockSessionStore = {
    listConversationsForWorkspace: async () => [],
    getConversation: async () => null,
    belongsToWorkspace: async (convId: string) => {
      // conversation belongs to another workspace or doesn't exist
      return false;
    }
  };

  const contextStore = new MemoryProjectContextStore();
  const dispatcher = new ProjectDispatcher(registry, contextStore, resolver, safetyGate, engineFactory, eventBus, mockSessionStore);

  const result = await dispatcher.dispatch({
    projectId: 'proj-blocked-conv',
    initialPrompt: 'Malicious or mismatched conversation attempt',
    conversationId: 'conv-foreign-uuid',
    maxTurns: 1
  });

  assert.equal(result.ok, false);
  assert.equal(result.safetyBlocked, true);
  assert.equal(result.blockedReason, 'SECURITY_RULE_VIOLATION');
  assert.ok(result.blockedMessage?.includes('does not belong to project workspace'));
  assert.equal(engineExecuted, false, 'ClosedLoopEngine must NEVER be initialized or executed');

  const blockedEvent = emittedEvents.find(e => e.type === 'SAFETY_GATE_BLOCKED');
  assert.ok(blockedEvent, 'SAFETY_GATE_BLOCKED event must be emitted');
  assert.equal(blockedEvent?.details?.reason, 'SECURITY_RULE_VIOLATION');
});

test('ProjectDispatcher - Workspace Lock: cross-project targeting same workspace blocks second project (AG_CALL_COUNT = 0)', async () => {
  const registry = new ProjectRegistry();
  // Project Alpha and Project Beta share the exact same workspacePath
  registry.registerProject({
    projectId: 'shared-proj-alpha',
    projectName: 'Shared Project Alpha',
    workspacePath: process.cwd(),
    repository: 'pubcoreagencia/pub-acp-standalone',
    defaultBranch: 'main',
    enabled: true
  });
  registry.registerProject({
    projectId: 'shared-proj-beta',
    projectName: 'Shared Project Beta',
    workspacePath: process.cwd(),
    repository: 'pubcoreagencia/pub-acp-standalone',
    defaultBranch: 'main',
    enabled: true
  });

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

  let agCallCount = 0;
  let activeEnginePromiseResolve: () => void;
  const activeEnginePromise = new Promise<void>(resolve => {
    activeEnginePromiseResolve = resolve;
  });

  const engineFactory = (ctx: any) => {
    return {
      runLoop: async () => {
        agCallCount++;
        // Keep engine active until released by test
        await activeEnginePromise;
        return {
          status: 'COMPLETED',
          total_turns: 1,
          turns: []
        };
      }
    } as any;
  };

  const contextStore = new MemoryProjectContextStore();
  const dispatcher = new ProjectDispatcher(registry, contextStore, resolver, safetyGate, engineFactory, eventBus);

  // 1. Dispatch Run 1 on project Alpha (holds the lock)
  const run1Promise = dispatcher.dispatch({
    projectId: 'shared-proj-alpha',
    initialPrompt: 'Task 1 in shared workspace',
    runId: 'RUN-SHARED-1',
    maxTurns: 1
  });

  // Yield to allow run 1 to acquire the lock and start running
  await new Promise(r => setTimeout(r, 20));

  // 2. Dispatch Run 2 on project Beta (same workspace)
  const result2 = await dispatcher.dispatch({
    projectId: 'shared-proj-beta',
    initialPrompt: 'Task 2 in shared workspace',
    runId: 'RUN-SHARED-2',
    maxTurns: 1
  });

  // Result 2 must be blocked immediately by WORKSPACE_ALREADY_LOCKED
  assert.equal(result2.ok, false);
  assert.equal(result2.safetyBlocked, true);
  assert.equal(result2.blockedReason, 'WORKSPACE_ALREADY_LOCKED');
  assert.ok(result2.blockedMessage?.includes('currently locked by run \'RUN-SHARED-1\''));

  // Release Run 1
  activeEnginePromiseResolve!();
  const result1 = await run1Promise;
  assert.equal(result1.ok, true);

  // AG was called only once (by Run 1, never by Run 2)
  assert.equal(agCallCount, 1);

  // Verify events
  const lockAcquiredEvt = emittedEvents.find(e => e.type === 'WORKSPACE_LOCK_ACQUIRED');
  assert.ok(lockAcquiredEvt);
  assert.equal(lockAcquiredEvt?.details?.owner, 'RUN-SHARED-1');

  const lockBlockedEvt = emittedEvents.find(e => e.type === 'WORKSPACE_LOCK_BLOCKED');
  assert.ok(lockBlockedEvt);
  assert.equal(lockBlockedEvt?.details?.lockedByRunId, 'RUN-SHARED-1');
  assert.equal(lockBlockedEvt?.details?.reason, 'WORKSPACE_ALREADY_LOCKED');

  const lockReleasedEvt = emittedEvents.find(e => e.type === 'WORKSPACE_LOCK_RELEASED');
  assert.ok(lockReleasedEvt);
  assert.equal(lockReleasedEvt?.details?.owner, 'RUN-SHARED-1');
});

test('ProjectDispatcher - Workspace Lock: different conversation on same workspace is blocked while active', async () => {
  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-conv-lock',
    projectName: 'Project Conv Lock',
    workspacePath: process.cwd(),
    repository: 'pubcoreagencia/pub-acp-standalone',
    defaultBranch: 'main',
    enabled: true
  });

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

  let unblockEngine: () => void;
  const engineBlock = new Promise<void>(res => { unblockEngine = res; });

  const engineFactory = () => ({
    runLoop: async () => {
      await engineBlock;
      return { status: 'COMPLETED', total_turns: 1, turns: [] };
    }
  } as any);

  const mockSessionStore = {
    listConversationsForWorkspace: async () => [],
    getConversation: async () => null,
    belongsToWorkspace: async () => true
  };

  const contextStore = new MemoryProjectContextStore();
  const dispatcher = new ProjectDispatcher(registry, contextStore, resolver, safetyGate, engineFactory, eventBus, mockSessionStore);

  // Run 1 in conv-X
  const run1Promise = dispatcher.dispatch({
    projectId: 'proj-conv-lock',
    initialPrompt: 'Run in conv X',
    conversationId: 'conv-x-uuid',
    runId: 'RUN-CONV-X'
  });

  await new Promise(r => setTimeout(r, 20));

  // Run 2 in conv-Y (same workspace)
  const res2 = await dispatcher.dispatch({
    projectId: 'proj-conv-lock',
    initialPrompt: 'Run in conv Y',
    conversationId: 'conv-y-uuid',
    runId: 'RUN-CONV-Y'
  });

  assert.equal(res2.ok, false);
  assert.equal(res2.safetyBlocked, true);
  assert.equal(res2.blockedReason, 'WORKSPACE_ALREADY_LOCKED');

  unblockEngine!();
  const res1 = await run1Promise;
  assert.equal(res1.ok, true);
});

test('ProjectDispatcher - Workspace Lock: exception in engine execution reliably releases lock', async () => {
  const registry = new ProjectRegistry();
  registry.registerProject({
    projectId: 'proj-exception-lock',
    projectName: 'Project Exception Lock',
    workspacePath: process.cwd(),
    repository: 'pubcoreagencia/pub-acp-standalone',
    defaultBranch: 'main',
    enabled: true
  });

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

  let shouldThrow = true;
  const engineFactory = () => ({
    runLoop: async () => {
      if (shouldThrow) {
        throw new Error('Fatal crash during engine execution!');
      }
      return { status: 'COMPLETED', total_turns: 1, turns: [] };
    }
  } as any);

  const contextStore = new MemoryProjectContextStore();
  const dispatcher = new ProjectDispatcher(registry, contextStore, resolver, safetyGate, engineFactory, eventBus);

  // Run 1 throws fatal exception
  await assert.rejects(
    async () => {
      await dispatcher.dispatch({
        projectId: 'proj-exception-lock',
        initialPrompt: 'Will crash',
        runId: 'RUN-CRASH'
      });
    },
    /Fatal crash during engine execution!/
  );

  // Run 2 must immediately be able to acquire lock because finally released it
  shouldThrow = false;
  const res2 = await dispatcher.dispatch({
    projectId: 'proj-exception-lock',
    initialPrompt: 'Will succeed after crash',
    runId: 'RUN-SUCCESS-AFTER-CRASH'
  });

  assert.equal(res2.ok, true);
  assert.equal(res2.safetyBlocked, false);
});


