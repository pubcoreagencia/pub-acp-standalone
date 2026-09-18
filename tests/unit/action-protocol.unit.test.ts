import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ActionParser } from '../../src/actions/ActionParser.js';
import { ActionExecutor } from '../../src/actions/ActionExecutor.js';
import { CommandTokenizer } from '../../src/actions/CommandTokenizer.js';
import { SandboxSecurity } from '../../src/actions/SandboxSecurity.js';

test('CommandTokenizer - parses command into executable and args without shell', () => {
  const t1 = CommandTokenizer.tokenize('node -e "console.log(123)" --json');
  assert.equal(t1.executable, 'node');
  assert.deepEqual(t1.args, ['-e', 'console.log(123)', '--json']);

  const t2 = CommandTokenizer.tokenize('git status --short');
  assert.equal(t2.executable, 'git');
  assert.deepEqual(t2.args, ['status', '--short']);

  const t3 = CommandTokenizer.tokenize('cat "file with spaces.txt"');
  assert.equal(t3.executable, 'cat');
  assert.deepEqual(t3.args, ['file with spaces.txt']);

  const tErr = CommandTokenizer.tokenize('node -e "unterminated');
  assert.ok(tErr.error);
});

test('ActionParser - extracts FILE_CREATE, FILE_WRITE, FILE_READ, FILE_DELETE, and EXEC in order', () => {
  const sample = `
Aqui está o plano:
[FILE_CREATE: src/hello.txt]
Hello World!
[/FILE_CREATE]

E depois lemos:
[FILE_READ: src/hello.txt][/FILE_READ]

E executamos:
[EXEC: echo "testing"][/EXEC]

E deletamos:
[FILE_DELETE: old.log][/FILE_DELETE]
`;

  const actions = ActionParser.parse(sample);
  assert.equal(actions.length, 4);

  assert.equal(actions[0].type, 'FILE_CREATE');
  assert.equal((actions[0] as any).path, 'src/hello.txt');
  assert.equal((actions[0] as any).content.trim(), 'Hello World!');

  assert.equal(actions[1].type, 'FILE_READ');
  assert.equal((actions[1] as any).path, 'src/hello.txt');

  assert.equal(actions[2].type, 'EXEC');
  assert.equal((actions[2] as any).command, 'echo "testing"');

  assert.equal(actions[3].type, 'FILE_DELETE');
  assert.equal((actions[3] as any).path, 'old.log');
});

