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
import { MemoryRunStore } from '../../src/observability/RunStore.js';
import { ControlRoomServer } from '../../src/server/ControlRoomServer.js';
import { MemoryProjectContextStore } from '../../src/context/MemoryProjectContextStore.js';

function createControlledGitRepo(prefix: string, originUrl: string, branch = 'main'): string {
  const dir = mkdtempSync(join(tmpdir(), `acp-${prefix}-`));
  execFileSync('git', ['init', '-b', branch], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ACP Tester'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'tester@acp.local'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', originUrl], { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), `# ${prefix}\nControlled test repository`);
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', `initial commit for ${prefix}`], { cwd: dir, stdio: 'ignore' });
  return dir;
}

test('Multi-Project Proof: Executes project-a and project-b in total isolation without cross-contamination', async () => {
  const repoA = createControlledGitRepo('project-a', 'https://github.com/pubcoreagencia/controlled-repo-a.git', 'main');
  const repoB = createControlledGitRepo('project-b', 'https://github.com/pubcoreagencia/controlled-repo-b.git', 'main');

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
    const registry = new ProjectRegistry([
      {
        projectId: 'project-a',
        projectName: 'Alpha Controlled Project',
        workspacePath: repoA,
        repository: 'pubcoreagencia/controlled-repo-a',
        defaultBranch: 'main',
        enabled: true
      },
      {
        projectId: 'project-b',
        projectName: 'Beta Controlled Project',
        workspacePath: repoB,
        repository: 'pubcoreagencia/controlled-repo-b',
        defaultBranch: 'main',
        enabled: true
      }
    ]);

    const resolver = new WorkspaceResolver(registry);
    const safetyGate = new SafetyGate();

    const agCallsPerRun = new Map<string, string[]>();

    const engineFactory = (ctx: any) => {
      return new ClosedLoopEngine(
        {
          health: async () => ({ status: 'ok', initialized: true }),
          createSession: () => `sess-${ctx.projectId}`,
          sendPrompt: async (prompt, opts) => ({
            request_id: opts?.request_id || 'req',
            session_id: opts?.session_id || 'sess',
            status: 'COMPLETED',
            text: `Instruction for ${ctx.projectId}`,
            duration_ms: 5
          }),
          continueSession: async (sess, prompt, opts) => ({
            request_id: opts?.request_id || 'req',
            session_id: sess,
            status: 'COMPLETED',
            text: `Instruction for ${ctx.projectId}`,
            duration_ms: 5
          })
        },
        {
          health: async () => ({ status: 'ok', agyPath: 'mock' }),
          sendPrompt: async (prompt, opts) => {
            const list = agCallsPerRun.get(ctx.runId) || [];
            list.push(opts?.cwd || '');
            agCallsPerRun.set(ctx.runId, list);
            return {
              request_id: opts?.request_id || 'ag-req',
              session_id: opts?.session_id || 'ag-sess',
              conversation_id: `conv-${ctx.projectId}`,
              status: 'COMPLETED',
              response: `Executed in ${opts?.cwd}`,
              duration_ms: 10
            };
          }
        },
        {
          eventBus,
          executionContext: ctx
        }
      );
    };

    const contextStore = new MemoryProjectContextStore();
    const dispatcher = new ProjectDispatcher(registry, contextStore, resolver, safetyGate, engineFactory, eventBus);

    // 1. Run A
    const resA = await dispatcher.dispatch({
      projectId: 'project-a',
      initialPrompt: 'Task A execution',
      runId: 'RUN-ALPHA-001',
      taskId: 'TASK-A-01',
      maxTurns: 1
    });

    assert.equal(resA.ok, true);
    assert.equal(resA.runId, 'RUN-ALPHA-001');
    assert.equal(resA.context?.workspacePath, repoA);
    assert.equal(resA.context?.projectId, 'project-a');

    // 2. Run B
    const resB = await dispatcher.dispatch({
      projectId: 'project-b',
      initialPrompt: 'Task B execution',
      runId: 'RUN-BETA-001',
      taskId: 'TASK-B-01',
      maxTurns: 1
    });

    assert.equal(resB.ok, true);
    assert.equal(resB.runId, 'RUN-BETA-001');
    assert.equal(resB.context?.workspacePath, repoB);
    assert.equal(resB.context?.projectId, 'project-b');

    // 3. Verify absolute isolation in execution
    const cwdsA = agCallsPerRun.get('RUN-ALPHA-001');
    const cwdsB = agCallsPerRun.get('RUN-BETA-001');

    assert.equal(cwdsA?.length, 1);
    assert.equal(cwdsA?.[0], repoA);
    assert.notEqual(cwdsA?.[0], repoB);

    assert.equal(cwdsB?.length, 1);
    assert.equal(cwdsB?.[0], repoB);
    assert.notEqual(cwdsB?.[0], repoA);

    // 4. Verify Control Room API observes both runs distinctly
    const apiRunsRes = await fetch(`${url}/api/runs`);
    const apiRuns = await apiRunsRes.json() as any[];
    assert.equal(apiRuns.length, 2);

    const apiRunA = apiRuns.find(r => r.runId === 'RUN-ALPHA-001');
    const apiRunB = apiRuns.find(r => r.runId === 'RUN-BETA-001');

    assert.ok(apiRunA);
    assert.ok(apiRunB);
    assert.equal(apiRunA.projectId, 'project-a');
    assert.equal(apiRunA.workspace.path, repoA);
    assert.equal(apiRunB.projectId, 'project-b');
    assert.equal(apiRunB.workspace.path, repoB);
  } finally {
    await server.stop();
    rmSync(repoA, { recursive: true, force: true });
    rmSync(repoB, { recursive: true, force: true });
  }
});

