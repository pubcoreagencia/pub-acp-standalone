import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ControlRoomServer } from '../../src/server/ControlRoomServer.js';
import { EventBus } from '../../src/observability/EventBus.js';
import { MemoryRunStore } from '../../src/observability/RunStore.js';
import { BrowserOperator } from '../../src/browser/BrowserOperator.js';
import { AuthorizationEngine } from '../../src/tools/AuthorizationEngine.js';

test('ControlRoomServer - Browser Operator API contract and capability enforcement', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-contract-browser-'));
  const screenshotDir = path.join(tmpRoot, '.acp', 'screenshots');

  const eventBus = new EventBus();
  const runStore = new MemoryRunStore();
  const browserOperator = new BrowserOperator({
    cdpEndpoint: 'http://127.0.0.1:9222',
    screenshotDir,
    eventBus
  });

  // AuthorizationEngine with browser.status and browser.read allowed, but browser.navigate and browser.screenshot blocked
  const restrictedAuthEngine = new AuthorizationEngine({
    capabilities: {
      'browser.status': true,
      'browser.read': true,
      'browser.navigate': false
      // browser.screenshot missing -> blocked
    }
  });

  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    eventBus,
    runStore,
    browserOperator,
    authorizationEngine: restrictedAuthEngine
  });

  const { url } = await server.start();

  try {
    // 1. GET /api/browser/status - Allowed
    const resStatus = await fetch(`${url}/api/browser/status`);
    assert.equal(resStatus.status, 200);
    const statusData = await resStatus.json() as any;
    assert.ok(statusData.status);
    assert.ok(statusData.cdpEndpoint);
    assert.ok(statusData.profileDir);
    assert.equal(statusData.webSocketDebuggerUrl, undefined);

    // 2. POST /api/browser/navigate - Blocked by Capability Policy (403)
    const resNavBlocked = await fetch(`${url}/api/browser/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:8080' })
    });
    assert.equal(resNavBlocked.status, 403);
    const navBlockedData = await resNavBlocked.json() as any;
    assert.equal(navBlockedData.blockedReason, 'CAPABILITY_POLICY_DENIED');

    // 3. POST /api/browser/screenshot - Blocked by Capability Policy (403)
    const resShotBlocked = await fetch(`${url}/api/browser/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(resShotBlocked.status, 403);
    const shotBlockedData = await resShotBlocked.json() as any;
    assert.equal(shotBlockedData.blockedReason, 'CAPABILITY_POLICY_DENIED');

    // 4. Permissive server testing
    const permissiveAuthEngine = new AuthorizationEngine({
      capabilities: {
        'browser.status': true,
        'browser.navigate': true,
        'browser.read': true,
        'browser.screenshot': true
      }
    });

    const permissiveServer = new ControlRoomServer({
      port: 0,
      host: '127.0.0.1',
      eventBus,
      runStore,
      browserOperator,
      authorizationEngine: permissiveAuthEngine
    });
    const permUrl = (await permissiveServer.start()).url;

    try {
      // 4.1 Missing URL -> 400
      const resBadNav = await fetch(`${permUrl}/api/browser/navigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.equal(resBadNav.status, 400);

      // 4.2 Malicious file:// scheme -> 403
      const resFileNav = await fetch(`${permUrl}/api/browser/navigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'file:///etc/passwd' })
      });
      assert.equal(resFileNav.status, 403);
      const fileData = await resFileNav.json() as any;
      assert.equal(fileData.status, 'BLOCKED');
      assert.equal(fileData.blockedReason, 'FILESYSTEM_ACCESS_BLOCKED');

      // 4.3 Domain outside allowlist -> 403
      const resEvilNav = await fetch(`${permUrl}/api/browser/navigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://attacker.site/steal' })
      });
      assert.equal(resEvilNav.status, 403);
      const evilData = await resEvilNav.json() as any;
      assert.equal(evilData.status, 'BLOCKED');
      assert.equal(evilData.blockedReason, 'DOMAIN_NOT_ALLOWED');

      // 4.4 GET /api/browser/page
      const resPage = await fetch(`${permUrl}/api/browser/page`);
      assert.equal(resPage.status, 200);
      const pageData = await resPage.json() as any;
      assert.ok(pageData.url !== undefined);
      assert.ok(pageData.domain !== undefined);
    } finally {
      await permissiveServer.stop();
    }
  } finally {
    await server.stop();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