test('ActionExecutor - Fail-Closed: blocks path traversal attempts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-test-safety-'));
  const executor = new ActionExecutor();

  try {
    // 1. Up traversal with ..
    const escapeResult = executor.resolvePathInsideWorkspace(tmpDir, '../outside.txt');
    assert.equal(escapeResult.ok, false);
    assert.match(escapeResult.error || '', /Path traversal violation/);

    // 2. Deep up traversal
    const deepEscape = executor.resolvePathInsideWorkspace(tmpDir, 'sub/../../outside.txt');
    assert.equal(deepEscape.ok, false);
    assert.match(deepEscape.error || '', /Path traversal violation/);

    // 3. Absolute path outside workspace
    const absEscape = executor.resolvePathInsideWorkspace(tmpDir, '/etc/passwd');
    assert.equal(absEscape.ok, false);
    assert.match(absEscape.error || '', /Path traversal violation/);

    // 4. Execution of FILE_WRITE outside workspace
    const writeResult = executor.executeAction(tmpDir, {
      type: 'FILE_WRITE',
      path: '../../etc/test.conf',
      content: 'evil'
    });
    assert.equal(writeResult.status, 'BLOCKED');
    assert.equal(writeResult.blockedReason, 'PATH_SECURITY_VIOLATION');
    assert.match(writeResult.error || '', /Path traversal violation/);

    // 5. Execution of FILE_READ outside workspace
    const readResult = executor.executeAction(tmpDir, {
      type: 'FILE_READ',
      path: '../other/secret.key'
    });
    assert.equal(readResult.status, 'BLOCKED');

    // 6. Execution of FILE_DELETE outside workspace
    const deleteResult = executor.executeAction(tmpDir, {
      type: 'FILE_DELETE',
      path: '../../root.txt'
    });
    assert.equal(deleteResult.status, 'BLOCKED');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ActionExecutor - Symlink Escape Protection: blocks symlink traversing workspace boundary', () => {
  const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-symlink-root-'));
  const workspaceDir = path.join(rootTmp, 'workspace');
  const externalDir = path.join(rootTmp, 'external');
  fs.mkdirSync(workspaceDir);
  fs.mkdirSync(externalDir);

  const secretFile = path.join(externalDir, 'secret.env');
  fs.writeFileSync(secretFile, 'SUPER_SECRET_TOKEN=12345');

  // Create symlinks inside workspace pointing outside
  fs.symlinkSync(secretFile, path.join(workspaceDir, 'symlink-secret.env'));
  fs.symlinkSync(externalDir, path.join(workspaceDir, 'symlink-dir'));

  const executor = new ActionExecutor();

  try {
    // 1. FILE_READ via symlink to external file
    const readSymlinkFile = executor.executeAction(workspaceDir, {
      type: 'FILE_READ',
      path: 'symlink-secret.env'
    });
    assert.equal(readSymlinkFile.status, 'BLOCKED');
    assert.match(readSymlinkFile.error || '', /Symlink escape violation/);

    // 2. FILE_READ via symlink directory
    const readSymlinkDir = executor.executeAction(workspaceDir, {
      type: 'FILE_READ',
      path: 'symlink-dir/secret.env'
    });
    assert.equal(readSymlinkDir.status, 'BLOCKED');
    assert.match(readSymlinkDir.error || '', /Symlink escape violation/);

    // 3. FILE_WRITE via symlink to external file
    const writeSymlinkFile = executor.executeAction(workspaceDir, {
      type: 'FILE_WRITE',
      path: 'symlink-secret.env',
      content: 'overwritten'
    });
    assert.equal(writeSymlinkFile.status, 'BLOCKED');
    assert.match(writeSymlinkFile.error || '', /Symlink escape violation/);
    assert.equal(fs.readFileSync(secretFile, 'utf8'), 'SUPER_SECRET_TOKEN=12345');

    // 4. FILE_WRITE inside symlink directory
    const writeSymlinkDir = executor.executeAction(workspaceDir, {
      type: 'FILE_WRITE',
      path: 'symlink-dir/new_evil.txt',
      content: 'evil'
    });
    assert.equal(writeSymlinkDir.status, 'BLOCKED');
    assert.match(writeSymlinkDir.error || '', /Symlink escape violation/);

    // 5. FILE_DELETE via symlink
    const deleteSymlink = executor.executeAction(workspaceDir, {
      type: 'FILE_DELETE',
      path: 'symlink-secret.env'
    });
    assert.equal(deleteSymlink.status, 'BLOCKED');
    assert.match(deleteSymlink.error || '', /Symlink escape violation/);
    assert.equal(fs.existsSync(secretFile), true);
  } finally {
    fs.rmSync(rootTmp, { recursive: true, force: true });
  }
});

test('ActionExecutor - Internal symlink strictly inside workspace is allowed', () => {
  const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-internal-sym-'));
  const workspaceDir = path.join(rootTmp, 'workspace');
  fs.mkdirSync(workspaceDir);

  const realDir = path.join(workspaceDir, 'real');
  fs.mkdirSync(realDir);
  fs.writeFileSync(path.join(realDir, 'data.txt'), 'ALLOWED_INTERNAL_DATA');

  // Internal symlink
  fs.symlinkSync(realDir, path.join(workspaceDir, 'link-real'));

  const executor = new ActionExecutor();

  try {
    const readInternal = executor.executeAction(workspaceDir, {
      type: 'FILE_READ',
      path: 'link-real/data.txt'
    });
    assert.equal(readInternal.status, 'SUCCESS');
    assert.equal(readInternal.output, 'ALLOWED_INTERNAL_DATA');
  } finally {
    fs.rmSync(rootTmp, { recursive: true, force: true });
  }
});

