import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ActionExecutor } from '../../src/actions/ActionExecutor.js';
import { NodeProcessSandbox } from '../../src/actions/sandbox/NodeProcessSandbox.js';
import { MacOSSandboxAdapter, WindowsSandboxAdapter, LinuxSandboxAdapter } from '../../src/actions/sandbox/PlatformSandboxAdapters.js';

test('NodeProcessSandbox - prepares correct context and restricts fs to workspace', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-sandbox-prep-'));
  const sandbox = new NodeProcessSandbox();
  const ctx = sandbox.prepare(tmpRoot, ['workspace.read', 'workspace.write', 'process.exec']);

  assert.equal(ctx.provider, 'node-permission');
  assert.equal(ctx.workspacePath, fs.realpathSync(tmpRoot));
  assert.equal(ctx.childProcessAllowed, false);
  assert.equal(ctx.networkAllowed, false);
  assert.equal(ctx.workerAllowed, false);
  assert.ok(ctx.fsReadPaths.includes(ctx.workspacePath));
  assert.ok(ctx.fsWritePaths.includes(ctx.workspacePath));

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('Process Sandbox - Node Permission Model: [PASS] filesystem outside workspace blocked', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-perm-fs-'));
  const wsDir = path.join(tmpRoot, 'workspace');
  const outsideDir = path.join(tmpRoot, 'outside');
  fs.mkdirSync(wsDir);
  fs.mkdirSync(outsideDir);

  const outsideSecret = path.join(outsideDir, 'secret.env');
  fs.writeFileSync(outsideSecret, 'SUPER_SECRET_KEY');

  const executor = new ActionExecutor({
    policy: {
      capabilities: {
        'workspace.read': true,
        'workspace.write': true,
        'process.exec': true
      },
      allowedExecutables: ['node'],
      disallowExternalPathArgs: false // Let the command reach the process to test process-level sandbox
    }
  });

  try {
    // Attempt to read outside file via node process
    const result = executor.executeAction(wsDir, {
      type: 'EXEC',
      command: `node -e "require('fs').readFileSync('${outsideSecret}', 'utf8')"`
    });

    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.blockedReason, 'NODE_PERMISSION_FS_DENIED');
    assert.match(result.error || '', /ERR_ACCESS_DENIED/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Process Sandbox - Node Permission Model: [PASS] /tmp and HOME blocked', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-perm-sys-'));
  const wsDir = path.join(tmpRoot, 'workspace');
  fs.mkdirSync(wsDir);

  const executor = new ActionExecutor({
    policy: {
      capabilities: {
        'workspace.read': true,
        'workspace.write': true,
        'process.exec': true
      },
      allowedExecutables: ['node'],
      disallowExternalPathArgs: false
    }
  });

  try {
    // 1. Write to /tmp blocked
    const tmpWriteResult = executor.executeAction(wsDir, {
      type: 'EXEC',
      command: `node -e "require('fs').writeFileSync('/tmp/evil_escape.txt', 'evil')"`
    });
    assert.equal(tmpWriteResult.status, 'BLOCKED');
    assert.equal(tmpWriteResult.blockedReason, 'NODE_PERMISSION_FS_DENIED');
    assert.match(tmpWriteResult.error || '', /ERR_ACCESS_DENIED/);

    // 2. Read HOME blocked
    const homeReadResult = executor.executeAction(wsDir, {
      type: 'EXEC',
      command: `node -e "require('fs').readFileSync(require('os').homedir() + '/.bashrc')"`
    });
    assert.equal(homeReadResult.status, 'BLOCKED');
    assert.equal(homeReadResult.blockedReason, 'NODE_PERMISSION_FS_DENIED');
    assert.match(homeReadResult.error || '', /ERR_ACCESS_DENIED/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Process Sandbox - Node Permission Model: [PASS] child process denied when capability absent', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-perm-child-'));
  const wsDir = path.join(tmpRoot, 'workspace');
  fs.mkdirSync(wsDir);

  // Without 'process.child_process' capability
  const executorNoChild = new ActionExecutor({
    policy: {
      capabilities: {
        'process.exec': true,
        'process.child_process': false
      },
      allowedExecutables: ['node']
    }
  });

  // With 'process.child_process' capability
  const executorWithChild = new ActionExecutor({
    policy: {
      capabilities: {
        'process.exec': true,
        'process.child_process': true
      },
      allowedExecutables: ['node']
    }
  });

  try {
    const deniedResult = executorNoChild.executeAction(wsDir, {
      type: 'EXEC',
      command: `node -e "require('child_process').spawnSync('echo', ['hello'])"`
    });
    assert.equal(deniedResult.status, 'BLOCKED');
    assert.equal(deniedResult.blockedReason, 'NODE_PERMISSION_CHILD_PROCESS_DENIED');
    assert.match(deniedResult.error || '', /ERR_ACCESS_DENIED/);

    const allowedResult = executorWithChild.executeAction(wsDir, {
      type: 'EXEC',
      command: `node -e "console.log(require('child_process').spawnSync('echo', ['hello']).stdout.toString().trim())"`
    });
    assert.equal(allowedResult.status, 'SUCCESS');
    assert.match(allowedResult.output || '', /hello/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Process Sandbox - Node Permission Model: [PASS] network and workers denied when capability absent', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-perm-net-'));
  const wsDir = path.join(tmpRoot, 'workspace');
  fs.mkdirSync(wsDir);

  const executor = new ActionExecutor({
    policy: {
      capabilities: {
        'process.exec': true
      },
      allowedExecutables: ['node']
    }
  });

  try {
    // 1. Worker thread denied
    const workerResult = executor.executeAction(wsDir, {
      type: 'EXEC',
      command: `node -e "new (require('worker_threads').Worker)('console.log(1)', { eval: true })"`
    });
    assert.equal(workerResult.status, 'BLOCKED');
    assert.equal(workerResult.blockedReason, 'NODE_PERMISSION_WORKER_DENIED');
    assert.match(workerResult.error || '', /ERR_ACCESS_DENIED/);

    // 2. Network access denied
    const netResult = executor.executeAction(wsDir, {
      type: 'EXEC',
      command: `node -e "require('net').connect(80, '127.0.0.1')"`
    });
    assert.equal(netResult.status, 'BLOCKED');
    assert.equal(netResult.blockedReason, 'NODE_PERMISSION_NETWORK_DENIED');
    assert.match(netResult.error || '', /ERR_ACCESS_DENIED/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Process Sandbox - Platform Adapter: Fail-closed on missing OS-level helper', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-macos-os-failclose-'));
  // MacOS adapter pointing to non-existent launcher binary must fail closed with SANDBOX_UNAVAILABLE
  const macOsSandbox = new MacOSSandboxAdapter({
    launcherPath: '/nonexistent/helper'
  });
  const executor = new ActionExecutor({
    policy: {
      capabilities: { 'process.exec': true },
      allowedExecutables: ['node']
    },
    sandboxAdapter: macOsSandbox
  });

  try {
    const res = executor.executeAction(tmpRoot, {
      type: 'EXEC',
      command: 'node -e "console.log(1)"'
    });

    assert.equal(res.status, 'BLOCKED');
    assert.equal(res.blockedReason, 'SANDBOX_UNAVAILABLE');
    assert.match(res.error || '', /unavailable|not found/i);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
