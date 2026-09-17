import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  IProjectCatalog,
  CatalogProjectEntry,
  ProjectCatalogData,
  CatalogValidationReport,
  CatalogValidationIssue
} from './types.js';
import { getDefaultCatalogPath } from './FileProjectCatalog.js';
import { WorkspaceResolver } from '../multiproject/WorkspaceResolver.js';
import { normalizeWorkspacePath } from '../multiproject/WorkspaceLock.js';

export interface CatalogManagerOptions {
  catalogPath?: string;
  resolver?: WorkspaceResolver;
}

/**
 * Administrative tooling for inspecting, validating, and mutating
 * the local authorized project catalog with atomic writes and fail-closed safety.
 */
export class CatalogManager {
  private readonly catalogPath: string;
  private readonly resolver: WorkspaceResolver;

  constructor(options: CatalogManagerOptions = {}) {
    if (options.catalogPath && typeof options.catalogPath === 'string' && options.catalogPath.trim()) {
      this.catalogPath = resolve(options.catalogPath.trim());
    } else {
      const discovered = getDefaultCatalogPath();
      if (discovered) {
        this.catalogPath = discovered;
      } else {
        // Canonical default write path when no catalog file currently exists
        this.catalogPath = join(homedir(), '.pub-acp', 'projects.json');
      }
    }

    this.resolver = options.resolver || new WorkspaceResolver();
  }

  getCatalogPath(): string {
    return this.catalogPath;
  }

  /**
   * Safely reads and parses the catalog file.
   * Returns empty projects array if file does not exist.
   * Throws if file exists but contains invalid JSON.
   */
  async readCatalog(): Promise<ProjectCatalogData> {
    if (!existsSync(this.catalogPath)) {
      return { version: '1.0', projects: [] };
    }

    const content = await readFile(this.catalogPath, 'utf8');
    if (!content.trim()) {
      return { version: '1.0', projects: [] };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (err: any) {
      throw new Error(`Catalog file at '${this.catalogPath}' contains invalid JSON: ${err.message}`);
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.projects)) {
      throw new Error(`Invalid catalog format: root must be an object with a 'projects' array at '${this.catalogPath}'.`);
    }

    return parsed as ProjectCatalogData;
  }

