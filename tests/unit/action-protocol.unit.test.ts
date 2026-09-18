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

    // 2. Absolute path outside workspace
    const absEscape = executor.resolvePathInsideWorkspace(tmpDir, '/etc/passwd');
    assert.equal(absEscape.ok, false);
    assert.match(absEscape.error || '', /Path traversal violation/);

    // 3. Execution of FILE_WRITE outside workspace
    const writeResult = executor.executeAction(tmpDir, {
      type: 'FILE_WRITE',
      path: '../../etc/test.conf',
      content: 'evil'
    });
    assert.equal(writeResult.status, 'BLOCKED');
    assert.match(writeResult.error || '', /Path traversal violation/);

    // 4. Execution of FILE_READ outside workspace
    const readResult = executor.executeAction(tmpDir, {
      type: 'FILE_READ',
      path: '../other/secret.key'
    });
    assert.equal(readResult.status, 'BLOCKED');

    // 5. Execution of FILE_DELETE outside workspace
    const deleteResult = executor.executeAction(tmpDir, {
      type: 'FILE_DELETE',
      path: '../../root.txt'
    });
    assert.equal(deleteResult.status, 'BLOCKED');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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
