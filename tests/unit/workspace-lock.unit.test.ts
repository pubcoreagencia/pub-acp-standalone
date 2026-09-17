import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryWorkspaceLock, normalizeWorkspacePath } from '../../src/multiproject/WorkspaceLock.js';

test('WorkspaceLock - Normalization handles case and path separators consistently', () => {
  const p1 = 'C:\\MyProjects\\RepoA';
  const p2 = 'c:/MyProjects/RepoA/';
  const p3 = 'c:\\myprojects\\repoa';

  assert.equal(normalizeWorkspacePath(p1), normalizeWorkspacePath(p2));
  assert.equal(normalizeWorkspacePath(p2), normalizeWorkspacePath(p3));
});

test('WorkspaceLock - Test 1: Workspace livre: acquire(A, run1) -> success', () => {
  const lock = new MemoryWorkspaceLock();
  const res = lock.acquire('C:/test/workspace-a', 'run-1', { projectId: 'project-a' });

  assert.equal(res.acquired, true);
  if (res.acquired) {
    assert.equal(res.record.runId, 'run-1');
    assert.equal(res.record.metadata?.projectId, 'project-a');
  }
  assert.equal(lock.isLocked('C:/test/workspace-a'), true);
});

test('WorkspaceLock - Test 2: Segundo run no mesmo workspace: acquire(A, run1), acquire(A, run2) -> run2 blocked', () => {
  const lock = new MemoryWorkspaceLock();
  const res1 = lock.acquire('C:/test/workspace-a', 'run-1');
  assert.equal(res1.acquired, true);

  const res2 = lock.acquire('C:/test/workspace-a', 'run-2');
  assert.equal(res2.acquired, false);
  if (!res2.acquired) {
    assert.equal(res2.existingLock.runId, 'run-1');
    assert.ok(res2.message.includes('currently locked by run \'run-1\''));
  }
});

test('WorkspaceLock - Test 3: Workspaces diferentes: acquire(A, run1), acquire(B, run2) -> ambos success', () => {
  const lock = new MemoryWorkspaceLock();
  const res1 = lock.acquire('C:/test/workspace-a', 'run-1');
  const res2 = lock.acquire('C:/test/workspace-b', 'run-2');

  assert.equal(res1.acquired, true);
  assert.equal(res2.acquired, true);
  assert.equal(lock.isLocked('C:/test/workspace-a'), true);
  assert.equal(lock.isLocked('C:/test/workspace-b'), true);
});

test('WorkspaceLock - Test 4: Release correto: acquire(A, run1), release(A, run1), acquire(A, run2) -> success', () => {
  const lock = new MemoryWorkspaceLock();
  const res1 = lock.acquire('C:/test/workspace-a', 'run-1');
  assert.equal(res1.acquired, true);

  const released = lock.release('C:/test/workspace-a', 'run-1');
  assert.equal(released, true);
  assert.equal(lock.isLocked('C:/test/workspace-a'), false);

  const res2 = lock.acquire('C:/test/workspace-a', 'run-2');
  assert.equal(res2.acquired, true);
  if (res2.acquired) {
    assert.equal(res2.record.runId, 'run-2');
  }
});

test('WorkspaceLock - Test 5: Release por owner errado: acquire(A, run1), release(A, run2) -> lock continua pertencendo a run1', () => {
  const lock = new MemoryWorkspaceLock();
  const res1 = lock.acquire('C:/test/workspace-a', 'run-1');
  assert.equal(res1.acquired, true);

  const releasedWrongOwner = lock.release('C:/test/workspace-a', 'run-2');
  assert.equal(releasedWrongOwner, false);

  // Lock still held by run-1
  assert.equal(lock.isLocked('C:/test/workspace-a'), true);
  const currentLock = lock.getLock('C:/test/workspace-a');
  assert.equal(currentLock?.runId, 'run-1');

  // Attempt from run-3 is still blocked
  const res3 = lock.acquire('C:/test/workspace-a', 'run-3');
  assert.equal(res3.acquired, false);
});

test('WorkspaceLock - Test 6: Reentrancy (same runId + same workspace is idempotent)', () => {
  const lock = new MemoryWorkspaceLock();
  const res1 = lock.acquire('C:/test/workspace-a', 'run-1');
  assert.equal(res1.acquired, true);

  const resReentrant = lock.acquire('C:/test/workspace-a', 'run-1');
  assert.equal(resReentrant.acquired, true);
  if (resReentrant.acquired) {
    assert.equal(resReentrant.record.runId, 'run-1');
  }
});

test('WorkspaceLock - Test 7: Concorrência atômica síncrona dentro do processo: exactly 1 acquired, exactly 1 blocked', () => {
  const lock = new MemoryWorkspaceLock();
  const runs = ['run-alpha', 'run-beta'];

  const results = runs.map(r => lock.acquire('C:/test/workspace-concurrent', r));
  const acquired = results.filter(r => r.acquired);
  const blocked = results.filter(r => !r.acquired);

  assert.equal(acquired.length, 1);
  assert.equal(blocked.length, 1);
  assert.equal(acquired[0].acquired, true);
  assert.equal(blocked[0].acquired, false);
});
