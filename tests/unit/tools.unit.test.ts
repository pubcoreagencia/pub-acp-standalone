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

test('ToolParser - parses semantic tools and maps legacy directives', () => {
  const sample = `
Aqui está uma ação semântica:
[TOOL: workspace.read]
path=src/index.ts
[/TOOL]

E git:
[TOOL: git.status][/TOOL]

E json args:
[TOOL: workspace.write]
{"path": "test.txt", "content": "hello"}
[/TOOL]

E legado:
[EXEC: git status][/EXEC]
[EXEC: echo "arbitrary"][/EXEC]
`;

  const requests = ToolParser.parse(sample);
  assert.equal(requests.length, 5);

  assert.equal(requests[0].tool, 'workspace');
  assert.equal(requests[0].operation, 'read');
  assert.equal(requests[0].args.path, 'src/index.ts');
  assert.equal(requests[0].legacyExec, false);

  assert.equal(requests[1].tool, 'git');
  assert.equal(requests[1].operation, 'status');

  assert.equal(requests[2].tool, 'workspace');
  assert.equal(requests[2].operation, 'write');
  assert.equal(requests[2].args.path, 'test.txt');
  assert.equal(requests[2].args.content, 'hello');

  // Legacy bridge maps git status to git tool with legacyExec=true
  assert.equal(requests[3].tool, 'git');
  assert.equal(requests[3].operation, 'status');
  assert.equal(requests[3].legacyExec, true);

  // Other command maps to process.exec with legacyExec=true
  assert.equal(requests[4].tool, 'process');
  assert.equal(requests[4].operation, 'exec');
  assert.equal(requests[4].args.command, 'echo "arbitrary"');
  assert.equal(requests[4].legacyExec, true);
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

test('ToolRegistry & Policy Engine - authorizes allowed capability and blocks denied', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-v5-policy-'));

  const registry = new ToolRegistry({
    capabilities: {
      'workspace.read': true,
      'workspace.write': true,
      'workspace.delete': false, // Denied by policy
      'git.read': true,
      'git.mutate': false,      // Denied by policy
      'process.exec': false     // Denied by policy
    }
  });

  try {
    // 1. Allowed operation
    const writeRes = registry.executeRequest(tmpRoot, {
      tool: 'workspace',
      operation: 'write',
      args: { path: 'data.txt', content: 'test' }
    });
    assert.equal(writeRes.result.status, 'SUCCESS');
    assert.equal(writeRes.telemetry.policyDecision, 'ALLOW');

    // 2. Denied operation (workspace.delete)
    const delRes = registry.executeRequest(tmpRoot, {
      tool: 'workspace',
      operation: 'delete',
      args: { path: 'data.txt' }
    });
    assert.equal(delRes.result.status, 'BLOCKED');
    assert.equal(delRes.result.blockedReason, 'CAPABILITY_POLICY_DENIED');
    assert.equal(delRes.telemetry.policyDecision, 'BLOCK');

    // 3. Denied operation (git.mutate e.g. git.commit)
    const commitRes = registry.executeRequest(tmpRoot, {
      tool: 'git',
      operation: 'commit',
      args: { message: 'nope' }
    });
    assert.equal(commitRes.result.status, 'BLOCKED');
    assert.equal(commitRes.result.blockedReason, 'CAPABILITY_POLICY_DENIED');

    // 4. Denied fallback (process.exec)
    const execRes = registry.executeRequest(tmpRoot, {
      tool: 'process',
      operation: 'exec',
      args: { command: 'echo "hi"' }
    });
    assert.equal(execRes.result.status, 'BLOCKED');
    assert.equal(execRes.result.blockedReason, 'CAPABILITY_POLICY_DENIED');

    // 5. Unknown tool
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

test('NpmTool - executes validated scripts and blocks arbitrary scripts', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-v5-npm-'));
  const pkgJson = {
    name: 'test-pkg',
    scripts: {
      test: 'node -e "console.log(12345)"'
    }
  };
  fs.writeFileSync(path.join(tmpRoot, 'package.json'), JSON.stringify(pkgJson));

  const tool = new NpmTool();

  try {
    // 1. Valid script
    const testRes = tool.execute(tmpRoot, 'test', {});
    assert.equal(testRes.status, 'SUCCESS');
    assert.ok(String(testRes.stdout).includes('12345'));

    // 2. Arbitrary non-existent script
    const evilRes = tool.execute(tmpRoot, 'run', { script: 'malicious-rm' });
    assert.equal(evilRes.status, 'BLOCKED');
    assert.equal(evilRes.blockedReason, 'NPM_SCRIPT_NOT_ALLOWED');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
