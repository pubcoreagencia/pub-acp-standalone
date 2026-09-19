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
import { IAgentRuntime } from '../../src/runtime/IAgentRuntime.js';


function createTestRuntime(onExecute?: () => void): IAgentRuntime {
  return {
    id: 'test-runtime',
    provider: 'test',
    version: 'v1',
    capabilities: {
      supported: ['filesystem.read', 'filesystem.write', 'shell.execute', 'git.read', 'git.write', 'test.execute', 'headless'],
      supportsStreaming: false,
      requiresHumanApproval: false,
      isHeadless: true
    },
    checkHealth: async () => ({ healthy: true, availableCapacity: 1 }),
    execute: async (plan) => {
      onExecute?.();
      return {
        runId: plan.planId,
        status: 'COMPLETED',
        output: 'Task done [[STATUS: READY]]',
        metrics: { durationMs: 1, turnsCount: 1 }
      };
    }
  };
}

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

test('ProjectDispatcher - ACTIVE: executes ClosedLoopEngine and invokes generic runtime', async (t) => {
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

  let runtimeCallCount = 0;
  let engineRunCount = 0;

  const resolver = new WorkspaceResolver(registry);
  const safetyGate = new SafetyGate();
  const eventBus = new EventBus();

  const engineFactory = (ctx: ExecutionContext) => {
    engineRunCount++;
    return new ClosedLoopEngine(undefined, createTestRuntime(() => runtimeCallCount++), {
        eventBus,
        executionContext: ctx
      }
    );
  };

  const dispatcher = new ProjectDispatcher(registry, contextStore, resolver, safetyGate, engineFactory, eventBus);
  const result = await dispatcher.dispatch({
    projectId: 'proj-active')