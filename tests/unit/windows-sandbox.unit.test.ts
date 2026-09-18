import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WindowsSandboxAdapter } from '../../src/actions/sandbox/PlatformSandboxAdapters.js';
import { ActionExecutor } from '../../src/actions/ActionExecutor.js';

test('WindowsSandboxAdapter - [FAIL-CLOSED] Blocks execution with SANDBOX_UNAVAILABLE when host is not Windows', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-win-failclose-'));
  try {
    const adapter = new WindowsSandboxAdapter();
    const ctx = adapter.prepare(tmpRoot, ['workspace.read', 'workspace.write', 'process.exec']);

    const res = adapter.execute(ctx, 'cmd.exe', ['/c', 'echo hi']);

    if (process.platform !== 'win32') {
      assert.equal(res.success, false);
      assert.equal(res.exitCode, 126);
      assert.equal(res.blockedReason, 'SANDBOX_UNAVAILABLE');
      assert.equal(res.isSandboxed, false);
      assert.match(res.stderr, /platform is not Windows/i);
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('WindowsSandboxAdapter - [FAIL-CLOSED] Blocks execution with SANDBOX_UNAVAILABLE when launcher binary does not exist', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-win-missing-'));
  try {
    const adapter = new WindowsSandboxAdapter({
      launcherPath: 'C:\\nonexistent\\win_sandbox_launcher.exe'
    });
    const ctx = adapter.prepare(tmpRoot, ['workspace.read', 'workspace.write', 'process.exec']);

    const res = adapter.execute(ctx, 'cmd.exe', ['/c', 'echo hi']);

    assert.equal(res.success, false);
    assert.equal(res.exitCode, 126);
    assert.equal(res.blockedReason, 'SANDBOX_UNAVAILABLE');
    assert.equal(res.isSandboxed, false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('WindowsSandboxAdapter - [INTEGRATION] ActionExecutor with WindowsSandboxAdapter strictly fails closed', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-win-exec-'));
  try {
    const adapter = new WindowsSandboxAdapter();
    const executor = new ActionExecutor({
      policy: {
        capabilities: { 'process.exec': true },
        allowedExecutables: ['node']
      },
      sandboxAdapter: adapter
    });

    const res = executor.executeAction(tmpRoot, {
      type: 'EXEC',
      command: 'node -e "console.log(1)"'
    });

    if (process.platform !== 'win32') {
      assert.equal(res.status, 'BLOCKED');
      assert.equal(res.blockedReason, 'SANDBOX_UNAVAILABLE');
      assert.equal(res.metadata?.isSandboxed, false);
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
