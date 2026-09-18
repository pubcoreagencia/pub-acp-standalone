import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ActionParser } from '../../src/actions/ActionParser.js';
import { ActionExecutor } from '../../src/actions/ActionExecutor.js';

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

test('ActionExecutor - ActionPolicy controls individual permissions and fail-closed allowlist', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-policy-test-'));

  // Policy 1: allowExec = false
  const noExecExecutor = new ActionExecutor({
    policy: { allowExec: false }
  });
  const execBlocked = noExecExecutor.executeAction(tmpDir, {
    type: 'EXEC',
    command: 'echo "should be blocked"'
  });
  assert.equal(execBlocked.status, 'BLOCKED');
  assert.match(execBlocked.error || '', /EXEC is disabled by policy/);

  // Policy 2: allowFileDelete = false
  fs.writeFileSync(path.join(tmpDir, 'nodelete.txt'), 'keep me');
  const noDeleteExecutor = new ActionExecutor({
    policy: { allowFileDelete: false }
  });
  const delBlocked = noDeleteExecutor.executeAction(tmpDir, {
    type: 'FILE_DELETE',
    path: 'nodelete.txt'
  });
  assert.equal(delBlocked.status, 'BLOCKED');
  assert.match(delBlocked.error || '', /FILE_DELETE is disabled by policy/);
  assert.equal(fs.existsSync(path.join(tmpDir, 'nodelete.txt')), true);

  // Policy 3: allowedExecCommands allowlist
  const allowlistExecutor = new ActionExecutor({
    policy: {
      allowExec: true,
      allowedExecCommands: ['node', 'git status', 'echo']
    }
  });

  const cmdAllowed = allowlistExecutor.executeAction(tmpDir, {
    type: 'EXEC',
    command: 'echo "ALLOWLIST_PASS"'
  });
  assert.equal(cmdAllowed.status, 'SUCCESS');
  assert.match(cmdAllowed.output || '', /ALLOWLIST_PASS/);

  const cmdForbidden = allowlistExecutor.executeAction(tmpDir, {
    type: 'EXEC',
    command: 'python -c "print(1)"'
  });
  assert.equal(cmdForbidden.status, 'BLOCKED');
  assert.match(cmdForbidden.error || '', /not in the allowedExecCommands policy allowlist/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ActionExecutor - Executes full controlled lifecycle in workspace', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-test-lifecycle-'));
  const executor = new ActionExecutor();

  try {
    // Step 1: Create file
    const batch1 = executor.executeBatch(tmpDir, [
      { type: 'FILE_CREATE', path: 'nested/sub/hello.txt', content: 'GENERIC_EXECUTION_PASS' }
    ]);
    assert.equal(batch1.appliedFiles.length, 1);
    assert.equal(fs.readFileSync(path.join(tmpDir, 'nested/sub/hello.txt'), 'utf8'), 'GENERIC_EXECUTION_PASS');

    // Step 2: Read file
    const batch2 = executor.executeBatch(tmpDir, [
      { type: 'FILE_READ', path: 'nested/sub/hello.txt' }
    ]);
    assert.equal(batch2.readFiles['nested/sub/hello.txt'], 'GENERIC_EXECUTION_PASS');

    // Step 3: Run command
    const batch3 = executor.executeBatch(tmpDir, [
      { type: 'EXEC', command: 'echo "OK"' }
    ]);
    assert.equal(batch3.executedCommands.length, 1);
    assert.equal(batch3.executedCommands[0].exitCode, 0);
    assert.match(batch3.executedCommands[0].stdout, /OK/);

    // Step 4: Delete file
    const batch4 = executor.executeBatch(tmpDir, [
      { type: 'FILE_DELETE', path: 'nested/sub/hello.txt' }
    ]);
    assert.equal(batch4.deletedFiles.length, 1);
    assert.equal(fs.existsSync(path.join(tmpDir, 'nested/sub/hello.txt')), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ActionExecutor - Handles command non-zero exit code and timeout gracefully', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-test-exec-errors-'));
  const executor = new ActionExecutor({
    policy: { execTimeoutMs: 500 }
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

test('ActionExecutor - Dangerous commands are blocked', () => {
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
