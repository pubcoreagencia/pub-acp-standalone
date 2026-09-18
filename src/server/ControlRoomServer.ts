import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { IEventBus, EventBus } from '../observability/EventBus.js';
import { IRunStore, MemoryRunStore } from '../observability/RunStore.js';
import { DemoFeedGenerator } from '../observability/DemoFeed.js';
import { wireEventBusToRunStore } from '../observability/wireEventBus.js';
import { sanitizeObject } from '../observability/sanitizer.js';
import { IProjectRegistry, ProjectRegistry } from '../multiproject/ProjectRegistry.js';
import { IAntigravitySessionStore } from '../antigravity/types.js';
import { AntigravitySessionStore } from '../antigravity/AntigravitySessionStore.js';
import { IProjectDispatcher } from '../multiproject/ProjectDispatcher.js';
import { BrowserOperator } from '../browser/BrowserOperator.js';
import { AuthorizationEngine } from '../tools/AuthorizationEngine.js';

export interface ControlRoomServerOptions {
  port?: number;
  host?: string;
  publicDir?: string;
  eventBus?: IEventBus;
  runStore?: IRunStore;
  projectRegistry?: IProjectRegistry;
  sessionStore?: IAntigravitySessionStore;
  dispatcher?: IProjectDispatcher;
  browserOperator?: BrowserOperator;
  authorizationEngine?: AuthorizationEngine;
}

export class ControlRoomServer {
  private readonly port: number;
  private readonly host: string;
  private readonly publicDir: string;
  private readonly eventBus: IEventBus;
  private readonly runStore: IRunStore;
  private readonly projectRegistry: IProjectRegistry;
  private readonly sessionStore: IAntigravitySessionStore;
  private readonly dispatcher?: IProjectDispatcher;
  private readonly browserOperator: BrowserOperator;
  private readonly authorizationEngine: AuthorizationEngine;
  private readonly demoFeed: DemoFeedGenerator;
  private server?: Server;
  private readonly openSockets = new Set<import('node:net').Socket>();

  constructor(options: ControlRoomServerOptions = {}) {
    this.port = options.port !== undefined ? options.port : 5173;
    this.host = options.host || '127.0.0.1';
    this.publicDir = options.publicDir || join(process.cwd(), 'public');
    this.eventBus = options.eventBus || new EventBus();
    this.runStore = options.runStore || new MemoryRunStore();
    this.projectRegistry = options.projectRegistry || new ProjectRegistry();
    this.sessionStore = options.sessionStore || new AntigravitySessionStore();
    this.dispatcher = options.dispatcher;
    this.browserOperator = options.browserOperator || new BrowserOperator({ eventBus: this.eventBus });
    this.authorizationEngine = options.authorizationEngine || new AuthorizationEngine({
      capabilities: {
        'browser.status': true,
        'browser.navigate': true,
        'browser.read': true,
        'browser.screenshot': true
      }
    });

    wireEventBusToRunStore(this.eventBus, this.runStore);
    this.demoFeed = new DemoFeedGenerator(this.eventBus, this.runStore);
  }

  getEventBus(): IEventBus {
    return this.eventBus;
  }

  getRunStore(): IRunStore {
    return this.runStore;
  }

  getDemoFeed(): DemoFeedGenerator {
    return this.demoFeed;
  }

