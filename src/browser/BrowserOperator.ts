import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IEventBus } from '../observability/EventBus.js';

export interface BrowserOperatorOptions {
  cdpEndpoint?: string;
  profileDir?: string;
  allowedDomains?: string[];
  screenshotDir?: string;
  eventBus?: IEventBus;
}

export interface BrowserStatusResult {
  status: 'CONNECTED' | 'DISCONNECTED';
  cdpEndpoint: string;
  profileDir: string;
  browser: string;
  protocolVersion?: string;
  connected: boolean;
}

export interface BrowserNavigateResult {
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  url: string;
  domain: string;
  title?: string;
  error?: string;
  blockedReason?: string;
  durationMs: number;
}

export interface BrowserReadResult {
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  url: string;
  domain: string;
  title: string;
  text: string;
  links: Array<{ text: string; href: string }>;
  error?: string;
  blockedReason?: string;
  durationMs: number;
}

export interface BrowserScreenshotResult {
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  path?: string;
  filename?: string;
  bytes?: number;
  url: string;
  domain: string;
  error?: string;
  blockedReason?: string;
  durationMs: number;
}

export class BrowserOperator {
  private readonly cdpEndpoint: string;
  private readonly profileDir: string;
  private readonly allowedDomains: string[];
  private readonly screenshotDir: string;
  private readonly eventBus?: IEventBus;

  // Track page state
  private currentPageState: {
    url: string;
    domain: string;
    title: string;
    lastNav?: string;
    lastScreenshot?: string;
  } = {
    url: 'about:blank',
    domain: 'localhost',
    title: ''
  };

  constructor(options: BrowserOperatorOptions = {}) {
    const home = process.env.HOME || '';
    this.cdpEndpoint = (options.cdpEndpoint || 'http://127.0.0.1:9222').replace(/\/+$/, '');
    this.profileDir = options.profileDir || path.join(home, 'Documents/PUB-ACP/browser-profile');
    this.screenshotDir = options.screenshotDir || path.resolve(process.cwd(), '.acp/screenshots');
    this.eventBus = options.eventBus;

    // Default allowlist: localhost, 127.0.0.1, standard local dev domains
    this.allowedDomains = (options.allowedDomains && options.allowedDomains.length > 0)
      ? options.allowedDomains.map(d => d.toLowerCase().trim())
      : ['localhost', '127.0.0.1', 'example.com'];
  }

  getCdpEndpoint(): string {
    return this.cdpEndpoint;
  }

  getProfileDir(): string {
    return this.profileDir;
  }

  getScreenshotDir(): string {
    return this.screenshotDir;
  }

  getCurrentPageState() {
    return { ...this.currentPageState };
  }

  /**
   * Validate that URL is well-formed, http/https, and permitted by allowlist.
   */
  validateUrl(rawUrl: string): { ok: boolean; parsed?: URL; domain?: string; error?: string; blockedReason?: string } {
    if (!rawUrl || typeof rawUrl !== 'string') {
      return { ok: false, error: 'URL must be a non-empty string', blockedReason: 'INVALID_URL' };
    }

    const trimmed = rawUrl.trim();
    if (!trimmed) {
      return { ok: false, error: 'URL cannot be blank', blockedReason: 'INVALID_URL' };
    }

    // Explicitly block file://, javascript:, data:
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('file:') || lower.startsWith('file://')) {
      return { ok: false, error: 'Access to file:// is strictly blocked by browser policy', blockedReason: 'FILESYSTEM_ACCESS_BLOCKED' };
    }
    if (lower.startsWith('javascript:')) {
      return { ok: false, error: 'Execution of javascript: URLs is strictly blocked', blockedReason: 'JAVASCRIPT_URL_BLOCKED' };
    }
    if (lower.startsWith('data:')) {
      return { ok: false, error: 'Data URLs are not permitted', blockedReason: 'DATA_URL_BLOCKED' };
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { ok: false, error: `Invalid URL format: "${trimmed}"`, blockedReason: 'INVALID_URL' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: `Unsupported protocol "${parsed.protocol}". Only http: and https: are allowed`, blockedReason: 'UNSUPPORTED_PROTOCOL' };
    }

    const domain = parsed.hostname.toLowerCase();

    // Check allowlist
    const isAllowed = this.allowedDomains.some(allowed => {
      if (allowed === '*' || allowed === domain) return true;
      if (allowed.startsWith('*.') && domain.endsWith(allowed.slice(1))) return true;
      return false;
    });

