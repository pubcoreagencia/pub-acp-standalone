import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MacOSSandboxAdapter } from '../../src/actions/sandbox/PlatformSandboxAdapters.js';
import { ActionExecutor } from '../../src/actions/ActionExecutor.js';

const isDarwin = process.platform === 'darwin';

test('MacOSSandboxAdapter - [FAIL-CLOSED] Blocks execution with SANDBOX_UNAVAILABLE when helper binary does not exist', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-mac-failclose-'));
  try {
    const adapter = new MacOSSandboxAdapter({
      launcherPath: '/nonexistent/path/to/mac_sandbox_launcher'
    });

    const ctx = adapter.prepare(tmpRoot, ['workspace.read', 'workspace.write', 'process.exec']);
    const res = adapter.execute(ctx, '/bin/echo', ['hello']);

    assert.equal(res.success, false);
    assert.equal(res.exitCode, 126);
    assert.equal(res.blockedReason, 'SANDBOX_UNAVAILABLE');
    assert.equal(res.isSandboxed, false);
    assert.match(res.stderr, /SANDBOX_UNAVAILABLE|not found|unavailable/i);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('MacOSSandboxAdapter - [PASS] Allows write within canonical workspace', { skip: !isDarwin }, () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-mac-ws-allow-'));
  const launcherPath = path.resolve(process.cwd(), 'bin', 'mac_sandbox_launcher');

  try {
    const adapter = new MacOSSandboxAdapter({ launcherPath });
    const ctx = adapter.prepare(tmpRoot, ['workspace.read', 'workspace.write', 'process.exec']);

    const targetFile = path.join(tmpRoot, 'allowed.txt');
    const res = adapter.execute(ctx, '/bin/sh', ['-c', `echo "inside workspace" > "${targetFile}"`]);

    assert.equal(res.success, true);
    assert.equal(res.exitCode, 0);
    assert.equal(res.isSandboxed, true);
    assert.equal(fs.existsSync(targetFile), true);
    assert.equal(fs.readFileSync(targetFile, 'utf8').trim(), 'inside workspace');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('MacOSSandboxAdapter - [PASS] Denies file write outside workspace', { skip: !isDarwin }, () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-mac-deny-write-'));
  const wsDir = path.join(tmpRoot, 'workspace');
  const outsideDir = path.join(tmpRoot, 'outside');
  fs.mkdirSync(wsDir);
  fs.mkdirSync(outsideDir);

  const launcherPath = path.resolve(process.cwd(), 'bin', 'mac_sandbox_launcher');

  try {
    const adapter = new MacOSSandboxAdapter({ launcherPath });
    const ctx = adapter.prepare(wsDir, ['workspace.read', 'workspace.write', 'process.exec']);

    const outsideTarget = path.join(outsideDir, 'forbidden.txt');
    const res = adapter.execute(ctx, '/bin/sh', ['-c', `echo "forbidden" > "${outsideTarget}"`]);

    assert.equal(res.success, false);
    assert.equal(res.isSandboxed, true);
    assert.equal(res.blockedReason, 'MACOS_SANDBOX_FS_DENIED');
    assert.match(res.stderr, /Operation not permitted/);
    assert.equal(fs.existsSync(outsideTarget), false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('MacOSSandboxAdapter - [PASS] Denies file read on sensitive external paths', { skip: !isDarwin }, () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-mac-deny-read-'));
  const wsDir = path.join(tmpRoot, 'workspace');
  const outsideDir = path.join(tmpRoot, 'outside');
  fs.mkdirSync(wsDir);
  fs.mkdirSync(outsideDir);

  const sensitiveFile = path.join(outsideDir, 'secret.env');
  fs.writeFileSync(sensitiveFile, 'TOP_SECRET_VALUE');

  const launcherPath = path.resolve(process.cwd(), 'bin', 'mac_sandbox_launcher');

  try {
    const adapter = new MacOSSandboxAdapter({
      launcherPath,
      profileOptions: {
        sensitiveDenyReadPaths: [outsideDir]
      }
    });
    const ctx = adapter.prepare(wsDir, ['workspace.read', 'process.exec']);

    const res = adapter.execute(ctx, '/bin/cat', [sensitiveFile]);

    assert.equal(res.success, false);
    assert.equal(res.isSandboxed, true);
    assert.match(res.stderr, /Operation not permitted/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('MacOSSandboxAdapter - [PASS] Child processes spawned by external process inherit containment', { skip: !isDarwin }, () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-mac-child-'));
  const wsDir = path.join(tmpRoot, 'workspace');
  const outsideDir = path.join(tmpRoot, 'outside');
  fs.mkdirSync(wsDir);
  fs.mkdirSync(outsideDir);

  const launcherPath = path.resolve(process.cwd(), 'bin', 'mac_sandbox_launcher');

  try {
    const adapter = new MacOSSandboxAdapter({ launcherPath });
    const ctx = adapter.prepare(wsDir, ['workspace.read', 'workspace.write', 'process.exec', 'process.child_process']);

    // Process spawns child shell that tries to write outside
    const outsideTarget = path.join(outsideDir, 'child_forbidden.txt');
    const res = adapter.execute(ctx, '/bin/sh', ['-c', `/bin/sh -c "echo child > '${outsideTarget}'"`]);

    assert.equal(res.success, false);
    assert.equal(res.isSandboxed, true);
    assert.equal(res.blockedReason, 'MACOS_SANDBOX_FS_DENIED');
    assert.match(res.stderr, /Operation not permitted/);
    assert.equal(fs.existsSync(outsideTarget), false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('MacOSSandboxAdapter - [PASS] Network outbound blocked when capability absent', { skip: !isDarwin }, () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-mac-net-block-'));
  const launcherPath = path.resolve(process.cwd(), 'bin', 'mac_sandbox_launcher');

  try {
    const adapter = new MacOSSandboxAdapter({ launcherPath });
    // NO 'network.outbound' capability
    const ctx = adapter.prepare(tmpRoot, ['workspace.read', 'process.exec']);

    const res = adapter.execute(ctx, '/usr/bin/curl', ['-s', '-m', '2', 'http://127.0.0.1:9999']);

    assert.equal(res.success, false);
    assert.equal(res.isSandboxed, true);
    // Curl exit code 7 = Failed to connect
    assert.equal(res.exitCode, 7);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('MacOSSandboxAdapter - End-to-end ActionExecutor integration', { skip: !isDarwin }, () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-mac-executor-'));
  const launcherPath = path.resolve(process.cwd(), 'bin', 'mac_sandbox_launcher');

  try {
    const macAdapter = new MacOSSandboxAdapter({ launcherPath });
    const executor = new ActionExecutor({
      policy: {
        capabilities: {
          'workspace.read': true,
          'workspace.write': true,
          'process.exec': true
        },
        allowedExecutables: ['echo'],
        disallowShellOperators: true,
        disallowExternalPathArgs: true
      },
      sandboxAdapter: macAdapter
    });

    const res = executor.executeAction(tmpRoot, {
      type: 'EXEC',
      command: 'echo "mac-sandbox-e2e"'
    });

    assert.equal(res.status, 'SUCCESS');
    assert.equal(res.metadata?.isSandboxed, true);
    assert.equal(res.metadata?.provider, 'macos-sandbox');
    assert.match(res.output || '', /mac-sandbox-e2e/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
