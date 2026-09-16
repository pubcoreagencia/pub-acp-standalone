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

test('Generic Execution - 4. ClosedLoopEngine receives ExecutionContext and propagates validated CWD to AG', async () => {
  const cwd = process.cwd();
  const gitInspector = new MockGitInspector({
    [cwd]: {
      isRepo: true,
      remote: 'https://github.com/pubcoreagencia/test-project.git',
      branch: 'main'
    }
  });

  const resolver = new WorkspaceResolver(undefined, gitInspector);
  const resolution = resolver.resolveWorkspace(cwd);
  const safetyGate = new SafetyGate();
  const safety = safetyGate.evaluate(resolution);
  assert.equal(safety.passed, true);
  const context = safety.context!;

  let agReceivedCwd: string | undefined;

  const mockGpt: IGptTransport = {
    createSession: () => 'gpt-session-1',
    health: async () => ({ status: 'ok', initialized: true, isProcessing: false }),
    sendPrompt: async (): Promise<GptPromptResponse> => ({
      request_id: 'r1',
      session_id: 's1',
      status: 'COMPLETED',
      text: 'echo "hello from gpt" [[STATUS: READY]]',
      duration_ms: 10
    }),
    continueSession: async (): Promise<GptPromptResponse> => ({
      request_id: 'r2',
      session_id: 's1',
      status: 'COMPLETED',
      text: 'echo "hello from gpt" [[STATUS: READY]]',
      duration_ms: 10
    }),
    recover: async () => true
  };

  const mockAg: IAntigravityTransport = {
    health: async () => ({ status: 'ok' }),
    sendPrompt: async (_prompt: string, options?: AntigravityPromptOptions): Promise<AntigravityExecutionResult> => {
      agReceivedCwd = options?.cwd;
      return {
        request_id: options?.request_id || 'ag-1',
        session_id: options?.session_id || 'ag-s1',
        conversation_id: 'ag-conv-1',
        status: 'COMPLETED',
        response: 'done',
        duration_ms: 15
      };
    }
  };

  const engine = new ClosedLoopEngine(mockGpt, mockAg, {
    cwd: context.workspacePath,
    executionContext: context
  });

  const report = await engine.runLoop('Minha task de teste', {
    maxTurns: 1,
    executionContext: context
  });

  assert.equal(report.status, 'COMPLETED');
  assert.equal(agReceivedCwd, cwd, 'AntigravityTransport must receive ExecutionContext.workspacePath as cwd');
});
