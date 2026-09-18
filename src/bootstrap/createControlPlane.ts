import path from 'node:path';
import { EventBus, IEventBus } from '../observability/EventBus.js';
import { MemoryRunStore, IRunStore } from '../observability/RunStore.js';
import { AntigravitySessionStore } from '../antigravity/AntigravitySessionStore.js';
import { IAntigravitySessionStore } from '../antigravity/types.js';
import { MemoryWorkspaceLock, IWorkspaceLock } from '../multiproject/WorkspaceLock.js';
import { MemoryProjectContextStore } from '../context/MemoryProjectContextStore.js';
import { IProjectContextStore } from '../context/types.js';
import { ProjectRegistry, IProjectRegistry } from '../multiproject/ProjectRegistry.js';
import { WorkspaceResolver, GitInspector, DefaultGitInspector } from '../multiproject/WorkspaceResolver.js';
import { SafetyGate } from '../multiproject/SafetyGate.js';
import { ClosedLoopEngine } from '../bridge/ClosedLoopEngine.js';
import { ProjectDispatcher, IProjectDispatcher } from '../multiproject/ProjectDispatcher.js';
import { ExecutionContext, ProjectDefinition } from '../multiproject/types.js';

import { ProjectCatalogLoader } from '../catalog/ProjectCatalogLoader.js';
import { IProjectCatalog } from '../catalog/types.js';
import { FileProjectCatalog } from '../catalog/FileProjectCatalog.js';
import { BrowserOperator } from '../browser/BrowserOperator.js';

export interface ControlPlaneOptions {
  cwd?: string;
  gitInspector?: GitInspector;
  eventBus?: IEventBus;
  runStore?: IRunStore;
  sessionStore?: IAntigravitySessionStore;
  workspaceLock?: IWorkspaceLock;
  contextStore?: IProjectContextStore;
  projectRegistry?: IProjectRegistry;
  projectCatalog?: IProjectCatalog;
  resolver?: WorkspaceResolver;
  safetyGate?: SafetyGate;
  engineFactory?: (context: ExecutionContext) => ClosedLoopEngine;
  browserOperator?: BrowserOperator;
}

export interface ControlPlane {
  eventBus: IEventBus;
  runStore: IRunStore;
  sessionStore: IAntigravitySessionStore;
  workspaceLock: IWorkspaceLock;
  contextStore: IProjectContextStore;
  projectRegistry: IProjectRegistry;
  projectCatalog?: IProjectCatalog;
  resolver: WorkspaceResolver;
  safetyGate: SafetyGate;
  dispatcher: IProjectDispatcher;
  currentProject?: ProjectDefinition;
  browserOperator: BrowserOperator;
}

/**
 * Canonical composition root for the PUB ACP Control Plane.
 * Resolves the sovereign workspace from Git if available, registers it idempotently,
 * and sets up the full orchestration pipeline.
 */
export async function createControlPlane(options: ControlPlaneOptions = {}): Promise<ControlPlane> {
  const cwd = options.cwd ? path.resolve(options.cwd) : path.resolve(process.cwd());
  const gitInspector = options.gitInspector || new DefaultGitInspector();

  // 1. Storage & Observability
  const eventBus = options.eventBus || new EventBus();
  const runStore = options.runStore || new MemoryRunStore();
  const sessionStore = options.sessionStore || new AntigravitySessionStore();
  const workspaceLock = options.workspaceLock || new MemoryWorkspaceLock();
  const contextStore = options.contextStore || new MemoryProjectContextStore();
  const browserOperator = options.browserOperator || new BrowserOperator({ eventBus });

  // 2. Multiproject Registry
  const projectRegistry = options.projectRegistry || new ProjectRegistry();

  // 3. Workspace Resolver & Safety Gate
  const resolver = options.resolver || new WorkspaceResolver(projectRegistry, gitInspector);
  const safetyGate = options.safetyGate || new SafetyGate();

  // 4. Load & register authorized projects from ProjectCatalog (if provided or discoverable)
  const projectCatalog = options.projectCatalog !== undefined ? options.projectCatalog : new FileProjectCatalog();
  if (projectCatalog) {
    const catalogLoader = new ProjectCatalogLoader(projectCatalog, resolver, projectRegistry);
    await catalogLoader.loadAndRegister();
  }

  // 5. Discover current workspace from Git for context/focus
  let currentProject: ProjectDefinition | undefined;
  const resolution = resolver.resolveWorkspace(cwd);

  if (resolution.ok && resolution.context) {
    const ctx = resolution.context;
    const normalizedId = ctx.projectId.toLowerCase();

    const isCatalogActive = Boolean(
      projectCatalog &&
      (typeof (projectCatalog as any).getCatalogPath === 'function' ? (projectCatalog as any).getCatalogPath() : true)
    );

    if (projectRegistry.hasProject(normalizedId)) {
      // Re-use authorized project definition from registry
      currentProject = projectRegistry.getProject(normalizedId);
    } else if (!isCatalogActive) {
      // Compatibility fallback ONLY when NO catalog file is configured or active
      currentProject = {
        projectId: ctx.projectId,
        projectName: ctx.projectName,
        workspacePath: path.resolve(ctx.workspacePath),
        repository: ctx.repository,
        defaultBranch: ctx.branch,
        enabled: true,
        validationPolicy: ctx.validationPolicy
      };
      projectRegistry.registerProject(currentProject);
    } else {
      // When catalog file is active, uncataloged CWD does NOT get registered or authorized
      currentProject = undefined;
    }
  }

  // 5. Canonical Engine Factory (connecting ClosedLoopEngine with shared EventBus and BrowserOperator)
  const engineFactory = options.engineFactory || ((context: ExecutionContext) => {
    const isDirect = (context.executorMode || 'gpt-direct') === 'gpt-direct';
    const launcherPath = path.resolve(process.cwd(), 'bin', 'mac_sandbox_launcher');
    const hasMacLauncher = process.platform === 'darwin' && path.isAbsolute(launcherPath);

    return new ClosedLoopEngine(undefined, undefined, {
      cwd: context.workspacePath,
      executionContext: context,
      executorProvider: isDirect ? 'gpt' : 'antigravity',
      actionPolicy: {
        capabilities: {
          'workspace.read': true,
          'workspace.write': true,
          'workspace.delete': true,
          'workspace.list': true,
          'git.read': true,
          'git.mutate': false,
          'npm.test': true,
          'npm.build': true,
          'npm.run': true,
          'process.exec': true,
          'browser.status': true,
          'browser.navigate': true,
          'browser.read': true,
          'browser.screenshot': true
        },
        sandboxProvider: hasMacLauncher ? 'macos-sandbox' : 'node-permission',
        allowedExecutables: ['git', 'echo', 'npm', 'node'],
        disallowShellOperators: true,
        disallowExternalPathArgs: true,
        execTimeoutMs: 60000
      },
      eventBus,
      browserOperator
    });
  });

  // 6. Project Dispatcher
  const dispatcher = new ProjectDispatcher(
    projectRegistry,
    contextStore,
    resolver,
    safetyGate,
    engineFactory,
    eventBus,
    sessionStore,
    workspaceLock
  );

  return {
    eventBus,
    runStore,
    sessionStore,
    workspaceLock,
    contextStore,
    projectRegistry,
    projectCatalog,
    resolver,
    safetyGate,
    dispatcher,
    currentProject,
    browserOperator
  };
}