  /**
   * Writes the catalog atomically using a temporary file + rename.
   * Ensures that aborted or failed writes never corrupt the existing catalog file.
   */
  async writeCatalog(data: ProjectCatalogData): Promise<void> {
    const dir = dirname(this.catalogPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const tmpPath = `${this.catalogPath}.tmp.${randomUUID()}`;
    const payload = JSON.stringify(data, null, 2) + '\n';

    try {
      await writeFile(tmpPath, payload, 'utf8');
      await rename(tmpPath, this.catalogPath);
    } catch (err: any) {
      if (existsSync(tmpPath)) {
        try {
          unlinkSync(tmpPath);
        } catch {}
      }
      throw new Error(`Failed to atomically persist catalog to '${this.catalogPath}': ${err.message}`);
    }
  }

  /**
   * Lists all project entries currently declared in the catalog.
   */
  async list(): Promise<CatalogProjectEntry[]> {
    const data = await this.readCatalog();
    return data.projects;
  }

  /**
   * Shows a specific project entry by projectId.
   */
  async show(projectId: string): Promise<CatalogProjectEntry | undefined> {
    if (!projectId || typeof projectId !== 'string') return undefined;
    const normalizedId = projectId.trim().toLowerCase();
    const list = await this.list();
    return list.find(p => p.projectId.toLowerCase() === normalizedId);
  }

  /**
   * Validates the entire catalog against the live filesystem and Git repositories.
   */
  async validate(): Promise<CatalogValidationReport> {
    const issues: CatalogValidationIssue[] = [];
    let data: ProjectCatalogData;

    try {
      data = await this.readCatalog();
    } catch (err: any) {
      return {
        valid: false,
        totalEntries: 0,
        validEntries: 0,
        issues: [
          {
            code: 'INVALID_CATALOG_JSON',
            message: err.message,
            severity: 'ERROR'
          }
        ]
      };
    }

    const seenIds = new Set<string>();
    const seenPhysicalWorkspaces = new Set<string>();
    let validEntries = 0;

    for (const entry of data.projects) {
      let hasError = false;
      const normalizedId = (entry.projectId || '').trim().toLowerCase();

      // Check 1: Mandatory projectId
      if (!normalizedId) {
        issues.push({
          workspacePath: entry.workspacePath,
          code: 'MISSING_PROJECT_ID',
          message: "Catalog entry is missing required 'projectId'.",
          severity: 'ERROR'
        });
        hasError = true;
      } else {
        // Check 2: Duplicate projectId
        if (seenIds.has(normalizedId)) {
          issues.push({
            projectId: normalizedId,
            workspacePath: entry.workspacePath,
            code: 'DUPLICATE_PROJECT_ID',
            message: `Duplicate projectId '${normalizedId}' declared in catalog.`,
            severity: 'ERROR'
          });
          hasError = true;
        }
        seenIds.add(normalizedId);
      }

      // Check 3: Mandatory workspacePath
      if (!entry.workspacePath || typeof entry.workspacePath !== 'string' || !entry.workspacePath.trim()) {
        issues.push({
          projectId: normalizedId,
          code: 'MISSING_WORKSPACE_PATH',
          message: "Catalog entry is missing required 'workspacePath'.",
          severity: 'ERROR'
        });
        hasError = true;
        continue;
      }

      // Canonical physical workspace deduplication
      const canonicalKey = normalizeWorkspacePath(entry.workspacePath);
      if (seenPhysicalWorkspaces.has(canonicalKey)) {
        issues.push({
          projectId: normalizedId,
          workspacePath: entry.workspacePath,
          code: 'DUPLICATE_PHYSICAL_WORKSPACE',
          message: `Workspace path '${entry.workspacePath}' is already registered under another entry.`,
          severity: 'ERROR'
        });
        hasError = true;
      }
      seenPhysicalWorkspaces.add(canonicalKey);

      // Check 4: Workspace resolution via WorkspaceResolver (do not pass targetBranch so we can warn rather than fail-block)
      const resolution = this.resolver.resolveWorkspace(entry.workspacePath);

      if (!resolution.ok || !resolution.context) {
        issues.push({
          projectId: normalizedId,
          workspacePath: entry.workspacePath,
          code: resolution.reason || 'WORKSPACE_INVALID',
          message: resolution.message || `Failed to resolve workspace '${entry.workspacePath}'.`,
          severity: 'ERROR'
        });
        hasError = true;
      } else {
        const ctx = resolution.context;
        // Check 5: Project identity mismatch
        if (normalizedId && ctx.projectId !== normalizedId) {
          issues.push({
            projectId: normalizedId,
            workspacePath: entry.workspacePath,
            code: 'PROJECT_ID_MISMATCH',
            message: `Catalog projectId '${normalizedId}' does not match resolved Git identity '${ctx.projectId}'.`,
            severity: 'ERROR'
          });
          hasError = true;
        }

        // Check 6: Branch mismatch (WARNING)
        if (entry.defaultBranch && ctx.branch && ctx.branch !== entry.defaultBranch) {
          issues.push({
            projectId: normalizedId,
            workspacePath: entry.workspacePath,
            code: 'WORKSPACE_BRANCH_MISMATCH',
            message: `Current branch '${ctx.branch}' does not match configured branch '${entry.defaultBranch}'.`,
            severity: 'WARNING'
          });
        }
      }

      if (!hasError) {
        validEntries++;
      }
    }

    const hasBlockingErrors = issues.some(i => i.severity === 'ERROR');

    return {
      valid: !hasBlockingErrors,
      totalEntries: data.projects.length,
      validEntries,
      issues
    };
  }

  /**
   * Adds a new project to the catalog after strict physical and Git validation.
   * Rejects non-existent, non-Git, duplicate ID, or duplicate physical path.
   */
  async add(rawPath: string, options: { defaultBranch?: string } = {}): Promise<CatalogProjectEntry> {
    if (!rawPath || typeof rawPath !== 'string' || !rawPath.trim()) {
      throw new Error("Path to project workspace is required. Usage: acp catalog add <path>");
    }

    const canonicalPath = resolve(rawPath.trim());

    // 1. Physical directory check
    if (!existsSync(canonicalPath)) {
      throw new Error(`Workspace path does not exist: '${canonicalPath}'`);
    }
    const stat = statSync(canonicalPath);
    if (!stat.isDirectory()) {
      throw new Error(`Workspace path is not a directory: '${canonicalPath}'`);
    }

    // 2. Git & metadata resolution
    const resolution = this.resolver.resolveWorkspace(canonicalPath, {
      targetBranch: options.defaultBranch
    });

    if (!resolution.ok || !resolution.context) {
      throw new Error(`Validation failed for '${canonicalPath}': [${resolution.reason}] ${resolution.message}`);
    }

    const ctx = resolution.context;
    const resolvedProjectId = ctx.projectId.toLowerCase();

    // 3. Check for duplicates in current catalog
    const data = await this.readCatalog();
    const normalizedNewKey = normalizeWorkspacePath(canonicalPath);

    for (const existing of data.projects) {
      if (existing.projectId.toLowerCase() === resolvedProjectId) {
        throw new Error(`Project with id '${resolvedProjectId}' is already registered in the catalog.`);
      }
      if (normalizeWorkspacePath(existing.workspacePath) === normalizedNewKey) {
        throw new Error(`Workspace '${canonicalPath}' is already registered under project '${existing.projectId}'.`);
      }
    }

    const newEntry: CatalogProjectEntry = {
      projectId: resolvedProjectId,
      projectName: ctx.projectName,
      workspacePath: canonicalPath,
      repository: ctx.repository,
      defaultBranch: options.defaultBranch || ctx.branch,
      enabled: true
    };

    data.projects.push(newEntry);
    await this.writeCatalog(data);

    return newEntry;
  }

  /**
   * Removes an existing project from the catalog by projectId.
   * Returns true if removed, false if not found.
   * Guarantees that physical workspace and Git repository are NEVER modified or deleted.
   */
  async remove(projectId: string): Promise<boolean> {
    if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
      throw new Error("ProjectId is required. Usage: acp catalog remove <projectId>");
    }

    const normalizedId = projectId.trim().toLowerCase();
    const data = await this.readCatalog();

    const idx = data.projects.findIndex(p => p.projectId.toLowerCase() === normalizedId);
    if (idx === -1) {
      return false;
    }

    data.projects.splice(idx, 1);
    await this.writeCatalog(data);

    return true;
  }
}
