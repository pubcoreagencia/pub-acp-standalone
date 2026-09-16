import { ProjectDefinition } from './types.js';

export interface IProjectRegistry {
  registerProject(def: ProjectDefinition): void;
  getProject(projectId: string): ProjectDefinition | undefined;
  listProjects(): ProjectDefinition[];
  hasProject(projectId: string): boolean;
  clear(): void;
}

export class ProjectRegistry implements IProjectRegistry {
  private readonly projects = new Map<string, ProjectDefinition>();

  constructor(initialProjects: ProjectDefinition[] = []) {
    for (const proj of initialProjects) {
      this.registerProject(proj);
    }
  }

  registerProject(def: ProjectDefinition): void {
    if (!def.projectId || typeof def.projectId !== 'string') {
      throw new Error('Project definition requires a valid projectId string.');
    }
    this.projects.set(def.projectId.trim().toLowerCase(), {
      ...def,
      projectId: def.projectId.trim().toLowerCase()
    });
  }

  getProject(projectId: string): ProjectDefinition | undefined {
    if (!projectId || typeof projectId !== 'string') return undefined;
    return this.projects.get(projectId.trim().toLowerCase());
  }

  listProjects(): ProjectDefinition[] {
    return Array.from(this.projects.values());
  }

  hasProject(projectId: string): boolean {
    if (!projectId || typeof projectId !== 'string') return false;
    return this.projects.has(projectId.trim().toLowerCase());
  }

  clear(): void {
    this.projects.clear();
  }
}
