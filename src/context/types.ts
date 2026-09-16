export type ProjectOperationalStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'ARCHIVED';

export interface ProjectOperationalConstraint {
  id: string;
  description: string;
  enforcedSince: string;
}

export interface MinimalProjectContext {
  projectId: string;
  status: ProjectOperationalStatus;
  activeObjective?: string;
  constraints: ProjectOperationalConstraint[];
  lastRunId?: string;
  lastSuccessfulRunId?: string;
  lastFailedRunId?: string;
  contextVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface IProjectContextStore {
  getContext(projectId: string): Promise<MinimalProjectContext | null>;
  createInitialContext(projectId: string): Promise<MinimalProjectContext>;
  updateContext(
    projectId: string,
    updater: (current: MinimalProjectContext) => Partial<MinimalProjectContext>,
    expectedVersion: number
  ): Promise<MinimalProjectContext>;
  hasContext(projectId: string): Promise<boolean>;
}
