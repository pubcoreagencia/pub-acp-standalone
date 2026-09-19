import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectValidator } from '../../src/validation/ProjectValidator.js';

test('ProjectValidator skips NONE policy', async () => {
  const validator = new ProjectValidator();
  const result = await validator.validate(process.cwd(), { mode: 'NONE' });
  assert.equal(result.status, 'SKIPPED');
});

test('ProjectValidator skips OPTIONAL policy without command', async () => {
  const validator = new ProjectValidator();
  const result = await validator.validate(process.cwd(), { mode: 'OPTIONAL' });
  assert.equal(result.status, 'SKIPPED');
});

test('ProjectValidator errors on REQUIRED policy without command', async () => {
  const validator = new ProjectValidator();
  const result = await validator.validate(process.cwd(), { mode: 'REQUIRED' });
  assert.equal(result.status, 'ERROR');
});

test('ProjectValidator passes a successful command', async () => {
  const validator = new ProjectValidator();
  const command = process.platform === 'win32' ? 'node -e "process.exit(0)"' : 'node -e "process.exit(0)"';
  const result = await validator.validate(process.cwd(), {
    mode: 'REQUIRED',
    command,
    timeoutMs: 5000
  }, { runId: 'test-run', turn: 1 });

  assert.equal(result.status, 'PASS');
  assert.equal(result.exitCode, 0);
});

test('ProjectValidator reports command failure', async () => {
  const validator = new ProjectValidator();
  const command = process.platform === 'win32' ? 'node -e "process.exit(7)"' : 'node -e "process.exit(7)"';
  const result = await validator.validate(process.cwd(), {
    mode: 'REQUIRED',
    command,
    timeoutMs: 5000
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.exitCode, 7);
});

test('ProjectValidator reports unavailable workspace', async () => {
  const validator = new ProjectValidator();
  const result = await validator.validate(join(tmpdir(), 'pub-acp-nonexistent-workspace'), {
    mode: 'REQUIRED',
    command: 'node -e "process.exit(0)"'
  });

  assert.equal(result.status, 'ERROR');
});

test('ProjectValidator reports timeout', async () => {
  const validator = new ProjectValidator();
  const command = 'node -e "setTimeout(() => process.exit(0), 1000)"';
  const result = await validator.validate(process.cwd(), {
    mode: 'REQUIRED',
    command,
    timeoutMs: 50
  });

  assert.equal(result.status, 'ERROR');
});

test('ProjectValidator can execute inside a temporary workspace', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'pub-acp-validator-'));
  try {
    await writeFile(join(workspace, 'marker.txt'), 'ok', 'utf8');
    const validator = new ProjectValidator();
    const command = 'node -e "require(\'fs\').accessSync(\'marker.txt\')"';
    const result = await validator.validate(workspace, {
      mode: 'REQUIRED',
      command,
      timeoutMs: 5000
    });

    assert.equal(result.status, 'PASS');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