    if (!isAllowed) {
      return {
        ok: false,
        domain,
        error: `Domain "${domain}" is not in the configured browser operator allowlist: [${this.allowedDomains.join(', ')}]`,
        blockedReason: 'DOMAIN_NOT_ALLOWED'
      };
    }

    return { ok: true, parsed, domain };
  }

  /**
   * 1. browser.status
   */
  async getStatus(): Promise<BrowserStatusResult> {
    try {
      const res = await fetch(`${this.cdpEndpoint}/json/version`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data: any = await res.json();
        return {
          status: 'CONNECTED',
          cdpEndpoint: this.cdpEndpoint,
          profileDir: this.profileDir,
          browser: data.Browser || 'Chrome',
          protocolVersion: data['Protocol-Version'],
          connected: true
        };
      }
    } catch {
      // Disconnected
    }

    return {
      status: 'DISCONNECTED',
      cdpEndpoint: this.cdpEndpoint,
      profileDir: this.profileDir,
      browser: 'Chrome (offline)',
      connected: false
    };
  }

  /**
   * Find or create active controlled target page in Chrome.
   */
  private async getControlledTarget(): Promise<{ id: string; url: string; webSocketDebuggerUrl: string }> {
    const listRes = await fetch(`${this.cdpEndpoint}/json/list`, { signal: AbortSignal.timeout(3000) });
    if (!listRes.ok) {
      throw new Error(`Failed to query CDP targets: HTTP ${listRes.status}`);
    }
    const targets: any[] = await listRes.json();

    // Find existing page target (skip background / omnibox / browser_ui)
    let pageTarget = targets.find(t => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string');

    if (!pageTarget) {
      // Create a new tab
      const createRes = await fetch(`${this.cdpEndpoint}/json/new?about:blank`, {
        method: 'PUT',
        signal: AbortSignal.timeout(3000)
      });
      if (!createRes.ok) {
        throw new Error(`Failed to create new CDP target page: HTTP ${createRes.status}`);
      }
      pageTarget = await createRes.json();
    }

    return {
      id: pageTarget.id,
      url: pageTarget.url || 'about:blank',
      webSocketDebuggerUrl: pageTarget.webSocketDebuggerUrl
    };
  }

  /**
   * Send single or multiple CDP commands over WebSocket and wait for result.
   */
  private async executeCdpCommand(
    wsUrl: string,
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 15000
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        return reject(err);
      }

      const reqId = Math.floor(Math.random() * 1000000);
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error(`CDP command "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      ws.onopen = () => {
        ws.send(JSON.stringify({ id: reqId, method, params }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.id === reqId) {
            clearTimeout(timer);
            try { ws.close(); } catch {}
            if (msg.error) {
              reject(new Error(`CDP error in "${method}": ${msg.error.message}`));
            } else {
              resolve(msg.result);
            }
          }
        } catch (parseErr) {
          // ignore parsing non-target messages
        }
      };

      ws.onerror = (err: any) => {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        reject(new Error(`WebSocket connection error: ${err.message || 'connection failed'}`));
      };
    });
  }

  /**
   * 2. browser.navigate
   */
  async navigate(
    rawUrl: string,
    context: { runId?: string; turn?: number; provider?: string } = {}
  ): Promise<BrowserNavigateResult> {
    const start = Date.now();
    const runId = context.runId || `browser-${randomUUID()}`;

    // Validate URL against policy
    const val = this.validateUrl(rawUrl);
    if (!val.ok || !val.domain || !val.parsed) {
      const durationMs = Date.now() - start;
      const result: BrowserNavigateResult = {
        status: 'BLOCKED',
        url: rawUrl,
        domain: val.domain || 'unknown',
        error: val.error,
        blockedReason: val.blockedReason,
        durationMs
      };

      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId,
        turn: context.turn,
        timestamp: new Date().toISOString(),
        type: 'BROWSER_BLOCKED',
        summary: `Browser navigation blocked: ${val.error}`,
        details: {
          url: rawUrl,
          domain: val.domain,
          blockedReason: val.blockedReason,
          capability: 'browser.navigate',
          policyDecision: 'BLOCK',
          provider: context.provider || 'gpt'
        }
      });

      return result;
    }

    const sanitizedUrl = val.parsed.origin + val.parsed.pathname + (val.parsed.search ? '?...' : '');
    const domain = val.domain;

    this.emitEvent({
      id: `evt-${randomUUID()}`,
      runId,
      turn: context.turn,
      timestamp: new Date().toISOString(),
      type: 'BROWSER_NAVIGATION_STARTED',
      summary: `Navigating browser to: ${sanitizedUrl}`,
      details: {
        url: sanitizedUrl,
        domain,
        capability: 'browser.navigate',
        policyDecision: 'ALLOW',
        provider: context.provider || 'gpt'
      }
    });

    try {
      const target = await this.getControlledTarget();
      await this.executeCdpCommand(target.webSocketDebuggerUrl, 'Page.enable', {});
      await this.executeCdpCommand(target.webSocketDebuggerUrl, 'Page.navigate', { url: val.parsed.href });

      // Small settling delay for navigation
      await new Promise(r => setTimeout(r, 1200));

      // Fetch page title and current URL
      const titleRes = await this.executeCdpCommand(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: 'document.title',
        returnByValue: true
      });
      const title = (titleRes?.result?.value as string) || '';

      const durationMs = Date.now() - start;

      // Update state
      this.currentPageState = {
        url: sanitizedUrl,
        domain,
        title,
        lastNav: new Date().toISOString(),
        lastScreenshot: this.currentPageState.lastScreenshot
      };

      const navResult: BrowserNavigateResult = {
        status: 'SUCCESS',
        url: sanitizedUrl,
        domain,
        title,
        durationMs
      };

      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId,
        turn: context.turn,
        timestamp: new Date().toISOString(),
        type: 'BROWSER_NAVIGATION_FINISHED',
        summary: `Navigated to ${sanitizedUrl} (${title}) in ${durationMs}ms`,
        details: {
          url: sanitizedUrl,
          domain,
          title,
          durationMs,
          status: 'SUCCESS',
          capability: 'browser.navigate',
          policyDecision: 'ALLOW',
          provider: context.provider || 'gpt'
        }
      });

      return navResult;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const navResult: BrowserNavigateResult = {
        status: 'FAILED',
        url: sanitizedUrl,
        domain,
        error: err.message,
        durationMs
      };

      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId,
        turn: context.turn,
        timestamp: new Date().toISOString(),
        type: 'BROWSER_ERROR',
        summary: `Browser navigation failed: ${err.message}`,
        details: {
          url: sanitizedUrl,
          domain,
          durationMs,
          error: err.message,
          capability: 'browser.navigate',
          provider: context.provider || 'gpt'
        }
      });

      return navResult;
    }
  }

  /**
   * 3. browser.read
   * Read sanitized visible text, title, url, links. Never collects cookies, storage, tokens.
   */
  async read(
    context: { runId?: string; turn?: number; provider?: string } = {}
  ): Promise<BrowserReadResult> {
    const start = Date.now();
    const runId = context.runId || `browser-${randomUUID()}`;

    try {
      const target = await this.getControlledTarget();

      // Read sanitized DOM data via safe script that strips sensitive inputs
      const extractionScript = `(() => {
        const title = document.title || '';
        const url = window.location.href;
        
        // Clone body and remove password fields, scripts, styles, iframes
        const clone = document.body ? document.body.cloneNode(true) : null;
        if (clone) {
          clone.querySelectorAll('input[type="password"], input[name*="pass" i], input[name*="token" i], script, style, noscript, iframe').forEach(el => el.remove());
        }
        
        const rawText = clone ? (clone.innerText || clone.textContent || '') : '';
        const cleanText = rawText.replace(/\\s+/g, ' ').trim().slice(0, 4000);
        
        const links = [];
        document.querySelectorAll('a[href]').forEach(a => {
          if (links.length < 25) {
            const href = a.getAttribute('href') || '';
            const text = (a.innerText || a.textContent || '').trim();
            if (href && !href.startsWith('javascript:')) {
              links.push({ text: text.slice(0, 60), href: href.slice(0, 150) });
            }
          }
        });

        return { title, url, text: cleanText, links };
      })()`;

      const evalRes = await this.executeCdpCommand(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: extractionScript,
        returnByValue: true
      });

      const data = evalRes?.result?.value || {};
      const rawUrl = data.url || this.currentPageState.url || 'about:blank';
      let domain = 'localhost';
      let sanitizedUrl = rawUrl;
      try {
        const u = new URL(rawUrl);
        domain = u.hostname.toLowerCase();
        sanitizedUrl = u.origin + u.pathname;
      } catch {}

      const durationMs = Date.now() - start;

      // Update current page state
      this.currentPageState = {
        url: sanitizedUrl,
        domain,
        title: data.title || '',
        lastNav: this.currentPageState.lastNav,
        lastScreenshot: this.currentPageState.lastScreenshot
      };

      const readResult: BrowserReadResult = {
        status: 'SUCCESS',
        url: sanitizedUrl,
        domain,
        title: data.title || '',
        text: data.text || '',
        links: Array.isArray(data.links) ? data.links : [],
        durationMs
      };

      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId,
        turn: context.turn,
        timestamp: new Date().toISOString(),
        type: 'BROWSER_READ',
        summary: `Read page "${readResult.title}" (${readResult.domain}) [${readResult.text.length} chars, ${readResult.links.length} links]`,
        details: {
          url: sanitizedUrl,
          domain,
          title: readResult.title,
          textSnippet: readResult.text.slice(0, 300),
          linkCount: readResult.links.length,
          durationMs,
          status: 'SUCCESS',
          capability: 'browser.read',
          policyDecision: 'ALLOW',
          provider: context.provider || 'gpt'
        }
      });

      return readResult;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const readResult: BrowserReadResult = {
        status: 'FAILED',
        url: this.currentPageState.url,
        domain: this.currentPageState.domain,
        title: '',
        text: '',
        links: [],
        error: err.message,
        durationMs
      };

      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId,
        turn: context.turn,
        timestamp: new Date().toISOString(),
        type: 'BROWSER_ERROR',
        summary: `Browser read failed: ${err.message}`,
        details: {
          error: err.message,
          capability: 'browser.read',
          durationMs,
          provider: context.provider || 'gpt'
        }
      });

      return readResult;
    }
  }

  /**
   * 4. browser.screenshot
   * Saves PNG to controlled screenshot directory, returns file reference.
   */
  async screenshot(
    context: { runId?: string; turn?: number; provider?: string } = {}
  ): Promise<BrowserScreenshotResult> {
    const start = Date.now();
    const runId = context.runId || `browser-${randomUUID()}`;

    try {
      const target = await this.getControlledTarget();
      const shotRes = await this.executeCdpCommand(target.webSocketDebuggerUrl, 'Page.captureScreenshot', {
        format: 'png',
        quality: 80
      });

      if (!shotRes?.data) {
        throw new Error('CDP Page.captureScreenshot returned empty data');
      }

      // Ensure controlled directory exists
      if (!fs.existsSync(this.screenshotDir)) {
        fs.mkdirSync(this.screenshotDir, { recursive: true });
      }

      const filename = `shot-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
      const filePath = path.join(this.screenshotDir, filename);

      const buffer = Buffer.from(shotRes.data, 'base64');
      fs.writeFileSync(filePath, buffer);

      const durationMs = Date.now() - start;

      this.currentPageState.lastScreenshot = filename;

      const screenshotResult: BrowserScreenshotResult = {
        status: 'SUCCESS',
        path: filePath,
        filename,
        bytes: buffer.length,
        url: this.currentPageState.url,
        domain: this.currentPageState.domain,
        durationMs
      };

      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId,
        turn: context.turn,
        timestamp: new Date().toISOString(),
        type: 'BROWSER_SCREENSHOT',
        summary: `Captured screenshot "${filename}" (${buffer.length} bytes)`,
        details: {
          path: filePath,
          filename,
          bytes: buffer.length,
          url: this.currentPageState.url,
          domain: this.currentPageState.domain,
          durationMs,
          status: 'SUCCESS',
          capability: 'browser.screenshot',
          policyDecision: 'ALLOW',
          provider: context.provider || 'gpt'
        }
      });

      return screenshotResult;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const screenshotResult: BrowserScreenshotResult = {
        status: 'FAILED',
        url: this.currentPageState.url,
        domain: this.currentPageState.domain,
        error: err.message,
        durationMs
      };

      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId,
        turn: context.turn,
        timestamp: new Date().toISOString(),
        type: 'BROWSER_ERROR',
        summary: `Browser screenshot failed: ${err.message}`,
        details: {
          error: err.message,
          capability: 'browser.screenshot',
          durationMs,
          provider: context.provider || 'gpt'
        }
      });

      return screenshotResult;
    }
  }

  private emitEvent(event: any): void {
    if (this.eventBus) {
      try {
        this.eventBus.publish(event);
      } catch {}
    }
  }
}
