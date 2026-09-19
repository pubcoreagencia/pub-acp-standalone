import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FilesystemDiscoveryProvider,
  DiscoveryProviderStatus,
  DiscoveryScope,
} from '../../src/discovery/index.js';

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `pub-fs-test-${prefix}-`));
}

test('FilesystemDiscoveryProvider - 1. Empty roots returns UNAVAILABLE without scanning disk', async () => {
  const provider = new FilesystemDiscoveryProvider();
  const controller = new AbortController();
  const res = await provider.discover({ roots: [] }, controller.signal);

  assert.strictEqual(res.status, DiscoveryProviderStatus.UNAVAILABLE);
  assert.strictEqual(res.candidates.length, 0);
  assert.strictEqual(res.source, 'filesystem');
  assert.strictEqual(res.providerName, 'FilesystemDiscoveryProvider');
  assert.ok(res.diagnostics?.some((d) => d.includes('Full-disk scanning is prohibited')));
});

test('FilesystemDiscoveryProvider - 2. Inaccessible or non-existent root reports failure or diagnostic', async () => {
  const provider = new FilesystemDiscoveryProvider();
  const controller = new AbortController();
  const nonExistent = join(tmpdir(), 'non-existent-fs-root-' + Date.now());
  const res = await provider.discover({ roots: [nonExistent] }, controller.signal);

  assert.strictEqual(res.status, DiscoveryProviderStatus.FAILURE);
  assert.strictEqual(res.candidates.length, 0);
  assert.ok(res.diagnostics?.some((d) => d.includes('Root inaccessible')));
});

