import { ValidationPolicy } from '../validation/types.js';

export interface CatalogProjectEntry {
  projectId: string;
  workspacePath: string;
  enabled?: boolean;
  projectName?: string;
  repository?: string;
  defaultBranch?: string;
  validationPolicy?: ValidationPolicy;
  metadata?: Record<string, unknown>;
}

export interface ProjectCatalogData {
  version?: string;
  projects: CatalogProjectEntry[];
}

export interface IProjectCatalog {
  loadProjects(): Promise<CatalogProjectEntry[]>;
}
