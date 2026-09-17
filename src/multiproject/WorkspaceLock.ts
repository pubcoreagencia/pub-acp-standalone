import { resolve } from 'node:path';

/**
 * Canonical normalization of workspace filesystem paths for locking purposes.
 * Ensures consistent handling across Windows and Unix paths:
 * - Full path resolution
 * - Replaces backslashes with forward slashes
 * - Lowercases drive letters and path on case-insensitive filesystems
 * - Strips trailing slashes
 */
export function normalizeWorkspacePath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('Invalid workspace path: path must be a non-empty string');
  }

  const resolved = resolve(rawPath);
  let normalized = resolved.replace(/\\/g, '/');

  // Strip trailing slashes, preserving root if '/'
  normalized = normalized.replace(/\/+$/, '');

  // Case normalization for Windows / case-insensitive OS
  return normalized.toLowerCase();
}

export interface LockRecord {
  workspacePath: string;
  normalizedWorkspacePath: string;
  runId: string;
  acquiredAt: string;
  metadata?: {
    projectId?: string;
    conversationId?: string;
  };
}

export type WorkspaceLockResult =
  | {
      acquired: true;
      record: LockRecord;
    }
  | {
      acquired: false;
      existingLock: LockRecord;
      message: string;
    };

export interface IWorkspaceLock {
  acquire(
    workspacePath: string,
    runId: string,
    metadata?: {
      projectId?: string;
      conversationId?: string;
    }
  ): WorkspaceLockResult;

  release(
    workspacePath: string,
    runId: string
  ): boolean;

  isLocked(
    workspacePath: string
  ): boolean;

  getLock(
    workspacePath: string
  ): LockRecord | null;
}

export class MemoryWorkspaceLock implements IWorkspaceLock {
  private readonly locks = new Map<string, LockRecord>();

  acquire(
    workspacePath: string,
    runId: string,
    metadata?: {
      projectId?: string;
      conversationId?: string;
    }
  ): WorkspaceLockResult {
    const normalized = normalizeWorkspacePath(workspacePath);
    const existing = this.locks.get(normalized);

    if (existing) {
      // Reentrancy rule: same workspace + same runId is idempotent / allowed
      if (existing.runId === runId) {
        return {
          acquired: true,
          record: existing
        };
      }

      return {
        acquired: false,
        existingLock: existing,
        message: `Workspace '${workspacePath}' is currently locked by run '${existing.runId}' (acquired at ${existing.acquiredAt}).`
      };
    }

    const record: LockRecord = {
      workspacePath,
      normalizedWorkspacePath: normalized,
      runId,
      acquiredAt: new Date().toISOString(),
      metadata
    };

    this.locks.set(normalized, record);

    return {
      acquired: true,
      record
    };
  }

  release(workspacePath: string, runId: string): boolean {
    const normalized = normalizeWorkspacePath(workspacePath);
    const existing = this.locks.get(normalized);

    if (!existing) {
      return false;
    }

    // Ownership rule: only the lock owner can release the lock
    if (existing.runId !== runId) {
      return false;
    }

    this.locks.delete(normalized);
    return true;
  }

  isLocked(workspacePath: string): boolean {
    const normalized = normalizeWorkspacePath(workspacePath);
    return this.locks.has(normalized);
  }

  getLock(workspacePath: string): LockRecord | null {
    const normalized = normalizeWorkspacePath(workspacePath);
    return this.locks.get(normalized) || null;
  }
}
