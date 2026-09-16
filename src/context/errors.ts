export type ProjectContextErrorCode =
  | 'PROJECT_CONTEXT_UNINITIALIZED'
  | 'PROJECT_CONTEXT_MISSING'
  | 'PROJECT_CONTEXT_CORRUPTED'
  | 'PROJECT_CONTEXT_VERSION_CONFLICT'
  | 'PROJECT_CONTEXT_PROJECT_ID_MISMATCH'
  | 'PROJECT_CONTEXT_PAUSED'
  | 'PROJECT_CONTEXT_ARCHIVED'
  | 'PROJECT_CONTEXT_INVALID_PATH'
  | 'PROJECT_CONTEXT_PERSISTENCE_FAILED';

export class ProjectContextError extends Error {
  constructor(
    public readonly code: ProjectContextErrorCode,
    message: string,
    public readonly projectId?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(`[${code}]${projectId ? ` (Project: '${projectId}')` : ''}: ${message}`);
    this.name = 'ProjectContextError';
  }
}