test('Negative Safety Test: Incompatible workspace repository BLOCKS execution and AG is NEVER called (AG_CALL_COUNT = 0)', async () => {
  // Create workspace with repo-b, but configure registry as project-a with expected repo-a
  const repoMismatchWorkspace = createControlledGitRepo('mismatch-ws', 'https://github.com/pubcoreagencia/wrong-repo-b.git', 'main');

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
    const registry = new ProjectRegistry([
      {
        projectId: 'project-a',
        projectName: 'Alpha Expected',
        workspacePath: repoMismatchWorkspace, // Pointing to wrong-repo-b
        repository: 'pubcoreagencia/expected-repo-a',
        defaultBranch: 'main',
        enabled: true
      }
    ]);

    const resolver = new WorkspaceResolver(registry);
    const safetyGate = new SafetyGate();

    let agCallCount = 0;
    const engineFactory = (ctx: any) => {
      return new ClosedLoopEngine(
        {
          health: async () => ({ status: 'ok', initialized: true }),
          createSession: () => 'sess',
          sendPrompt: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'ok', duration_ms: 1 }),
          continueSession: async () => ({ request_id: 'r', session_id: 's', status: 'COMPLETED', text: 'ok', duration_ms: 1 })
        },
        {
          health: async () => ({ status: 'ok', agyPath: 'mock' }),
          sendPrompt: async () => {
            agCallCount++;
            return {
              request_id: 'r',
              session_id: 's',
              conversation_id: 'c',
              status: 'COMPLETED',
              response: 'UNEXPECTED_CALL',
              duration_ms: 1
            };
          }
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
      projectId: 'project-a',
      initialPrompt: 'Dangerous instruction',
      runId: 'RUN-SAFETY-BLOCKED-001',
      taskId: 'TASK-BLOCKED-01'
    });

    // 1. Result must be blocked by Safety Gate
    assert.equal(result.ok, false);
    assert.equal(result.safetyBlocked, true);
    assert.equal(result.blockedReason, 'WORKSPACE_REPOSITORY_MISMATCH');

    // 2. CRITICAL PROOF: AG was NEVER called
    assert.equal(agCallCount, 0, 'SAFETY GATE FAILURE: AG was invoked when it should have been blocked!');

    // 3. Verify EventBus contains SAFETY_GATE_BLOCKED and NO AG_STARTED event
    const events = eventBus.getRecentEvents('RUN-SAFETY-BLOCKED-001');
    const types = events.map(e => e.type);

    assert.ok(types.includes('SAFETY_GATE_BLOCKED'));
    assert.equal(types.includes('AG_STARTED'), false, 'AG_STARTED event must NOT exist for blocked run');

    // 4. Verify Control Room records the run as BLOCKED
    const runRes = await fetch(`${url}/api/runs/RUN-SAFETY-BLOCKED-001`);
    const recordedRun = await runRes.json() as any;
    assert.equal(recordedRun.status, 'BLOCKED');
    assert.equal(recordedRun.agExecutions, 0);
  } finally {
    await server.stop();
    rmSync(repoMismatchWorkspace, { recursive: true, force: true });
  }
});
