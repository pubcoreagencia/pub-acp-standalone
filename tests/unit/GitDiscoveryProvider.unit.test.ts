import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GitDiscoveryProvider,
  GitCommandRunner,
  DiscoveryProviderStatus,
} from '../../src/discovery/index.js';

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `pub-git-test-${prefix}-`));
}

// Mock Git Command Runner for test isolation
class MockGitRunner implements GitCommandRunner {
  private responses: Map<string, { stdout: string; stderr: string } | Error> = new Map();
  public executedCommands: Array<{ args: string[]; cwd: string }> = [];

  setResponse(cmdKey: string, res: { stdout: string; stderr: string } | Error) {
    this.responses.set(cmdKey, res);
  }

  async run(
    args: string[],
    cwd: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<{ stdout: string; stderr: string }> {
    if (signal?.aborted) {
      const err = new Error('This operation was aborted');
      err.name = 'AbortError';
      throw err;
    }

    this.executedCommands.push({ args, cwd });
    const key = `${cwd}::${args.join(' ')}`;

    if (this.responses.has(key)) {
      const val = this.responses.get(key)!;
      if (val instanceof Error) {
        throw val;
      }
      return val;
    }

    // Default responses based on git subcommands
    const subCmd = args[0];
    if (subCmd === 'rev-parse' && args[1] === '--show-toplevel') {
      return { stdout: cwd, stderr: '' };
    }
    if (subCmd === 'branch' && args[1] === '--show-current') {
      return { stdout: 'main', stderr: '' };
    }
    if (subCmd === 'rev-parse' && args[1] === 'HEAD') {
      return { stdout: 'abcdef1234567890', stderr: '' };
    }
    if (subCmd === 'remote') {
      return { stdout: 'origin', stderr: '' };
    }
    if (subCmd === 'config' && args[1] === '--get' && args[2] === 'remote.origin.url') {
      return { stdout: 'https://github.com/my-org/my-project.git', stderr: '' };
    }

    return { stdout: '', stderr: '' };
  }
}

test('GitDiscoveryProvider - 1. Empty roots returns UNAVAILABLE without running git', async () => {
  const runner = new MockGitRunner();
  const provider = new GitDiscoveryProvider(runner);
  const controller = new AbortController();

  const res = await provider.discover({ roots: [] }, controller.signal);

  assert.strictEqual(res.status, DiscoveryProviderStatus.UNAVAILABLE);
  assert.strictEqual(res.candidates.length, 0);
  assert.strictEqual(runner.executedCommands.length, 0);
  assert.strictEqual(res.source, 'git');
  assert.strictEqual(res.providerName, 'GitDiscoveryProvider');
});

test('GitDiscoveryProvider - 2. Root without Git returns EMPTY and executes no commands', async () => {
  const dir = createTempDir('no-git');
  try {
    mkdirSync(join(dir, 'plain-folder'), { recursive: true });
    const runner = new MockGitRunner();
    const provider = new GitDiscoveryProvider(runner);
    const controller = new AbortController();

    const res = await provider.discover({ roots: [dir] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.EMPTY);
    assert.strictEqual(res.candidates.length, 0);
    assert.strictEqual(runner.executedCommands.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GitDiscoveryProvider - 3. Discovers valid Git repo with origin remote, branch, commit, and derived projectId', async () => {
  const dir = createTempDir('valid-repo');
  try {
    const repoPath = join(dir, 'app-repo');
    mkdirSync(join(repoPath, '.git'), { recursive: true });

    const runner = new MockGitRunner();
    const provider = new GitDiscoveryProvider(runner);
    const controller = new AbortController();

    const res = await provider.discover({ roots: [dir] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.SUCCESS);
    assert.strictEqual(res.candidates.length, 1);

    const cand = res.candidates[0];
    assert.strictEqual(cand.discoverySource, 'git');
    assert.strictEqual(cand.providerName, 'GitDiscoveryProvider');
    assert.strictEqual(cand.originalWorkspacePath, repoPath);
    assert.strictEqual(cand.currentBranch, 'main');
    assert.strictEqual(cand.headCommitSha, 'abcdef1234567890');
    assert.deepStrictEqual(cand.remotes, ['https://github.com/my-org/my-project.git']);
    assert.deepStrictEqual(cand.repositoryIdentity, {
      remoteUrl: 'https://github.com/my-org/my-project.git',
    });
    // projectId derived from remote origin following catalog convention
    assert.strictEqual(cand.projectId, 'my-org-my-project');
    assert.strictEqual((cand as any).isAuthorized, undefined, 'No authorization flags allowed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GitDiscoveryProvider - 4. Handles multiple remotes (origin and upstream)', async () => {
  const dir = createTempDir('multi-remotes');
  try {
    const repoPath = join(dir, 'repo');
    mkdirSync(join(repoPath, '.git'), { recursive: true });

    const runner = new MockGitRunner();
    runner.setResponse(`${repoPath}::remote`, { stdout: 'origin\nupstream\n', stderr: '' });
    runner.setResponse(
      `${repoPath}::config --get remote.origin.url`,
      { stdout: 'https://github.com/fork/project.git', stderr: '' }
    );
    runner.setResponse(
      `${repoPath}::config --get remote.upstream.url`,
      { stdout: 'https://github.com/upstream/project.git', stderr: '' }
    );

    const provider = new GitDiscoveryProvider(runner);
    const controller = new AbortController();
    const res = await provider.discover({ roots: [dir] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.SUCCESS);
    assert.strictEqual(res.candidates.length, 1);

    const cand = res.candidates[0];
    assert.strictEqual(cand.remotes?.length, 2);
    assert.ok(cand.remotes?.includes('https://github.com/fork/project.git'));
    assert.ok(cand.remotes?.includes('https://github.com/upstream/project.git'));
    assert.strictEqual(cand.projectId, 'fork-project');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GitDiscoveryProvider - 5. Handles detached HEAD gracefully', async () => {
  const dir = createTempDir('detached-head');
  try {
    const repoPath = join(dir, 'repo');
    mkdirSync(join(repoPath, '.git'), { recursive: true });

    const runner = new MockGitRunner();
    runner.setResponse(`${repoPath}::branch --show-current`, { stdout: '', stderr: '' }); // git branch --show-current is empty on detached HEAD

    const provider = new GitDiscoveryProvider(runner);
    const controller = new AbortController();
    const res = await provider.discover({ roots: [dir] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.SUCCESS);
    assert.strictEqual(res.candidates[0].currentBranch, 'HEAD (detached)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GitDiscoveryProvider - 6. Distinguishes .git file (worktree) from standard directory', async () => {
  const dir = createTempDir('worktree');
  try {
    const repoPath = join(dir, 'repo-wt');
    mkdirSync(repoPath, { recursive: true });
    writeFileSync(join(repoPath, '.git'), 'gitdir: /some/path/.git/worktrees/repo-wt');

    const runner = new MockGitRunner();
    const provider = new GitDiscoveryProvider(runner);
    const controller = new AbortController();
    const res = await provider.discover({ roots: [dir] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.SUCCESS);
    assert.strictEqual(res.candidates[0].worktreeInfo?.isWorktree, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GitDiscoveryProvider - 7. Preserves separate workspace identities for different checkouts sharing identical remote', async () => {
  const dir = createTempDir('two-worktrees');
  try {
    const wt1 = join(dir, 'main-wt');
    const wt2 = join(dir, 'feat-wt');
    mkdirSync(join(wt1, '.git'), { recursive: true });
    mkdirSync(join(wt2, '.git'), { recursive: true });

    const runner = new MockGitRunner();
    // Both point to the exact same remote repository URL
    const remoteUrl = 'https://github.com/org/shared-repo.git';
    runner.setResponse(`${wt1}::config --get remote.origin.url`, { stdout: remoteUrl, stderr: '' });
    runner.setResponse(`${wt2}::config --get remote.origin.url`, { stdout: remoteUrl, stderr: '' });

    const provider = new GitDiscoveryProvider(runner);
    const controller = new AbortController();
    const res = await provider.discover({ roots: [dir] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.SUCCESS);
    assert.strictEqual(res.candidates.length, 2, 'Workspaces must not be collapsed');

    assert.strictEqual(res.candidates[0].originalWorkspacePath, wt2 < wt1 ? wt2 : wt1);
    assert.strictEqual(res.candidates[1].originalWorkspacePath, wt2 < wt1 ? wt1 : wt2);

    // Both share the repositoryIdentity
    assert.strictEqual(res.candidates[0].repositoryIdentity?.remoteUrl, remoteUrl);
    assert.strictEqual(res.candidates[1].repositoryIdentity?.remoteUrl, remoteUrl);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GitDiscoveryProvider - 8. Does not invent projectId when no remote origin configured', async () => {
  const dir = createTempDir('local-only');
  try {
    const repoPath = join(dir, 'local-repo');
    mkdirSync(join(repoPath, '.git'), { recursive: true });

    const runner = new MockGitRunner();
    runner.setResponse(`${repoPath}::remote`, { stdout: '', stderr: '' });

    const provider = new GitDiscoveryProvider(runner);
    const controller = new AbortController();
    const res = await provider.discover({ roots: [dir] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.SUCCESS);
    assert.strictEqual(res.candidates[0].projectId, undefined, 'projectId must be undefined when no origin remote');
    assert.strictEqual(res.candidates[0].repositoryIdentity, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GitDiscoveryProvider - 9. Handles Git command failure gracefully (fail-soft per repo)', async () => {
  const dir = createTempDir('cmd-fail');
  try {
    const repoPath = join(dir, 'broken-repo');
    mkdirSync(join(repoPath, '.git'), { recursive: true });

    const runner = new MockGitRunner();
    runner.setResponse(
      `${repoPath}::rev-parse --show-toplevel`,
      new Error('fatal: not a git repository')
    );

    const provider = new GitDiscoveryProvider(runner);
    const controller = new AbortController();
    const res = await provider.discover({ roots: [dir] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.EMPTY);
    assert.strictEqual(res.candidates.length, 0);
    assert.ok(res.diagnostics?.some((d) => d.includes('fatal: not a git repository')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GitDiscoveryProvider - 10. Cancellation and AbortSignal halts execution cleanly', async () => {
  const dir = createTempDir('aborted');
  try {
    const repoPath = join(dir, 'repo');
    mkdirSync(join(repoPath, '.git'), { recursive: true });

    const runner = new MockGitRunner();
    const provider = new GitDiscoveryProvider(runner);
    const controller = new AbortController();
    controller.abort(); // Aborted upfront

    const res = await provider.discover({ roots: [dir] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.TIMEOUT);
    assert.strictEqual(res.candidates.length, 0);
    assert.strictEqual(runner.executedCommands.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GitDiscoveryProvider - 11. Security: only read-only subcommands executed, no mutating commands', async () => {
  const dir = createTempDir('security');
  try {
    const repoPath = join(dir, 'repo');
    mkdirSync(join(repoPath, '.git'), { recursive: true });

    const runner = new MockGitRunner();
    const provider = new GitDiscoveryProvider(runner);
    const controller = new AbortController();

    await provider.discover({ roots: [dir] }, controller.signal);

    const mutatingCommands = [
      'clone', 'fetch', 'pull', 'push', 'checkout', 'reset', 'clean', 'merge', 'rebase', 'commit'
    ];

    for (const cmd of runner.executedCommands) {
      for (const mut of mutatingCommands) {
        assert.notStrictEqual(
          cmd.args[0],
          mut,
          `Mutating command '${mut}' must never be called by GitDiscoveryProvider`
        );
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
