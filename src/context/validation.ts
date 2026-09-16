import { MinimalProjectContext } from './types.js';
import { ProjectContextError } from './errors.js';

export function validateProjectContextSchema(data: unknown, expectedProjectId?: string): MinimalProjectContext {
  if (!data || typeof data !== 'object') {
    throw new ProjectContextError('PROJECT_CONTEXT_CORRUPTED', 'Context data must be a valid non-null object', expectedProjectId);
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.projectId !== 'string' || !obj.projectId.trim()) {
    throw new ProjectContextError('PROJECT_CONTEXT_CORRUPTED', 'Missing or invalid projectId field in context', expectedProjectId);
  }

  const normalizedProjectId = obj.projectId.trim().toLowerCase();

  if (expectedProjectId && normalizedProjectId !== expectedProjectId.trim().toLowerCase()) {
    throw new ProjectContextError(
      'PROJECT_CONTEXT_PROJECT_ID_MISMATCH',
      `Context internal projectId '${obj.projectId}' does not match expected '${expectedProjectId}'`,
      expectedProjectId,
      { actual: obj.projectId, expected: expectedProjectId }
    );
  }

  if (obj.status !== 'ACTIVE' && obj.status !== 'PAUSED' && obj.status !== 'ARCHIVED') {
    throw new ProjectContextError('PROJECT_CONTEXT_CORRUPTED', `Invalid status '${obj.status}'. Expected ACTIVE, PAUSED or ARCHIVED`, normalizedProjectId);
  }

  if (typeof obj.contextVersion !== 'number' || !Number.isInteger(obj.contextVersion) || obj.contextVersion < 1) {
    throw new ProjectContextError('PROJECT_CONTEXT_CORRUPTED', 'Missing or invalid contextVersion. Must be a positive integer', normalizedProjectId);
  }

  if (!Array.isArray(obj.constraints)) {
    throw new ProjectContextError('PROJECT_CONTEXT_CORRUPTED', 'Constraints field must be an array', normalizedProjectId);
  }

  for (const c of obj.constraints) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || typeof c.description !== 'string' || typeof c.enforcedSince !== 'string') {
      throw new ProjectContextError('PROJECT_CONTEXT_CORRUPTED', 'Invalid constraint element structure in constraints array', normalizedProjectId);
    }
  }

  if (obj.lastRunId !== undefined && typeof obj.lastRunId !== 'string') {
    throw new ProjectContextError('PROJECT_CONTEXT_CORRUPTED', 'lastRunId must be a string if provided', normalizedProjectId);
  }

  if (obj.lastSuccessfulRunId !== undefined && typeof obj.lastSuccessfulRunId !== 'string') {
    throw new ProjectContextError('PROJECT_CONTEXT_CORRUPTED', 'lastSuccessfulRunId must be a string if provided', normalizedProjectId);
  }

  if (obj.lastFailedRunId !== undefined && typeof obj.lastFailedRunId !== 'string') {
    throw new ProjectContextError('PROJECT_CONTEXT_CORRUPTED', 'lastFailedRunId must be a string if provided', normalizedProjectId);
  }

  if (typeof obj.createdAt !== 'string' || isNaN(Date.parse(obj.createdAt))) {
    throw new ProjectContextError('PROJECT_CONTEXT_CORRUPTED', 'Missing or invalid createdAt ISO timestamp', normalizedProjectId);
  }

  if (typeof obj.updatedAt !== 'string' || isNaN(Date.parse(obj.updatedAt))) {
    throw new ProjectContextError('PROJECT_CONTEXT_CORRUPTED', 'Missing or invalid updatedAt ISO timestamp', normalizedProjectId);
  }

  return {
    projectId: normalizedProjectId,
    status: obj.status,
    activeObjective: typeof obj.activeObjective === 'string' ? obj.activeObjective : undefined,
    constraints: obj.constraints.map((c: any) => ({
      id: String(c.id),
      description: String(c.description),
      enforcedSince: String(c.enforcedSince)
    })),
    lastRunId: obj.lastRunId as string | undefined,
    lastSuccessfulRunId: obj.lastSuccessfulRunId as string | undefined,
    lastFailedRunId: obj.lastFailedRunId as string | undefined,
    contextVersion: obj.contextVersion,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
  };
}

export function validateSafeProjectId(projectId: string): string {
  if (!projectId || typeof projectId !== 'string') {
    throw new ProjectContextError('PROJECT_CONTEXT_INVALID_PATH', 'Project ID must be a non-empty string');
  }

  const trimmed = projectId.trim().toLowerCase();

  // Protect against path traversal and dangerous characters
  if (
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes(':') ||
    trimmed.includes('*') ||
    trimmed.includes('?') ||
    trimmed.includes('"') ||
    trimmed.includes('<') ||
    trimmed.includes('>') ||
    trimmed.includes('|')
  ) {
    throw new ProjectContextError(
      'PROJECT_CONTEXT_INVALID_PATH',
      `Project ID '${projectId}' contains invalid characters or path traversal elements.`,
      projectId
    );
  }

  return trimmed;
}
