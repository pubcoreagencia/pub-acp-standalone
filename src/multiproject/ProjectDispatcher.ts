import { randomUUID } from 'node:crypto';
import { IProjectRegistry } from './ProjectRegistry.js';
import { WorkspaceResolver } from './WorkspaceResolver.js';
import { SafetyGate } from './SafetyGate.js';
import { ClosedLoopEngine } from '../bridge/ClosedLoopEngine.js';
import { ClosedLoopRunReport } from '../bridge/types.js';
import { IEventBus } from '../observability/EventBus.js';
import { AutonomyEvent } from '../observability/types.js';
import { ExecutionContext, SafetyBlockReason } from './types.js';
import { IProjectContextStore, MinimalProjectContext } from '../context/types.js';
import { ProjectContextError, ProjectContextErrorCode } from '../context/errors.js';

export interface DispatchRequest {
  projectId: string;
  initialPrompt: string;
  runId?: string;
  taskId?: string;
  targetBranch?: string;
  trigger?: string;
  actor?: string;
  maxTurns?: number;
}

export interface DispatchResult {
  ok: boolean;
  runId: string;
  context?: ExecutionContext;
  safetyBlocked?: boolean;
  blockedReason?: SafetyBlockReason;
  blockedMessage?: string;
  projectContextBlocked?: boolean;
  projectContextErrorCode?: ProjectContextErrorCode;
  projectContextErrorMessage?: string;
  projectContext?: MinimalProjectContext;
  report?: ClosedLoopRunReport;
}

export class ProjectDispatcher {
  constructor(
    private readonly registry: IProjectRegistry,
    private readonly projectContextStore: IProjectContextStore,
    private readonly resolver: WorkspaceResolver,
    private readonly safetyGate: SafetyGate,
    private readonly engineFactory: (context: ExecutionContext) => ClosedLoopEngine,
    private readonly eventBus?: IEventBus
  ) {}