test('FilesystemDiscoveryProvider - 3. Directory without projects returns EMPTY status', async () => {
  const dir = createTempDir('empty');
  try {
    mkdirSync(join(dir, 'plain-folder', 'sub'), { recursive: true });
    writeFileSync(join(dir, 'plain-folder', 'hello.txt'), 'content');

    const provider = new FilesystemDiscoveryProvider();
    const controller = new AbortController();
    const res = await provider.discover({ roots: [dir] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.EMPTY);
    assert.strictEqual(res.candidates.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FilesystemDiscoveryProvider - 4. Discovers standard Git repo (directory .git) and worktree (.git file)', async () => {
  const dir = createTempDir('git-repos');
  try {
    // 1. Regular git repository
    const standardRepo = join(dir, 'repo-standard');
    mkdirSync(join(standardRepo, '.git'), { recursive: true });

    // 2. Worktree (.git is a file)
    const worktreeRepo = join(dir, 'repo-worktree');
    mkdirSync(worktreeRepo, { recursive: true });
    writeFileSync(join(worktreeRepo, '.git'), 'gitdir: /some/path/.git/worktrees/repo-worktree');

    // 3. Plain directory (not a repo)
    const plainDir = join(dir, 'plain-dir');
    mkdirSync(plainDir, { recursive: true });

    const provider = new FilesystemDiscoveryProvider();
    const controller = new AbortController();
    const res = await provider.discover({ roots: [dir] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.SUCCESS);
    assert.strictEqual(res.candidates.length, 2);

    const paths = res.candidates.map((c) => c.originalWorkspacePath);
    assert.ok(paths.includes(standardRepo));
    assert.ok(paths.includes(worktreeRepo));

    // Valid candidate invariants
    for (const cand of res.candidates) {
      assert.strictEqual(cand.discoverySource, 'filesystem');
      assert.strictEqual(cand.providerName, 'FilesystemDiscoveryProvider');
      assert.strictEqual(cand.projectId, undefined, 'projectId must not be invented by filesystem provider');
      assert.strictEqual(cand.repositoryIdentity, undefined, 'repositoryIdentity must not be invented by filesystem provider');
      assert.ok(cand.discoveredAt);
      assert.strictEqual((cand as any).isAuthorized, undefined, 'No authorization flags allowed');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FilesystemDiscoveryProvider - 5. Multiple roots scanned and aggregated correctly', async () => {
  const dir1 = createTempDir('root1');
  const dir2 = createTempDir('root2');
  try {
    const repo1 = join(dir1, 'proj-1');
    mkdirSync(join(repo1, '.git'), { recursive: true });

    const repo2 = join(dir2, 'proj-2');
    mkdirSync(join(repo2, '.git'), { recursive: true });

    const provider = new FilesystemDiscoveryProvider();
    const controller = new AbortController();
    const res = await provider.discover({ roots: [dir1, dir2] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.SUCCESS);
    assert.strictEqual(res.candidates.length, 2);
  } finally {
    rmSync(dir1, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  }
});

test('FilesystemDiscoveryProvider - 6. Bounds: respects maxDepth and does not traverse deeper', async () => {
  const dir = createTempDir('depth');
  try {
    // repo at depth 1
    const repoDepth1 = join(dir, 'level1', 'repo-d1');
    mkdirSync(join(repoDepth1, '.git'), { recursive: true });

    // repo at depth 3
    const repoDepth3 = join(dir, 'level1', 'level2', 'level3', 'repo-d3');
    mkdirSync(join(repoDepth3, '.git'), { recursive: true });

    const provider = new FilesystemDiscoveryProvider();
    const controller = new AbortController();
    // maxDepth = 2 -> repo at level3 must NOT be reached
    const res = await provider.discover({ roots: [dir], maxDepth: 2 }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.SUCCESS);
    assert.strictEqual(res.candidates.length, 1);
    assert.strictEqual(res.candidates[0].originalWorkspacePath, repoDepth1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FilesystemDiscoveryProvider - 7. Bounds: respects maxCandidates and stops promptly', async () => {
  const dir = createTempDir('limit');
  try {
    for (let i = 1; i <= 5; i++) {
      mkdirSync(join(dir, `repo-${i}`, '.git'), { recursive: true });
    }

    const provider = new FilesystemDiscoveryProvider();
    const controller = new AbortController();
    const res = await provider.discover({ roots: [dir], maxCandidates: 2 }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.SUCCESS);
    assert.strictEqual(res.candidates.length, 2);
    assert.ok(res.diagnostics?.some((d) => d.includes('Candidate limit reached')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FilesystemDiscoveryProvider - 8. Cancellation: already aborted signal returns TIMEOUT immediately', async () => {
  const dir = createTempDir('aborted-init');
  try {
    mkdirSync(join(dir, 'repo-1', '.git'), { recursive: true });

    const provider = new FilesystemDiscoveryProvider();
    const controller = new AbortController();
    controller.abort(); // Abort immediately

    const res = await provider.discover({ roots: [dir] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.TIMEOUT);
    assert.strictEqual(res.candidates.length, 0);
    assert.ok(res.diagnostics?.some((d) => d.includes('aborted before traversal')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FilesystemDiscoveryProvider - 9. Symlink safety: does not follow symlinks/junctions', async () => {
  const dir = createTempDir('symlink-safe');
  try {
    const realRepo = join(dir, 'real-repo');
    mkdirSync(join(realRepo, '.git'), { recursive: true });

    // Try creating a directory symlink if OS permissions allow
    const symlinkTarget = join(dir, 'symlinked-folder');
    let symlinkCreated = false;
    try {
      symlinkSync(realRepo, symlinkTarget, 'junction');
      symlinkCreated = true;
    } catch {
      // Junction/symlink might require admin privileges on some Windows setups
    }

    const provider = new FilesystemDiscoveryProvider();
    const controller = new AbortController();
    const res = await provider.discover({ roots: [dir] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.SUCCESS);
    // Even if symlink created, only the real directory is discovered, symlink is skipped
    assert.strictEqual(res.candidates.length, 1);
    assert.strictEqual(res.candidates[0].originalWorkspacePath, realRepo);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FilesystemDiscoveryProvider - 10. Root path itself as workspace is detected without descending into .git internals', async () => {
  const dir = createTempDir('root-as-repo');
  try {
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
    mkdirSync(join(dir, 'nested', '.git'), { recursive: true });

    const provider = new FilesystemDiscoveryProvider();
    const controller = new AbortController();
    const res = await provider.discover({ roots: [dir] }, controller.signal);

    assert.strictEqual(res.status, DiscoveryProviderStatus.SUCCESS);
    // Detected dir itself, did not traverse inside dir to discover internal nested items
    assert.strictEqual(res.candidates.length, 1);
    assert.strictEqual(res.candidates[0].originalWorkspacePath, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
