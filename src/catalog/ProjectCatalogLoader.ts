import { IProjectCatalog, CatalogProjectEntry } from './types.js';
import { IProjectRegistry } from '../multiproject/ProjectRegistry.js';
import { WorkspaceResolver } from '../multiproject/WorkspaceResolver.js';
import { ProjectDefinition } from '../multiproject/types.js';

export interface ProjectLoadReport {
  loadedCount: number;
  skippedCount: number;
  errors: Array<{
    projectId: string;
    workspacePath?: string;
    reason: string;
    message: string;
  }>;
}

export class ProjectCatalogLoader {
  constructor(
    private readonly catalog: IProjectCatalog,
    private readonly resolver: WorkspaceResolver,
    private readonly registry: IProjectRegistry
  ) {}

  async loadAndRegister(): Promise<ProjectLoadReport> {
    const entries = await this.catalog.loadProjects();
    const report: ProjectLoadReport = {
      loadedCount: 0,
      skippedCount: 0,
      errors: []
    };

    const seenInCatalog = new Set<string>();

    for (const entry of entries) {
      const normalizedId = entry.projectId.toLowerCase();

      // Duplicate check within catalog
      if (seenInCatalog.has(normalizedId)) {
        report.skippedCount++;
        report.errors.push({
          projectId: entry.projectId,
          workspacePath: entry.workspacePath,
          reason: 'DUPLICATE_PROJECT_ID',
          message: `Duplicate projectId '${entry.projectId}' found in catalog. Only the first entry is processed.`
        });
        continue;
      }
      seenInCatalog.add(normalizedId);

      // Check if project is explicitly disabled in catalog
      if (entry.enabled === false) {
        report.skippedCount++;
        continue;
      }

      // Validate workspace existence and git metadata using WorkspaceResolver
      const resolution = this.resolver.resolveWorkspace(entry.workspacePath, {
        targetBranch: entry.defaultBranch
      });

      if (!resolution.ok || !resolution.context) {
        report.skippedCount++;
        report.errors.push({
          projectId: entry.projectId,
          workspacePath: entry.workspacePath,
          reason: resolution.reason || 'WORKSPACE_INVALID',
          message: resolution.message || `Failed to resolve workspace for project '${entry.projectId}'.`
        });
        continue;
      }

      const ctx = resolution.context;

      // Deterministic Project ID check: verify that catalog.projectId matches resolved identity
      if (ctx.projectId !== normalizedId) {
        report.skippedCount++;
        report.errors.push({
          projectId: entry.projectId,
          workspacePath: entry.workspacePath,
          reason: 'PROJECT_ID_MISMATCH',
          message: `Catalog projectId '${entry.projectId}' does not match resolved Git identity '${ctx.projectId}'.`
        });
        continue;
      }

      // Check if already registered in registry
      if (this.registry.hasProject(normalizedId)) {
        report.skippedCount++;
        continue;
      }

      const projectDef: ProjectDefinition = {
        projectId: normalizedId,
        projectName: entry.projectName || ctx.projectName,
        workspacePath: ctx.workspacePath,
        repository: entry.repository || ctx.repository,
        defaultBranch: entry.defaultBranch || ctx.branch,
        enabled: true,
        validationPolicy: entry.validationPolicy || ctx.validationPolicy,
        metadata: entry.metadata
      };

      this.registry.registerProject(projectDef);
      report.loadedCount++;
    }

    return report;
  }
}