test('ActionExecutor - Capability Model and ActionPolicy control permissions', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-capability-test-'));

  // 1. Disable process.exec capability
  const noExecExecutor = new ActionExecutor({
    policy: {
      capabilities: { 'process.exec': false }
    }
  });
  const execBlocked = noExecExecutor.executeAction(tmpDir, {
    type: 'EXEC',
    command: 'node -e "console.log(1)"'
  });
  assert.equal(execBlocked.status, 'BLOCKED');
  assert.equal(execBlocked.blockedReason, 'CAPABILITY_POLICY_VIOLATION');
  assert.match(execBlocked.error || '', /Capability "process.exec" is disabled/);

  // 2. Disable workspace.delete capability
  fs.writeFileSync(path.join(tmpDir, 'keep.txt'), 'data');
  const noDeleteExecutor = new ActionExecutor({
    policy: {
      capabilities: { 'workspace.delete': false }
    }
  });
  const delBlocked = noDeleteExecutor.executeAction(tmpDir, {
    type: 'FILE_DELETE',
    path: 'keep.txt'
  });
  assert.equal(delBlocked.status, 'BLOCKED');
  assert.equal(delBlocked.blockedReason, 'CAPABILITY_DISABLED');

  // 3. Allowed executables allowlist
  const restrictedExec = new ActionExecutor({
    policy: {
      capabilities: { 'process.exec': true },
      allowedExecutables: ['node', 'git']
    }
  });

  const nodeAllowed = restrictedExec.executeAction(tmpDir, {
    type: 'EXEC',
    command: 'node -e "console.log(12345)"'
  });
  assert.equal(nodeAllowed.status, 'SUCCESS');
  assert.match(nodeAllowed.output || '', /12345/);

  const pythonBlocked = restrictedExec.executeAction(tmpDir, {
    type: 'EXEC',
    command: 'python -c "print(1)"'
  });
  assert.equal(pythonBlocked.status, 'BLOCKED');
  assert.match(pythonBlocked.error || '', /not authorized by allowedExecutables/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ActionExecutor - Negative Security: Blocks shell operators and external path arguments in EXEC', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-negative-exec-'));
  const executor = new ActionExecutor({
    policy: {
      allowedExecutables: ['node', 'cat'],
      disallowShellOperators: true,
      disallowExternalPathArgs: true
    }
  });

  try {
    // 1. Shell injection / operator attempt
    const shellOp1 = executor.executeAction(tmpDir, {
      type: 'EXEC',
      command: 'node -e "console.log(1)" && echo "chained"'
    });
    assert.equal(shellOp1.status, 'BLOCKED');
    assert.match(shellOp1.error || '', /Shell operator/);

    const shellOp2 = executor.executeAction(tmpDir, {
      type: 'EXEC',
      command: 'node -e "console.log(1)" ; echo "pwned"'
    });
    assert.equal(shellOp2.status, 'BLOCKED');
    assert.match(shellOp2.error || '', /Shell operator/);

    // 2. External path in arguments (e.g. /etc/passwd or /tmp)
    const externalArg = executor.executeAction(tmpDir, {
      type: 'EXEC',
      command: 'cat /etc/passwd'
    });
    assert.equal(externalArg.status, 'BLOCKED');
    assert.match(externalArg.error || '', /Argument references external absolute path/);

    // 3. Relative path traversal in argument
    const traversalArg = executor.executeAction(tmpDir, {
      type: 'EXEC',
      command: 'cat ../../../secret.txt'
    });
    assert.equal(traversalArg.status, 'BLOCKED');
    assert.match(traversalArg.error || '', /Argument references escaping relative path/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ActionExecutor - Handles command non-zero exit code and timeout gracefully', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-test-exec-errors-'));
  const executor = new ActionExecutor({
    policy: {
      execTimeoutMs: 500,
      allowedExecutables: ['node']
    }
  });

  try {
    // 1. Non-zero exit code
    const nonZeroResult = executor.executeAction(tmpDir, {
      type: 'EXEC',
      command: 'node -e "process.exit(42)"'
    });
    assert.equal(nonZeroResult.status, 'FAILED');
    assert.ok(nonZeroResult.error);

    // 2. Command timeout
    const timeoutResult = executor.executeAction(tmpDir, {
      type: 'EXEC',
      command: 'node -e "while(true){}"'
    });
    assert.equal(timeoutResult.status, 'FAILED');
    assert.match(timeoutResult.error || '', /timed out/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ActionExecutor - Dangerous commands are blocked by fail-closed pattern gate', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-test-danger-'));
  const executor = new ActionExecutor();

  try {
    const dangerous = [
      'rm -rf /',
      'rm -rf /tmp',
      'format c:',
      'shutdown -h now'
    ];

    for (const cmd of dangerous) {
      const res = executor.executeAction(tmpDir, { type: 'EXEC', command: cmd });
      assert.equal(res.status, 'BLOCKED', `Command should be blocked: ${cmd}`);
      assert.match(res.error || '', /Dangerous command pattern detected/);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
