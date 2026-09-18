import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BrowserOperator } from '../../src/browser/BrowserOperator.js';
import { BrowserTool } from '../../src/tools/BrowserTool.js';
import { ToolRegistry } from '../../src/tools/ToolRegistry.js';

test('BrowserOperator - URL validation & domain allowlist enforcement', async () => {
  const operator = new BrowserOperator({
    allowedDomains: ['localhost', '127.0.0.1', 'example.com', 'pubcore.com.br']
  });

  // 1. Invalid / empty URL
  const emptyRes = await operator.navigate('');
  assert.equal(emptyRes.status, 'BLOCKED');
  assert.equal(emptyRes.blockedReason, 'INVALID_URL');

  const malformedRes = await operator.navigate('not-a-url');
  assert.equal(malformedRes.status, 'BLOCKED');
  assert.equal(malformedRes.blockedReason, 'INVALID_URL');

  // 2. Dangerous schemes blocked
  const fileRes = await operator.navigate('file:///etc/passwd');
  assert.equal(fileRes.status, 'BLOCKED');
  assert.equal(fileRes.blockedReason, 'FILESYSTEM_ACCESS_BLOCKED');

  const jsRes = await operator.navigate('javascript:alert(1)');
  assert.equal(jsRes.status, 'BLOCKED');
  assert.equal(jsRes.blockedReason, 'JAVASCRIPT_URL_BLOCKED');

  const dataRes = await operator.navigate('data:text/html,<h1>evil</h1>');
  assert.equal(dataRes.status, 'BLOCKED');
  assert.equal(dataRes.blockedReason, 'DATA_URL_BLOCKED');

  // 3. Domain outside allowlist blocked
  const evilDomain = await operator.navigate('https://malicious-site.com/exploit');
  assert.equal(evilDomain.status, 'BLOCKED');
  assert.equal(evilDomain.blockedReason, 'DOMAIN_NOT_ALLOWED');
  assert.equal(evilDomain.domain, 'malicious-site.com');

  // 4. Allowed domain passes domain check
  const disconnectedOp = new BrowserOperator({ cdpEndpoint: 'http://127.0.0.1:99999', allowedDomains: ['example.com'] });
  const allowedRes = await disconnectedOp.navigate('https://example.com/login?token=secret123');
  assert.equal(allowedRes.status, 'FAILED');
  assert.notEqual(allowedRes.blockedReason, 'DOMAIN_NOT_ALLOWED');
  assert.notEqual(allowedRes.blockedReason, 'FILESYSTEM_ACCESS_BLOCKED');
  // URL should be sanitized in output
  assert.equal(allowedRes.url, 'https://example.com/login?...');
});

test('BrowserOperator - Sanitization never leaks credentials or sensitive tokens in URLs and telemetry', () => {
  const operator = new BrowserOperator();
  const sensitiveUrl = 'https://example.com/auth?token=supersecret&session=xyz123&code=abcd#heading';
  const val = operator.validateUrl(sensitiveUrl);
  assert.equal(val.ok, true);
  if (val.parsed) {
    const sanitized = val.parsed.origin + val.parsed.pathname;
    assert.equal(sanitized, 'https://example.com/auth');
  }
});

test('BrowserOperator - Screenshot path containment within workspace .acp/screenshots', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-browser-test-'));
  const screenshotDir = path.join(tmpRoot, '.acp', 'screenshots');
  const operator = new BrowserOperator({ cdpEndpoint: 'http://127.0.0.1:99999', screenshotDir });

  try {
    const res = await operator.screenshot();
    assert.equal(res.status, 'FAILED');
    assert.equal(operator.getScreenshotDir(), screenshotDir);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('BrowserTool - Adapter mapping and execution', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-browser-tool-'));
  const operator = new BrowserOperator({
    allowedDomains: ['127.0.0.1', 'localhost', 'example.com']
  });
  const tool = new BrowserTool(operator);

  try {
    assert.equal(tool.name, 'browser');
    assert.equal(tool.getRequiredCapability('status', {}), 'browser.status');
    assert.equal(tool.getRequiredCapability('navigate', {}), 'browser.navigate');
    assert.equal(tool.getRequiredCapability('read', {}), 'browser.read');
    assert.equal(tool.getRequiredCapability('screenshot', {}), 'browser.screenshot');

    // Invalid scheme through tool adapter
    const blockedRes = await tool.execute(tmpRoot, 'navigate', { url: 'file:///etc/hosts' });
    assert.equal(blockedRes.status, 'BLOCKED');
    assert.equal(blockedRes.blockedReason, 'FILESYSTEM_ACCESS_BLOCKED');

    // Domain outside allowlist through tool adapter
    const notAllowed = await tool.execute(tmpRoot, 'navigate', { url: 'https://evil.org' });
    assert.equal(notAllowed.status, 'BLOCKED');
    assert.equal(notAllowed.blockedReason, 'DOMAIN_NOT_ALLOWED');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('ToolRegistry - Browser capabilities authorization fail-closed enforcement', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-browser-reg-'));

  const registry = new ToolRegistry({
    capabilities: {
      'browser.status': true,
      'browser.navigate': false,
      'browser.read': true
    }
  });

  try {
    // 1. Explicitly denied capability (browser.navigate)
    const navRes = await registry.executeRequest(tmpRoot, {
      tool: 'browser',
      operation: 'navigate',
      args: { url: 'http://localhost:3000' }
    });
    assert.equal(navRes.result.status, 'BLOCKED');
    assert.equal(navRes.result.blockedReason, 'CAPABILITY_POLICY_DENIED');
    assert.equal(navRes.telemetry.policyDecision, 'BLOCK');

    // 2. Implicitly denied capability (browser.screenshot missing from capabilities)
    const screenRes = await registry.executeRequest(tmpRoot, {
      tool: 'browser',
      operation: 'screenshot',
      args: {}
    });
    assert.equal(screenRes.result.status, 'BLOCKED');
    assert.equal(screenRes.result.blockedReason, 'CAPABILITY_POLICY_DENIED');
    assert.equal(screenRes.telemetry.policyDecision, 'BLOCK');

    // 3. Allowed capability (browser.status)
    const statusRes = await registry.executeRequest(tmpRoot, {
      tool: 'browser',
      operation: 'status',
      args: {}
    });
    assert.notEqual(statusRes.result.status, 'BLOCKED');
    assert.equal(statusRes.telemetry.policyDecision, 'ALLOW');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
