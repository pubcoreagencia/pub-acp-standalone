import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceResolver, GitInspector } from '../../src/multiproject/WorkspaceResolver.js';
import { SafetyGate } from '../../src/multiproject/SafetyGate.js';
import { ClosedLoopEngine } from '../../src/bridge/ClosedLoopEngine.js';
import { IGptTransport, GptPromptResponse } from '../../src/gpt/types.js';
import { IAntigravityTransport, AntigravityExecutionResult, AntigravityPromptOptions } from '../../src/antigravity/types.js';

class MockGitInspector implements GitInspector {
  constructor(
    private readonly repoMap: Record<string, { isRepo: boolean; remote?: string; branch?: string; commit?: string }> = {}
  ) {}

  isGitRepo(path: string): boolean {
    return this.repoMap[path]?.isRepo ?? true;
  }
  getRemoteUrl(path: string): string | null {
    return this.repoMap[path]?.remote ?? 'https://github.com/pubcoreagencia/pub-acp-standalone.git';
  }
  getCurrentBranch(path: string): string | null {
    return this.repoMap[path]?.branch ?? 'main';
  }
  getLastCommit(path: string): string | null {
    return this.repoMap[path]?.commit ?? '01a12e2 feat: ok';
  }
}

test('Generic Execution - 1. CWD detection and context construction', () => {
  const cwd = process.cwd();
  const gitInspector = new MockGitInspector({
    [cwd]: {
      isRepo: true,
      remote: 'https://github.com/pubcoreagencia/generic-test-repo.git',
      branch: 'feature/local',
      commit: 'abc1234 init'
    }
  });

  const resolver = new WorkspaceResolver(undefined, gitInspector);
  const res = resolver.resolveWorkspace(cwd);

  assert.equal(res.ok, true);
  assert.ok(res.context);
  assert.equal(res.context.workspacePath, cwd);
  assert.equal(res.context.projectId, 'pubcoreagencia-generic-test-repo');
  assert.equal(res.context.projectName, 'pubcoreagencia/generic-test-repo');
  assert.equal(res.context.repository, 'https://github.com/pubcoreagencia/generic-test-repo.git');
  assert.equal(res.context.branch, 'feature/local');
  assert.equal(res.context.commit, 'abc1234 init');
});

test('Generic Execution - 2. Git validation: accepts git repo, blocks non-git', () => {
  const cwd = process.cwd();
  const nonGitInspector = new MockGitInspector({
    [cwd]: { isRepo: false }
  });

  const resolver = new WorkspaceResolver(undefined, nonGitInspector);
  const res = resolver.resolveWorkspace(cwd);

  assert.equal(res.ok, false);
  assert.equal(res.reason, 'NOT_A_GIT_REPOSITORY');
});

test('Generic Execution - 3. SafetyGate: blocks insecure root filesystem', () => {
  const rootPath = 'C:\\';
  const gitInspector = new MockGitInspector({
    [rootPath]: {
      isRepo: true,
      remote: 'https://github.com/org/repo.git',
      branch: 'main'
    }
  });

  const resolver = new WorkspaceResolver(undefined, gitInspector);
  const res = resolver.resolveWorkspace(rootPath);

  // Even if resolver built context, SafetyGate must block root path
  const safetyGate = new SafetyGate();
  const safetyResult = safetyGate.evaluate(res);

  assert.equal(safetyResult.passed, false);
  assert.equal(safetyResult.reason, 'SECURITY_RULE_VIOLATION');
  assert.match(safetyResult.message || '', /root filesystem is blocked/);
});

test('Generic Execution - 4. ClosedLoopEngine propagates validated workspace to runtime', async () => {
  const cwd = process.cwd();
  const gitInspector = new MockGitInspector({ [cwd]: { isRepo: true, remote: 'https://github.com/pubcoreagencia/test-project.git', branch: 'main' } });
  const resolver = new WorkspaceResolver(undefined, gitInspector);
  const safety = new SafetyGate().evaluate(resolver.resolveWorkspace(cwd));
  assert.equal(safety.passed, true);
  const context = safety.context!;
  let runtimeReceivedCwd: string | undefined;
  const runtime: any = {
    id: 'test-runtime',
    provider: 'test',
    version: '1',
    capabilities: { supported: ['filesystem.read', 'filesystem.write', 'shell.execute'], supportsStreaming: false, requiresHumanApproval: false, isHeadless: true },
    checkHealth: async () => ({ healthy: true, availableCapacity: 1 }),
    execute: async (plan: any) => {
      runtimeReceivedCwd = plan.request.workspacePath;
      return { runId: 'runtime-run-1', status: 'COMPLETED', output: 'done', metrics: { durationMs: 1 } };
    }
  };
  const engine = new ClosedLoopEngine(undefined, runtime, { cwd: context.workspacePath, executionContext: context });
  const report = await engine.runLoop('Minha task de teste', { maxTurns: 1, executionContext: context });
  assert.equal(report.status, 'COMPLETED');
  assert.equal(runtimeReceivedCwd, cwd, 'generic runtime must receive ExecutionContext.workspacePath');
});