  private emitEvent(event: AutonomyEvent): void {
    if (this.eventBus) {
      try {
        this.eventBus.publish(event);
      } catch (err) {
        console.error('[ProjectDispatcher] Failed to publish event:', err);
      }
    }
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const runId = request.runId || `run-${randomUUID()}`;
    const taskId = request.taskId || `task-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    // 1. RUN_CREATED
    this.emitEvent({
      id: `evt-${randomUUID()}`,
      runId,
      timestamp: now,
      type: 'RUN_CREATED',
      summary: `Execution request created for project '${request.projectId}' (task: ${taskId}).`,
      details: {
        runId,
        taskId,
        projectId: request.projectId,
        trigger: request.trigger || 'manual',
        actor: request.actor || 'system'
      }
    });

    // 2. PROJECT RESOLUTION
    this.emitEvent({
      id: `evt-${randomUUID()}`,
      runId,
      timestamp: new Date().toISOString(),
      type: 'PROJECT_RESOLUTION_STARTED',
      summary: `Resolving project '${request.projectId}' in ProjectRegistry.`,
      details: { runId, projectId: request.projectId }
    });

    const project = this.registry.getProject(request.projectId);
    if (!project) {
      const msg = `Unknown project '${request.projectId}'.`;
      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId,
        timestamp: new Date().toISOString(),
        type: 'SAFETY_GATE_BLOCKED',
        summary: `Execution blocked: ${msg}`,
        details: { runId, reason: 'UNKNOWN_PROJECT', message: msg }
      });
      return {
        ok: false,
        runId,
        safetyBlocked: true,
        blockedReason: 'UNKNOWN_PROJECT',
        blockedMessage: msg
      };
    }

    this.emitEvent({
      id: `evt-${randomUUID()}`,
      runId,
      timestamp: new Date().toISOString(),
      type: 'PROJECT_RESOLVED',
      summary: `Project '${project.projectId}' resolved (${project.projectName}).`,
      details: {
        runId,
        projectId: project.projectId,
        projectName: project.projectName,
        expectedRepo: project.repository
      }
    });

    // 2.1 PROJECT CONTEXT EVALUATION (Operational state gate before workspace resolution)
    let projectContext: MinimalProjectContext;
    try {
      const existingContext = await this.projectContextStore.getContext(request.projectId);
      if (!existingContext) {
        // UNINITIALIZED: create initial context (ACTIVE, version 1)
        projectContext = await this.projectContextStore.createInitialContext(request.projectId);
      } else {
        projectContext = existingContext;
      }
    } catch (err: any) {
      if (err instanceof ProjectContextError) {
        return {
          ok: false,
          runId,
          projectContextBlocked: true,
          projectContextErrorCode: err.code,
          projectContextErrorMessage: err.message
        };
      }
      throw err;
    }

    if (projectContext.status === 'PAUSED') {
      const pausedErr = new ProjectContextError(
        'PROJECT_CONTEXT_PAUSED',
        `Project '${request.projectId}' is PAUSED. Autonomous execution is blocked.`,
        request.projectId
      );
      return {
        ok: false,
        runId,
        projectContextBlocked: true,
        projectContextErrorCode: pausedErr.code,
        projectContextErrorMessage: pausedErr.message,
        projectContext
      };
    }

    if (projectContext.status === 'ARCHIVED') {
      const archivedErr = new ProjectContextError(
        'PROJECT_CONTEXT_ARCHIVED',
        `Project '${request.projectId}' is ARCHIVED. Autonomous execution is blocked.`,
        request.projectId
      );
      return {
        ok: false,
        runId,
        projectContextBlocked: true,
        projectContextErrorCode: archivedErr.code,
        projectContextErrorMessage: archivedErr.message,
        projectContext
      };
    }

    // 3. WORKSPACE RESOLUTION & VALIDATION
    this.emitEvent({
      id: `evt-${randomUUID()}`,
      runId,
      timestamp: new Date().toISOString(),
      type: 'WORKSPACE_VALIDATION_STARTED',
      summary: `Validating workspace for project '${project.projectId}' at '${project.workspacePath}'.`,
      details: {
        runId,
        projectId: project.projectId,
        workspacePath: project.workspacePath,
        repository: project.repository
      }
    });

    const resolution = this.resolver.resolve(request.projectId, {
      runId,
      taskId,
      targetBranch: request.targetBranch,
      trigger: request.trigger,
      actor: request.actor
    });

    if (!resolution.ok) {
      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId,
        timestamp: new Date().toISOString(),
        type: 'SAFETY_GATE_BLOCKED',
        summary: `Execution blocked during workspace resolution: ${resolution.message}`,
        details: {
          runId,
          reason: resolution.reason,
          message: resolution.message,
          ...resolution.details
        }
      });
      return {
        ok: false,
        runId,
        safetyBlocked: true,
        blockedReason: resolution.reason,
        blockedMessage: resolution.message
      };
    }

    this.emitEvent({
      id: `evt-${randomUUID()}`,
      runId,
      timestamp: new Date().toISOString(),
      type: 'WORKSPACE_VALIDATED',
      summary: `Workspace validated: ${resolution.context?.workspacePath} (${resolution.context?.branch}).`,
      details: {
        runId,
        projectId: resolution.context?.projectId,
        workspacePath: resolution.context?.workspacePath,
        repository: resolution.context?.repository,
        branch: resolution.context?.branch,
        commit: resolution.context?.commit
      }
    });

    // 4. SAFETY GATE EVALUATION
    this.emitEvent({
      id: `evt-${randomUUID()}`,
      runId,
      timestamp: new Date().toISOString(),
      type: 'SAFETY_GATE_STARTED',
      summary: 'Evaluating execution security rules and safety policies.',
      details: { runId, context: resolution.context }
    });

    const safetyResult = this.safetyGate.evaluate(resolution);
    if (!safetyResult.passed) {
      this.emitEvent({
        id: `evt-${randomUUID()}`,
        runId,
        timestamp: new Date().toISOString(),
        type: 'SAFETY_GATE_BLOCKED',
        summary: `Safety Gate BLOCKED execution: ${safetyResult.message}`,
        details: {
          runId,
          reason: safetyResult.reason,
          message: safetyResult.message,
          ...safetyResult.details
        }
      });
      return {
        ok: false,
        runId,
        safetyBlocked: true,
        blockedReason: safetyResult.reason,
        blockedMessage: safetyResult.message
      };
    }

    this.emitEvent({
      id: `evt-${randomUUID()}`,
      runId,
      timestamp: new Date().toISOString(),
      type: 'SAFETY_GATE_PASSED',
      summary: 'Safety Gate passed. Proceeding to execution.',
      details: { runId, context: safetyResult.context }
    });

    // 5. DISPATCH TO EXECUTION CORE (ClosedLoopEngine)
    const context = safetyResult.context!;
    const engine = this.engineFactory(context);

    const report = await engine.runLoop(request.initialPrompt, {
      loopId: runId,
      maxTurns: request.maxTurns,
      executionContext: context
    });

    return {
      ok: report.status === 'COMPLETED',
      runId,
      context,
      safetyBlocked: false,
      report
    };
  }
}
