import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkspaceCommand, WorkspaceCommandExecutor } from '../../src/runtime/execution/WorkspaceCommandExecutor.js';

test('WorkspaceCommandExecutor rejects empty command', async () => {
  const result = await new WorkspaceCommandExecutor().execute({
    workspacePath: process.cwd(),
    command: '   '
  });

  assert.equal(result.status, 'FAILED');
  assert.match(result.output, /empty/i);
});

test('WorkspaceCommandExecutor rejects explicit shell navigation outside workspace', () => {
  for (const command of [
    'cd .. && npm test',
    'pushd .. && npm test',
    'Set-Location ..; npm test',
    'cd C:\\outside && npm test'
  ]) {
    const error = validateWorkspaceCommand(command);
    assert.match(error || '', /rejected/i);
  }
});

test('WorkspaceCommandExecutor rejects explicit absolute and UNC paths', () => {
  for (const command of [
    'type C:\\secret.txt',
    'node C:\\outside\\script.js',
    'type \\\\server\\share\\secret.txt',
    'cat /etc/passwd'
  ]) {
    const error = validateWorkspaceCommand(command);
    assert.match(error || '', /absolute|UNC/i);
  }
});

test('WorkspaceCommandExecutor rejects parent traversal path forms', () => {
  for (const command of [
    'type ..\\secret.txt',
    'cat ../secret.txt'
  ]) {
    const error = validateWorkspaceCommand(command);
    assert.match(error || '', /parent-directory/i);
  }
});

test('WorkspaceCommandExecutor allows ordinary workspace-relative commands', () => {
  assert.equal(validateWorkspaceCommand('node -e "process.stdout.write(\'ok\')"'), null);
});
