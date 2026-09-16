import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { MinimalProjectContext, IProjectContextStore } from './types.js';
import { ProjectContextError } from './errors.js';
import { validateProjectContextSchema, validateSafeProjectId } from './validation.js';

export interface FileProjectContextStoreOptions {
  baseDataDir?: string;
}

export class FileProjectContextStore implements IProjectContextStore {
  private readonly baseDataDir: string;
  private readonly projectsDir: string;

  constructor(options: FileProjectContextStoreOptions = {}) {
    if (options.baseDataDir) {
      this.baseDataDir = resolve(options.baseDataDir);
    } else if (process.env.PUB_ACP_DATA_DIR) {
      this.baseDataDir = resolve(process.env.PUB_ACP_DATA_DIR);
    } else if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
      this.baseDataDir = resolve(process.env.LOCALAPPDATA, 'pub-acp', 'context');
    } else {
      this.baseDataDir = resolve(homedir(), '.pub-acp', 'context');
    }

    this.projectsDir = join(this.baseDataDir, 'projects');
    if (!existsSync(this.projectsDir)) {
      mkdirSync(this.projectsDir, { recursive: true });
    }
  }

  getBaseDataDir(): string {
    return this.baseDataDir;
  }

  getProjectsDir(): string {
    return this.projectsDir;
  }

  private getProjectDir(safeId: string): string {
    const pDir = join(this.projectsDir, safeId);
    // Ensure the resolved directory is strictly inside projectsDir
    if (!resolve(pDir).startsWith(resolve(this.projectsDir))) {
      throw new ProjectContextError(
        'PROJECT_CONTEXT_INVALID_PATH',
        `Computed project path escapes projects directory: '${safeId}'`,
        safeId
      );
    }
    return pDir;
  }

  private getContextFilePath(safeId: string): string {
    return join(this.getProjectDir(safeId), 'context.json');
  }

  private getMarkerFilePath(safeId: string): string {
    return join(this.getProjectDir(safeId), '.initialized');
  }

  async getContext(projectId: string): Promise<MinimalProjectContext | null> {
    const safeId = validateSafeProjectId(projectId);
    const filePath = this.getContextFilePath(safeId);
    const markerPath = this.getMarkerFilePath(safeId);

    if (!existsSync(filePath)) {
      if (existsSync(markerPath)) {
        throw new ProjectContextError(
          'PROJECT_CONTEXT_MISSING',
          `Context for previously initialized project '${safeId}' is missing from disk.`,
          safeId
        );
      }
      return null;
    }

    let rawText: string;
    try {
      rawText = readFileSync(filePath, 'utf8');
    } catch (err: any) {
      throw new ProjectContextError(
        'PROJECT_CONTEXT_PERSISTENCE_FAILED',
        `Failed to read context file: ${err.message}`,
        safeId
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (err: any) {
      throw new ProjectContextError(
        'PROJECT_CONTEXT_CORRUPTED',
        `Invalid JSON in context file: ${err.message}`,
        safeId
      );
    }

    return validateProjectContextSchema(parsed, safeId);
  }

  async createInitialContext(projectId: string): Promise<MinimalProjectContext> {
    const safeId = validateSafeProjectId(projectId);
    const pDir = this.getProjectDir(safeId);
    const filePath = this.getContextFilePath(safeId);
    const markerPath = this.getMarkerFilePath(safeId);

    if (existsSync(filePath)) {
      throw new ProjectContextError(
        'PROJECT_CONTEXT_VERSION_CONFLICT',
        `Context for project '${safeId}' already exists.`,
        safeId
      );
    }

    if (!existsSync(pDir)) {
      mkdirSync(pDir, { recursive: true });
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

    // Atomic write of context file and marker file
    this.atomicWriteFile(safeId, filePath, JSON.stringify(initial, null, 2));

    try {
      this.atomicWriteFile(safeId, markerPath, `initialized: ${now}\n`);
    } catch (err: any) {
      // If marker write fails, rollback context file to guarantee strict UNINITIALIZED vs MISSING consistency
      try { unlinkSync(filePath); } catch {}
      throw new ProjectContextError(
        'PROJECT_CONTEXT_PERSISTENCE_FAILED',
        `Failed to complete initial context persistence (marker creation failed): ${err.message}`,
        safeId
      );
    }

    return initial;
  }

  async updateContext(
    projectId: string,
    updater: (current: MinimalProjectContext) => Partial<MinimalProjectContext>,
    expectedVersion: number
  ): Promise<MinimalProjectContext> {
    const safeId = validateSafeProjectId(projectId);
    const filePath = this.getContextFilePath(safeId);
    const markerPath = this.getMarkerFilePath(safeId);

    if (!existsSync(filePath)) {
      if (existsSync(markerPath)) {
        throw new ProjectContextError(
          'PROJECT_CONTEXT_MISSING',
          `Cannot update: Context file for initialized project '${safeId}' is missing from disk.`,
          safeId
        );
      }
      throw new ProjectContextError(
        'PROJECT_CONTEXT_UNINITIALIZED',
        `Cannot update: Context for project '${safeId}' has not been initialized.`,
        safeId
      );
    }

    const current = await this.getContext(safeId);
    if (!current) {
      throw new ProjectContextError(
        'PROJECT_CONTEXT_UNINITIALIZED',
        `Context for project '${safeId}' not found.`,
        safeId
      );
    }

    if (current.contextVersion !== expectedVersion) {
      throw new ProjectContextError(
        'PROJECT_CONTEXT_VERSION_CONFLICT',
        `Optimistic concurrency version conflict for '${safeId}'. Current version on disk is ${current.contextVersion}, but expected ${expectedVersion}.`,
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
      projectId: safeId,
      contextVersion: current.contextVersion + 1,
      createdAt: current.createdAt,
      updatedAt: now
    };

    const validated = validateProjectContextSchema(updatedCandidate, safeId);
    this.atomicWriteFile(safeId, filePath, JSON.stringify(validated, null, 2));

    return validated;
  }

  async hasContext(projectId: string): Promise<boolean> {
    try {
      const safeId = validateSafeProjectId(projectId);
      return existsSync(this.getContextFilePath(safeId));
    } catch {
      return false;
    }
  }

  private atomicWriteFile(safeId: string, targetPath: string, content: string): void {
    const tempFile = `${targetPath}.tmp.${randomUUID()}`;
    try {
      writeFileSync(tempFile, content, 'utf8');
      renameSync(tempFile, targetPath);
    } catch (err: any) {
      if (existsSync(tempFile)) {
        try { unlinkSync(tempFile); } catch {}
      }
      throw new ProjectContextError(
        'PROJECT_CONTEXT_PERSISTENCE_FAILED',
        `Atomic write failed: ${err.message}`,
        safeId
      );
    }
  }
}
