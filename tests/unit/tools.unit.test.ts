import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolParser } from '../../src/tools/ToolParser.js';
import { ToolRegistry } from '../../src/tools/ToolRegistry.js';
import { WorkspaceTool } from '../../src/tools/WorkspaceTool.js';
import { GitTool } from '../../src/tools/GitTool.js';
import { NpmTool } from '../../src/tools/NpmTool.js';

test('ToolParser - parses semantic tools and maps legacy directives preserving strict global order', () => {
  const sample = `
Aqui está uma ação semântica 1:
[TOOL: git.status][/TOOL]

Ação legada 2:
[EXEC: echo second][/EXEC]

Ação de arquivo 3:
[FILE_CREATE: test.txt]
content
[/FILE_CREATE]

Ação semântica 4:
[TOOL: workspace.read]
path=test.txt
[/TOOL]

Ação legada 5:
[EXEC: echo fifth][/EXEC]

Ação de leitura 6:
[FILE_READ: test.txt][/FILE_READ]
`;

  const requests = ToolParser.parse(sample);
  assert.equal(requests.length, 6);

  // 1: git.status
  assert.equal(requests[0].tool, 'git');
  assert.equal(requests[0].operation, 'status');
  assert.equal(requests[0].legacyExec, false);

  // 2: process.exec (echo second)
  assert.equal(requests[1].tool, 'process');
  assert.equal(requests[1].operation, 'exec');
  assert.equal(requests[1].args.command, 'echo second');
  assert.equal(requests[1].legacyExec, true);

  // 3: workspace.create
  assert.equal(requests[2].tool, 'workspace');
  assert.equal(requests[2].operation, 'create');
  assert.equal(requests[2].args.path, 'test.txt');

  // 4: workspace.read
  assert.equal(requests[3].tool, 'workspace');
  assert.equal(requests[3].operation, 'read');
  assert.equal(requests[3].args.path, 'test.txt');

  // 5: process.exec (echo fifth)
  assert.equal(requests[4].tool, 'process');
  assert.equal(requests[4].operation, 'exec');
  assert.equal(requests[4].args.command, 'echo fifth');

  // 6: workspace.read
  assert.equal(requests[5].tool, 'workspace');
  assert.equal(requests[5].operation, 'read');
  assert.equal(requests[5].args.path, 'test.txt');
});

