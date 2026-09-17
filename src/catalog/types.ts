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
  description?: string;
  projects: CatalogProjectEntry[];
}

export interface IProjectCatalog {
  loadProjects(): Promise<CatalogProjectEntry[]>;
}

export interface CatalogValidationIssue {
  projectId?: string;
  workspacePath?: string;
  code: string;
  message: string;
  severity: 'ERROR' | 'WARNING';
}

export interface CatalogValidationReport {
  valid: boolean;
  totalEntries: number;
  validEntries: number;
  issues: CatalogValidationIssue[];
}
