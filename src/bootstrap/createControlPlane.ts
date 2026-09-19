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
import { ProjectValidator } from '../validation/ProjectValidator.js';
import { IProjectValidator } from '../validation/types.js';
import { GptRuntimeAdapter } from '../runtime/gpt/GptRuntimeAdapter.js';
import { IAgentRuntime } from '../runtime/IAgentRuntime.js';

import { ProjectCatalogLoader } from '../catalog/ProjectCatalogLoader.js';
import { IProjectCatalog } from '../catalog/types.js';
import { FileProjectCatalog } from '../catalog/FileProjectCatalog.js';

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
  validator?: IProjectValidator;
  runtime?: IAgentRuntime;
  engineFactory?: (context: ExecutionContext) => ClosedLoopEngine;
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
  validator: IProjectValidator;
  runtime: IAgentRuntime;
  dispatcher: IProjectDispatcher;
  currentProject?: ProjectDefinition;
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

  // 2. Multiproject Registry
  const projectRegistry = options.projectRegistry || new ProjectRegistry();

  // 3. Workspace Resolver & Safety Gate
  const resolver = options.resolver || new WorkspaceResolver(projectRegistry, gitInspector);
  const safetyGate = options.safetyGate || new SafetyGate();
  const validator = options.validator || new ProjectValidator();
  const runtime = options.runtime || new GptRuntimeAdapter();

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

    if (projectRegistry.hasProject(normalizedId)) {
      // Re-use authorized project definition from registry
      currentProject = projectRegistry.getProject(normalizedId);
    } else if (!projectCatalog) {
      // Compatibility fallback ONLY when NO catalog is configured or active
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
      // When catalog is active, uncataloged CWD does NOT get registered or authorized
      currentProject = undefined;
    }
  }

  // 5. Canonical Engine Factory (connecting ClosedLoopEngine with shared EventBus)
  const engineFactory = options.engineFactory || ((context: ExecutionContext) =>
    new ClosedLoopEngine(undefined, runtime, {
      cwd: context.workspacePath,
      executionContext: context,
      eventBus,
      validator
    })
  );

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
    validator,
    runtime,
    dispatcher,
    currentProject
  };
}