  async start(): Promise<{ port: number; host: string; url: string }> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch(err => {
          console.error('[ControlRoomServer] Unhandled request error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
          }
        });
      });

      this.server.on('connection', socket => {
        this.openSockets.add(socket);
        socket.on('close', () => this.openSockets.delete(socket));
      });

      this.server.on('error', reject);
      this.server.listen(this.port, this.host, () => {
        const addr = this.server?.address();
        const effectivePort = typeof addr === 'object' && addr ? addr.port : this.port;
        resolve({
          port: effectivePort,
          host: this.host,
          url: `http://${this.host}:${effectivePort}`
        });
      });
    });
  }

  async stop(): Promise<void> {
    this.demoFeed.stop();
    for (const socket of this.openSockets) {
      socket.destroy();
    }
    this.openSockets.clear();

    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close(err => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async readJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 1024 * 1024) { // 1MB limit
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        if (!body.trim()) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', err => reject(err));
    });
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    const sanitized = sanitizeObject(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(sanitized));
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase();

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    // API Routes
    if (pathname === '/api/runs' && method === 'GET') {
      const runs = this.runStore.getRuns();
      return this.sendJson(res, 200, runs);
    }

    // Dispatch Execution Route
    if (pathname === '/api/runs' && method === 'POST') {
      if (!this.dispatcher) {
        return this.sendJson(res, 501, {
          error: 'Dispatcher not configured on this ControlRoomServer instance.'
        });
      }

      let body: any;
      try {
        body = await this.readJsonBody(req);
      } catch (err: any) {
        return this.sendJson(res, 400, { error: `Malformed request payload: ${err.message}` });
      }

      // 1. Validate projectId
      if (!body.projectId || typeof body.projectId !== 'string' || !body.projectId.trim()) {
        return this.sendJson(res, 400, { error: "Field 'projectId' is required and must be a non-empty string." });
      }
      const rawProjectId = body.projectId.trim().toLowerCase();

      // Check project existence in sovereign registry
      const project = this.projectRegistry.getProject(rawProjectId);
      if (!project) {
        return this.sendJson(res, 404, { error: `Project '${rawProjectId}' not found in ProjectRegistry.` });
      }

      // 2. Validate instruction
      if (!body.instruction || typeof body.instruction !== 'string' || !body.instruction.trim()) {
        return this.sendJson(res, 400, { error: "Field 'instruction' is required and must be a non-empty string." });
      }
      const instruction = body.instruction.trim();

      // 3. Validate maxTurns (optional, must be integer between 1 and 20)
      let maxTurns = 3;
      if (body.maxTurns !== undefined && body.maxTurns !== null) {
        if (typeof body.maxTurns !== 'number' || !Number.isInteger(body.maxTurns) || body.maxTurns < 1 || body.maxTurns > 20) {
          return this.sendJson(res, 400, {
            error: "Field 'maxTurns', when provided, must be an integer between 1 and 20."
          });
        }
        maxTurns = body.maxTurns;
      }

      // 4. Validate conversationId (optional)
      let conversationId: string | undefined;
      if (body.conversationId !== undefined && body.conversationId !== null) {
        if (typeof body.conversationId !== 'string' || !body.conversationId.trim()) {
          return this.sendJson(res, 400, {
            error: "Field 'conversationId', when provided, must be a non-empty string."
          });
        }
        conversationId = body.conversationId.trim();
      }

      // 4.1 Validate executorMode (optional, default: 'gpt-direct', allowed: 'gpt-direct' | 'gpt-antigravity')
      let executorMode: 'gpt-direct' | 'gpt-antigravity' = 'gpt-direct';
      if (body.executorMode !== undefined && body.executorMode !== null) {
        if (body.executorMode !== 'gpt-direct' && body.executorMode !== 'gpt-antigravity') {
          return this.sendJson(res, 400, {
            error: "Invalid executorMode. Must be either 'gpt-direct' or 'gpt-antigravity'."
          });
        }
        executorMode = body.executorMode;
      }

      // 5. Create deterministic runId and register initial state in RunStore
      const { randomUUID } = await import('node:crypto');
      const runId = `run-${randomUUID()}`;

      // Emit RUN_CREATED immediately via EventBus so RunStore and SSE are ready before response
      this.eventBus.publish({
        id: `evt-${randomUUID()}`,
        runId,
        timestamp: new Date().toISOString(),
        type: 'RUN_CREATED',
        summary: `Execution request received from Control Room UI for project '${project.projectId}'.`,
        details: {
          runId,
          projectId: project.projectId,
          projectName: project.projectName,
          trigger: 'control-room-ui',
          actor: 'operator',
          conversationId,
          executorMode,
          provider: executorMode === 'gpt-direct' ? 'gpt' : 'antigravity'
        }
      });

      // 6. Launch dispatch asynchronously in the background (Non-blocking HTTP)
      this.dispatcher.dispatch({
        projectId: project.projectId,
        initialPrompt: instruction,
        runId,
        maxTurns,
        conversationId,
        executorMode,
        trigger: 'control-room-ui',
        actor: 'operator',
        skipRunCreated: true
      }).catch(err => {
        console.error(`[ControlRoomServer] Background dispatch error for run ${runId}:`, err);

        // Fallback: Ensure run does not remain stuck in non-terminal state on unexpected exception
        const currentRun = this.runStore.getRun(runId);
        const terminalStates = ['COMPLETED', 'FAILED', 'BLOCKED', 'STOPPED'];
        if (!currentRun || !terminalStates.includes(currentRun.status)) {
          this.eventBus.publish({
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'RUN_FAILED',
            summary: `Execution failed due to unexpected dispatch exception: ${err?.message || String(err)}`,
            details: {
              runId,
              projectId: project.projectId,
              error: err?.message || String(err),
              stack: err?.stack
            }
          });
        }
      });

      // 7. Return 202 Accepted immediately
      return this.sendJson(res, 202, {
        runId,
        status: 'STARTING',
        projectId: project.projectId,
        message: 'Execution run initiated'
      });
    }

    // Projects Discovery Route (Safe, without internal filesystem paths)
    if (pathname === '/api/projects' && method === 'GET') {
      const projects = this.projectRegistry.listProjects().map(p => ({
        projectId: p.projectId,
        projectName: p.projectName,
        repository: p.repository,
        defaultBranch: p.defaultBranch,
        enabled: p.enabled
      }));
      return this.sendJson(res, 200, projects);
    }

    const runMatch = pathname.match(/^\/api\/runs\/([^\/]+)$/);
    if (runMatch && method === 'GET') {
      const runId = runMatch[1];
      const run = this.runStore.getRun(runId);
      if (!run) {
        return this.sendJson(res, 404, { error: `Run ${runId} not found` });
      }
      return this.sendJson(res, 200, run);
    }

    const eventsMatch = pathname.match(/^\/api\/runs\/([^\/]+)\/events$/);
    if (eventsMatch && method === 'GET') {
      const runId = eventsMatch[1];
      const run = this.runStore.getRun(runId);
      if (!run) {
        return this.sendJson(res, 404, { error: `Run ${runId} not found` });
      }
      return this.sendJson(res, 200, run.events);
    }

    // SSE Stream Route
    const streamMatch = pathname.match(/^\/api\/runs\/([^\/]+)\/stream$/);
    if (streamMatch && method === 'GET') {
      const runId = streamMatch[1];
      return this.handleSseStream(runId, req, res);
    }

    // Trigger Demo Run
    if (pathname === '/api/demo/start' && method === 'POST') {
      const runId = this.demoFeed.generateDemoRun();
      return this.sendJson(res, 201, { message: 'Demo run initiated', runId });
    }

    // Browser CDP Status Route
    if (pathname === '/api/browser/status' && method === 'GET') {
      const auth = this.authorizationEngine.evaluate('browser.status');
      if (!auth.allowed) {
        return this.sendJson(res, 403, {
          error: auth.reason || 'Capability browser.status is denied',
          blockedReason: auth.blockedReason || 'CAPABILITY_POLICY_DENIED'
        });
      }

      const status = await this.browserOperator.getStatus();
      return this.sendJson(res, 200, {
        status: status.status,
        cdpEndpoint: status.cdpEndpoint,
        profileDir: status.profileDir,
        browser: status.browser,
        connected: status.connected
      });
    }

    // POST /api/browser/navigate
    if (pathname === '/api/browser/navigate' && method === 'POST') {
      const auth = this.authorizationEngine.evaluate('browser.navigate');
      if (!auth.allowed) {
        return this.sendJson(res, 403, {
          error: auth.reason || 'Capability browser.navigate is denied',
          blockedReason: auth.blockedReason || 'CAPABILITY_POLICY_DENIED'
        });
      }

      let body: any;
      try {
        body = await this.readJsonBody(req);
      } catch (err: any) {
        return this.sendJson(res, 400, { error: `Malformed request payload: ${err.message}` });
      }

      if (!body.url || typeof body.url !== 'string' || !body.url.trim()) {
        return this.sendJson(res, 400, { error: 'Field "url" must be a non-empty string' });
      }

      const result = await this.browserOperator.navigate(body.url);
      if (result.status === 'BLOCKED') {
        return this.sendJson(res, 403, result);
      }
      if (result.status === 'FAILED') {
        return this.sendJson(res, 500, result);
      }
      return this.sendJson(res, 200, result);
    }

    // GET /api/browser/page
    if (pathname === '/api/browser/page' && method === 'GET') {
      const auth = this.authorizationEngine.evaluate('browser.read');
      if (!auth.allowed) {
        return this.sendJson(res, 403, {
          error: auth.reason || 'Capability browser.read is denied',
          blockedReason: auth.blockedReason || 'CAPABILITY_POLICY_DENIED'
        });
      }

      const pageState = this.browserOperator.getCurrentPageState();
      const readResult = await this.browserOperator.read();
      return this.sendJson(res, 200, {
        url: readResult.url,
        domain: readResult.domain,
        title: readResult.title,
        text: readResult.text,
        links: readResult.links,
        lastNav: pageState.lastNav,
        lastScreenshot: pageState.lastScreenshot
      });
    }

    // POST /api/browser/screenshot
    if (pathname === '/api/browser/screenshot' && method === 'POST') {
      const auth = this.authorizationEngine.evaluate('browser.screenshot');
      if (!auth.allowed) {
        return this.sendJson(res, 403, {
          error: auth.reason || 'Capability browser.screenshot is denied',
          blockedReason: auth.blockedReason || 'CAPABILITY_POLICY_DENIED'
        });
      }

      const result = await this.browserOperator.screenshot();
      if (result.status === 'FAILED') {
        return this.sendJson(res, 500, result);
      }
      return this.sendJson(res, 200, result);
    }

    // Project Conversations Discovery Route
    const projConversationsMatch = pathname.match(/^\/api\/projects\/([^\/]+)\/conversations$/);
    if (projConversationsMatch && method === 'GET') {
      const rawProjectId = decodeURIComponent(projConversationsMatch[1]);
      const project = this.projectRegistry.getProject(rawProjectId);

      if (!project) {
        return this.sendJson(res, 404, { error: `Project '${rawProjectId}' not found in registry.` });
      }

      try {
        const conversations = await this.sessionStore.listConversationsForWorkspace(project.workspacePath);
        return this.sendJson(res, 200, {
          projectId: project.projectId,
          conversations
        });
      } catch (err: any) {
        console.error(`[ControlRoomServer] Failed to list conversations for project '${project.projectId}':`, err.message);
        return this.sendJson(res, 500, {
          error: `Failed to query conversations from Antigravity session storage: ${err.message}`
        });
      }
    }

    // Static Assets
    if (method === 'GET') {
      let filePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
      const fullPath = join(this.publicDir, filePath);
      const ext = extname(fullPath).toLowerCase();

      const mimeTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png'
      };

      try {
        const content = await readFile(fullPath);
        res.writeHead(200, {
          'Content-Type': mimeTypes[ext] || 'text/plain',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(content);
        return;
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
    }

    this.sendJson(res, 404, { error: 'Endpoint not found' });
  }

  private handleSseStream(runId: string, req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    res.write('retry: 3000\n\n');

    // 1. Replay existing events for this run
    const existingRun = this.runStore.getRun(runId);
    if (existingRun && existingRun.events.length > 0) {
      for (const event of existingRun.events) {
        const sanitized = sanitizeObject(event);
        res.write(`data: ${JSON.stringify(sanitized)}\n\n`);
      }
    }

    // 2. Subscribe to new events
    const unsubscribe = this.eventBus.subscribe(runId, event => {
      const sanitized = sanitizeObject(event);
      res.write(`data: ${JSON.stringify(sanitized)}\n\n`);
    });

    // Heartbeat to keep connection active
    const heartbeatTimer = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeatTimer);
      unsubscribe();
    });
  }
}
