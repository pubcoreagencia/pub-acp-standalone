import { IEventBus } from '../observability/EventBus.js';
import { AutonomyEvent } from '../observability/types.js';
import { IProjectContextStore } from './types.js';
import { ProjectContextError } from './errors.js';

export interface ProjectContextProjectorOptions {
  maxRetries?: number;
  initialRetryDelayMs?: number;
}

export class ProjectContextProjector {
  private readonly maxRetries: number;
  private readonly initialRetryDelayMs: number;
  private unsubscribe?: () => void;

  constructor(
    private readonly store: IProjectContextStore,
    private readonly eventBus: IEventBus,
    options: ProjectContextProjectorOptions = {}
  ) {
    this.maxRetries = options.maxRetries ?? 3;
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 10;
  }

  start(): void {
    if (this.unsubscribe) return;

    this.unsubscribe = this.eventBus.subscribe('*', (event: AutonomyEvent) => {
      this.handleEvent(event).catch(err => {
        // Projection failure must NOT interrupt runtime or change ClosedLoopEngine authority.
        // It outputs structured warning telemetry.
        console.warn(`[ProjectContextProjector] Async projection failure for event ${event.id} (${event.type}): ${err.message}`);
      });
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  async handleEvent(event: AutonomyEvent): Promise<void> {
    const rawProjectId = event.details?.projectId as string | undefined;
    if (!rawProjectId || typeof rawProjectId !== 'string' || !rawProjectId.trim()) {
      // Event without explicit projectId cannot be mapped to a specific ProjectContext
      return;
    }

    const projectId = rawProjectId.trim().toLowerCase();

    // Only project targeted lifecycle events
    if (event.type !== 'RUN_CREATED' && event.type !== 'RUN_COMPLETED' && event.type !== 'RUN_FAILED') {
      return;
    }

    let attempt = 0;
    while (attempt <= this.maxRetries) {
      try {
        let context = await this.store.getContext(projectId);
        if (!context) {
          // If project context does not exist yet, initialize it
          context = await this.store.createInitialContext(projectId);
        }

        // Idempotency check: verify if the event was already projected
        if (event.type === 'RUN_CREATED') {
          if (context.lastRunId === event.runId) {
            return; // Already projected
          }
          await this.store.updateContext(
            projectId,
            () => ({
              lastRunId: event.runId
            }),
            context.contextVersion
          );
          return;
        }

        if (event.type === 'RUN_COMPLETED') {
          if (context.lastSuccessfulRunId === event.runId) {
            return; // Already projected
          }
          await this.store.updateContext(
            projectId,
            () => ({
              lastSuccessfulRunId: event.runId
            }),
            context.contextVersion
          );
          return;
        }

        if (event.type === 'RUN_FAILED') {
          if (context.lastFailedRunId === event.runId) {
            return; // Already projected
          }
          await this.store.updateContext(
            projectId,
            () => ({
              lastFailedRunId: event.runId
            }),
            context.contextVersion
          );
          return;
        }

        return;
      } catch (err: any) {
        if (err instanceof ProjectContextError && err.code === 'PROJECT_CONTEXT_VERSION_CONFLICT') {
          attempt++;
          if (attempt <= this.maxRetries) {
            // Controlled exponential backoff retry for optimistic concurrency
            await new Promise(res => setTimeout(res, this.initialRetryDelayMs * Math.pow(2, attempt - 1)));
            continue;
          }
        }
        // Retries exhausted or non-retryable error
        throw err;
      }
    }
  }
}
