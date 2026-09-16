import { MinimalProjectContext, IProjectContextStore } from './types.js';
import { ProjectContextError } from './errors.js';
import { validateProjectContextSchema, validateSafeProjectId } from './validation.js';

export class MemoryProjectContextStore implements IProjectContextStore {
  private readonly contexts = new Map<string, MinimalProjectContext>();
  private readonly initializedProjects = new Set<string>();

  async getContext(projectId: string): Promise<MinimalProjectContext | null> {
    const safeId = validateSafeProjectId(projectId);
    const existing = this.contexts.get(safeId);

    if (!existing) {
      if (this.initializedProjects.has(safeId)) {
        throw new ProjectContextError(
          'PROJECT_CONTEXT_MISSING',
          `Context for previously initialized project '${safeId}' is missing.`,
          safeId
        );
      }
      return null;
    }

    // Return a clone to prevent external direct mutations
    return JSON.parse(JSON.stringify(existing));
  }

  async createInitialContext(projectId: string): Promise<MinimalProjectContext> {
    const safeId = validateSafeProjectId(projectId);
    if (this.contexts.has(safeId)) {
      throw new ProjectContextError(
        'PROJECT_CONTEXT_VERSION_CONFLICT',
        `Context for project '${safeId}' already exists.`,
        safeId
      );
    }

    const now = new Date().toISOString();
    const initial: MinimalProjectContext = {
      projectId: safeId,
      status: 'ACTIVE',
      constraints: [],
      contextVersion: 1,
      createdAt: now,
      updatedAt: now
    };

    validateProjectContextSchema(initial, safeId);

    this.contexts.set(safeId, JSON.parse(JSON.stringify(initial)));
    this.initializedProjects.add(safeId);

    return JSON.parse(JSON.stringify(initial));
  }

  async updateContext(
    projectId: string,
    updater: (current: MinimalProjectContext) => Partial<MinimalProjectContext>,
    expectedVersion: number
  ): Promise<MinimalProjectContext> {
    const safeId = validateSafeProjectId(projectId);
    const current = this.contexts.get(safeId);

    if (!current) {
      if (this.initializedProjects.has(safeId)) {
        throw new ProjectContextError(
          'PROJECT_CONTEXT_MISSING',
          `Cannot update: Context for initialized project '${safeId}' is missing.`,
          safeId
        );
      }
      throw new ProjectContextError(
        'PROJECT_CONTEXT_UNINITIALIZED',
        `Cannot update: Context for project '${safeId}' has not been initialized.`,
        safeId
      );
    }

    if (current.contextVersion !== expectedVersion) {
      throw new ProjectContextError(
        'PROJECT_CONTEXT_VERSION_CONFLICT',
        `Version conflict on update for project '${safeId}'. Current version is ${current.contextVersion}, but expected ${expectedVersion}.`,
        safeId,
        { currentVersion: current.contextVersion, expectedVersion }
      );
    }

    if (current.status === 'PAUSED') {
      throw new ProjectContextError(
        'PROJECT_CONTEXT_PAUSED',
        `Cannot update context: Project '${safeId}' is currently PAUSED.`,
        safeId
      );
    }

    const updates = updater(JSON.parse(JSON.stringify(current)));
    const now = new Date().toISOString();

    const updatedCandidate: MinimalProjectContext = {
      ...current,
      ...updates,
      projectId: safeId, // Disallow mutating canonical projectId
      contextVersion: current.contextVersion + 1,
      createdAt: current.createdAt,
      updatedAt: now
    };

    const validated = validateProjectContextSchema(updatedCandidate, safeId);
    this.contexts.set(safeId, JSON.parse(JSON.stringify(validated)));

    return JSON.parse(JSON.stringify(validated));
  }

  async hasContext(projectId: string): Promise<boolean> {
    try {
      const safeId = validateSafeProjectId(projectId);
      return this.contexts.has(safeId);
    } catch {
      return false;
    }
  }

  // Internal test helper to simulate missing file after initialization
  _simulateMissingContext(projectId: string): void {
    const safeId = validateSafeProjectId(projectId);
    this.contexts.delete(safeId);
  }

  clear(): void {
    this.contexts.clear();
    this.initializedProjects.clear();
  }
}