test('WorkspaceTool - operations, path traversal and symlink containment', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-v5-ws-'));
  const wsDir = path.join(tmpRoot, 'workspace');
  fs.mkdirSync(wsDir);

  const tool = new WorkspaceTool();

  try {
    // 1. Write file
    const writeRes = tool.execute(wsDir, 'write', { path: 'hello.txt', content: 'world' });
    assert.equal(writeRes.status, 'SUCCESS');
    assert.equal(fs.readFileSync(path.join(wsDir, 'hello.txt'), 'utf8'), 'world');

    // 2. Read file
    const readRes = tool.execute(wsDir, 'read', { path: 'hello.txt' });
    assert.equal(readRes.status, 'SUCCESS');
    assert.equal(readRes.stdout, 'world');

    // 3. List files
    const listRes = tool.execute(wsDir, 'list', { path: '.' });
    assert.equal(listRes.status, 'SUCCESS');
    assert.ok(String(listRes.stdout).includes('hello.txt'));

    // 4. Path traversal blocked
    const traversalRes = tool.execute(wsDir, 'read', { path: '../outside.txt' });
    assert.equal(traversalRes.status, 'BLOCKED');
    assert.equal(traversalRes.blockedReason, 'PATH_SECURITY_VIOLATION');

    // 5. Delete file
    const delRes = tool.execute(wsDir, 'delete', { path: 'hello.txt' });
    assert.equal(delRes.status, 'SUCCESS');
    assert.equal(fs.existsSync(path.join(wsDir, 'hello.txt')), false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('ToolRegistry - Strict Fail-Closed capability evaluation & telemetry propagation', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-v5-policy-'));

  const registry = new ToolRegistry({
    capabilities: {
      'workspace.read': true,
      'workspace.write': true,
      'workspace.delete': false, // Explicit false
      'git.read': true
      // git.mutate, process.exec, npm.* are MISSING -> must fail-closed (BLOCK)
    }
  });

  try {
    // 1. True capability allows
    const writeRes = registry.executeRequest(tmpRoot, {
      tool: 'workspace',
      operation: 'write',
      args: { path: 'data.txt', content: 'test' }
    }, { runId: 'run-123', turn: 4, provider: 'gpt' });

    assert.equal(writeRes.result.status, 'SUCCESS');
    assert.equal(writeRes.telemetry.policyDecision, 'ALLOW');
    assert.equal(writeRes.telemetry.runId, 'run-123');
    assert.equal(writeRes.telemetry.turn, 4);

    // 2. Explicit false capability blocks
    const delRes = registry.executeRequest(tmpRoot, {
      tool: 'workspace',
      operation: 'delete',
      args: { path: 'data.txt' }
    });
    assert.equal(delRes.result.status, 'BLOCKED');
    assert.equal(delRes.result.blockedReason, 'CAPABILITY_POLICY_DENIED');
    assert.equal(delRes.telemetry.policyDecision, 'BLOCK');

    // 3. Missing capability blocks (Fail-Closed)
    const commitRes = registry.executeRequest(tmpRoot, {
      tool: 'git',
      operation: 'commit',
      args: { message: 'nope' }
    });
    assert.equal(commitRes.result.status, 'BLOCKED');
    assert.equal(commitRes.result.blockedReason, 'CAPABILITY_POLICY_DENIED');

    const execRes = registry.executeRequest(tmpRoot, {
      tool: 'process',
      operation: 'exec',
      args: { command: 'echo "hi"' }
    });
    assert.equal(execRes.result.status, 'BLOCKED');
    assert.equal(execRes.result.blockedReason, 'CAPABILITY_POLICY_DENIED');

    // 4. Unknown operation blocked with UNKNOWN_OPERATION
    const unkOpRes = registry.executeRequest(tmpRoot, {
      tool: 'workspace',
      operation: 'formatHardDrive',
      args: {}
    });
    assert.equal(unkOpRes.result.status, 'BLOCKED');
    assert.equal(unkOpRes.result.blockedReason, 'UNKNOWN_OPERATION');

    // 5. Unknown tool blocked with TOOL_NOT_FOUND
    const unknownRes = registry.executeRequest(tmpRoot, {
      tool: 'nonexistent',
      operation: 'doSomething',
      args: {}
    });
    assert.equal(unknownRes.result.status, 'BLOCKED');
    assert.equal(unknownRes.result.blockedReason, 'TOOL_NOT_FOUND');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('NpmTool - validates script existence, blocks arbitrary scripts and dangerous patterns', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-v5-npm-'));
  const pkgJson = {
    name: 'test-pkg',
    scripts: {
      test: 'node -e "console.log(12345)"',
      evil: 'rm -rf / --no-preserve-root'
    }
  };
  fs.writeFileSync(path.join(tmpRoot, 'package.json'), JSON.stringify(pkgJson));

  const tool = new NpmTool();

  try {
    // 1. Valid script
    const testRes = tool.execute(tmpRoot, 'test', {});
    assert.equal(testRes.status, 'SUCCESS');
    assert.ok(String(testRes.stdout).includes('12345'));
    assert.ok(testRes.metadata?.scriptContent);

    // 2. Arbitrary non-existent script
    const missingRes = tool.execute(tmpRoot, 'run', { script: 'malicious-unknown' });
    assert.equal(missingRes.status, 'BLOCKED');
    assert.equal(missingRes.blockedReason, 'NPM_SCRIPT_NOT_ALLOWED');

    // 3. Script with dangerous pattern detected
    const evilRes = tool.execute(tmpRoot, 'run', { script: 'evil' });
    assert.equal(evilRes.status, 'BLOCKED');
    assert.equal(evilRes.blockedReason, 'NPM_SCRIPT_NOT_ALLOWED');
    assert.match(evilRes.stderr || '', /dangerous pattern/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
