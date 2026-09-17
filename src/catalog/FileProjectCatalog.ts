import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { IProjectCatalog, CatalogProjectEntry, ProjectCatalogData } from './types.js';

export interface FileProjectCatalogOptions {
  catalogPath?: string;
}

/**
 * Returns candidate catalog paths in priority order:
 * 1. Explicit path passed in options / env PUB_ACP_CATALOG_PATH
 * 2. Local config in workspace: ./projects.json or ./.pub-acp/projects.json
 * 3. Global user config: ~/.pub-acp/projects.json
 */
export function getDefaultCatalogPath(cwd: string = process.cwd()): string | undefined {
  if (process.env.PUB_ACP_CATALOG_PATH && process.env.PUB_ACP_CATALOG_PATH.trim()) {
    const envPath = resolve(process.env.PUB_ACP_CATALOG_PATH.trim());
    if (existsSync(envPath)) return envPath;
  }

  const candidates = [
    resolve(cwd, 'projects.json'),
    resolve(cwd, '.pub-acp', 'projects.json'),
    join(homedir(), '.pub-acp', 'projects.json')
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }

  return undefined;
}

export class FileProjectCatalog implements IProjectCatalog {
  private readonly catalogPath?: string;

  constructor(options: FileProjectCatalogOptions = {}) {
    if (options.catalogPath && typeof options.catalogPath === 'string' && options.catalogPath.trim()) {
      this.catalogPath = resolve(options.catalogPath.trim());
    } else {
      this.catalogPath = getDefaultCatalogPath();
    }
  }

  getCatalogPath(): string | undefined {
    return this.catalogPath;
  }

  async loadProjects(): Promise<CatalogProjectEntry[]> {
    if (!this.catalogPath || !existsSync(this.catalogPath)) {
      return [];
    }

    const content = await readFile(this.catalogPath, 'utf8');
    if (!content.trim()) {
      return [];
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (err: any) {
      throw new Error(`Failed to parse project catalog JSON at '${this.catalogPath}': ${err.message}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`Invalid project catalog format: root must be an object at '${this.catalogPath}'.`);
    }

    const rawList = Array.isArray(parsed.projects) ? parsed.projects : [];
    const result: CatalogProjectEntry[] = [];

    for (let i = 0; i < rawList.length; i++) {
      const entry = rawList[i];
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      if (!entry.projectId || typeof entry.projectId !== 'string' || !entry.projectId.trim()) {
        throw new Error(`Catalog entry at index ${i} missing required 'projectId' string.`);
      }

      if (!entry.workspacePath || typeof entry.workspacePath !== 'string' || !entry.workspacePath.trim()) {
        throw new Error(`Catalog entry '${entry.projectId}' missing required 'workspacePath' string.`);
      }

      result.push({
        projectId: entry.projectId.trim().toLowerCase(),
        workspacePath: resolve(entry.workspacePath.trim()),
        enabled: entry.enabled !== undefined ? Boolean(entry.enabled) : true,
        projectName: typeof entry.projectName === 'string' ? entry.projectName.trim() : undefined,
        repository: typeof entry.repository === 'string' ? entry.repository.trim() : undefined,
        defaultBranch: typeof entry.defaultBranch === 'string' ? entry.defaultBranch.trim() : undefined,
        validationPolicy: entry.validationPolicy,
        metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : undefined
      });
    }

    return result;
  }
}

export class MemoryProjectCatalog implements IProjectCatalog {
  private readonly entries: CatalogProjectEntry[];

  constructor(entries: CatalogProjectEntry[] = []) {
    this.entries = entries.map(e => ({
      ...e,
      projectId: e.projectId.trim().toLowerCase(),
      workspacePath: resolve(e.workspacePath.trim()),
      enabled: e.enabled !== undefined ? Boolean(e.enabled) : true
    }));
  }

  async loadProjects(): Promise<CatalogProjectEntry[]> {
    return [...this.entries];
  }
}
