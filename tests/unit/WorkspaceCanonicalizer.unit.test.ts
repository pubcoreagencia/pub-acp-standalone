import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkspaceCanonicalizer,
  WorkspaceCanonicalizationError,
} from '../../src/discovery/index.js';

test('WorkspaceCanonicalizer - resolves existing directory successfully', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pub-canon-test-'));
  try {
    const canonicalizer = new WorkspaceCanonicalizer();
    const result = await canonicalizer.canonicalize(tmp);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.canonicalPath.length > 0);
      if (process.platform === 'win32') {
        assert.strictEqual(result.canonicalPath, result.canonicalPath.toLowerCase());
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('WorkspaceCanonicalizer - returns PathNotFound for nonexistent directory', async () => {
  const canonicalizer = new WorkspaceCanonicalizer();
  const nonExistentPath = join(tmpdir(), 'definitely-does-not-exist-' + Date.now());
  const result = await canonicalizer.canonicalize(nonExistentPath);
  assert.strictEqual(result.success, false);
  if (!result.success) {
    assert.strictEqual(result.error, WorkspaceCanonicalizationError.PathNotFound);
  }
});

test('WorkspaceCanonicalizer - handles relative path and resolves to absolute', async () => {
  const canonicalizer = new WorkspaceCanonicalizer();
  const result = await canonicalizer.canonicalize('.');
  assert.strictEqual(result.success, true);
  if (result.success) {
    assert.ok(result.canonicalPath.length > 0);
  }
});

test('WorkspaceCanonicalizer - error mapping covers all enum types', () => {
  assert.strictEqual(WorkspaceCanonicalizationError.PathNotFound, 'PathNotFound');
  assert.strictEqual(WorkspaceCanonicalizationError.PermissionDenied, 'PermissionDenied');
  assert.strictEqual(WorkspaceCanonicalizationError.InvalidPath, 'InvalidPath');
  assert.strictEqual(WorkspaceCanonicalizationError.SymlinkLoop, 'SymlinkLoop');
  assert.strictEqual(WorkspaceCanonicalizationError.RealpathFailed, 'RealpathFailed');
});
