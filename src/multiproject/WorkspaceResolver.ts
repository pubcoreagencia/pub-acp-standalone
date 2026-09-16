import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { IProjectRegistry } from './ProjectRegistry.js';
import { ResolutionResult, ExecutionContext } from './types.js';

export interface GitInspector {
  isGitRepo(path: string): boolean;
  getRemoteUrl(path: string): string | null;
  getCurrentBranch(path: string): string | null;
  getLastCommit(path: string): string | null;
}

export class DefaultGitInspector implements GitInspector {
  isGitRepo(path: string): boolean {
    try {
      const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: path,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8'
      });
      return out.trim() === 'true';
    } catch {
      return false;
    }
  }

  getRemoteUrl(path: string): string | null {
    try {
      const out = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
        cwd: path,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8'
      });
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  getCurrentBranch(path: string): string | null {
    try {
      const out = execFileSync('git', ['branch', '--show-current'], {
        cwd: path,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8'
      });
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  getLastCommit(path: string): string | null {
    try {
      const out = execFileSync('git', ['log', '-1', '--oneline'], {
        cwd: path,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8'
      });
      return out.trim() || null;
    } catch {
      return null;
    }
  }
}

export class WorkspaceResolver {
  constructor(
    private readonly registry?: IProjectRegistry,
    private readonly gitInspector: GitInspector = new DefaultGitInspector()
  ) {}

  resolveWorkspace(
    rawPath: string,
    options: {
      runId?: string;
      taskId?: string;
      targetBranch?: string;
      trigger?: string;
      actor?: string;
      parentRunId?: string;
    } = {}
  ): ResolutionResult {
    // 1. Resolve path existence
    if (!existsSync(rawPath)) {
      return {
        ok: false,
        reason: 'WORKSPACE_NOT_FOUND',
        message: `Workspace directory does not exist: '${rawPath}'`,
        details: { workspacePath: rawPath }
      };
    }

    // 2. Is directory
    try {
      const stat = statSync(rawPath);
      if (!stat.isDirectory()) {
        return {
          ok: false,
          reason: 'WORKSPACE_INVALID',
          message: `Workspace path is not a directory: '${rawPath}'`,
          details: { workspacePath: rawPath }
        };
      }
    } catch (err: any) {
      return {
        ok: false,
        reason: 'WORKSPACE_INVALID',
        message: `Failed to inspect workspace path: ${err.message}`,
        details: { workspacePath: rawPath }
      };
    }

    // 3. Is Git repository
    if (!this.gitInspector.isGitRepo(rawPath)) {
      return {
        ok: false,
        reason: 'NOT_A_GIT_REPOSITORY',
        message: `Workspace '${rawPath}' is not a valid Git repository.`,
        details: { workspacePath: rawPath }
      };
    }

    // 4. Git remote and branch inspection
    const actualRemote = this.gitInspector.getRemoteUrl(rawPath);
    if (!actualRemote) {
      return {
        ok: false,
        reason: 'WORKSPACE_REPOSITORY_MISMATCH',
        message: `Workspace '${rawPath}' has no origin remote configured.`,
        details: {
          expectedRepo: undefined,
          actualRepo: undefined,
          workspacePath: rawPath
        }
      };
    }

    const actualBranch = this.gitInspector.getCurrentBranch(rawPath);
    if (options.targetBranch && actualBranch && actualBranch !== options.targetBranch) {
      return {
        ok: false,
        reason: 'WORKSPACE_BRANCH_MISMATCH',
        message: `Workspace branch mismatch! Expected branch '${options.targetBranch}', but current branch is '${actualBranch}'.`,
        details: {
          expectedBranch: options.targetBranch,
          actualBranch,
          workspacePath: rawPath
        }
      };
    }

    // 5. Derive clean projectId & projectName from repository origin or path
    const normalizeRepo = (url: string) =>
      url.replace(/^git@github\.com:/, '')
         .replace(/^https:\/\/github\.com\//, '')
         .replace(/\.git$/, '')
         .trim();

    const repoSlug = normalizeRepo(actualRemote);
    const projectId = repoSlug.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const projectName = repoSlug || 'Generic Workspace';

    // 6. Construct ExecutionContext
    const runId = options.runId || `run-${randomUUID()}`;
    const taskId = options.taskId || `task-${randomUUID().slice(0, 8)}`;
    const lastCommit = this.gitInspector.getLastCommit(rawPath) || undefined;

    const context: ExecutionContext = {
      runId,
      taskId,
      projectId,
      projectName,
      workspacePath: rawPath,
      repository: actualRemote,
      branch: actualBranch || options.targetBranch || 'main',
      commit: lastCommit,
      trigger: options.trigger || 'cli',
      parentRunId: options.parentRunId,
      actor: options.actor || 'developer'
    };

    return {
      ok: true,
      context
    };
  }

  resolve(
    projectId: string,
    options: {
      runId?: string;
      taskId?: string;
      targetBranch?: string;
      trigger?: string;
      actor?: string;
      parentRunId?: string;
    } = {}
  ): ResolutionResult {
    // 6.1 Project existence
    if (!this.registry) {
      return {
        ok: false,
        reason: 'UNKNOWN_PROJECT',
        message: 'No ProjectRegistry configured in WorkspaceResolver.',
        details: { projectId }
      };
    }
    const project = this.registry.getProject(projectId);
    if (!project) {
      return {
        ok: false,
        reason: 'UNKNOWN_PROJECT',
        message: `Project '${projectId}' is not registered in ProjectRegistry.`,
        details: { projectId }
      };
    }

    // 6.2 Project enabled
    if (!project.enabled) {
      return {
        ok: false,
        reason: 'PROJECT_DISABLED',
        message: `Project '${projectId}' is disabled in ProjectRegistry.`,
        details: { projectId, projectName: project.projectName }
      };
    }

    // 6.3 Workspace exists
    if (!existsSync(project.workspacePath)) {
      return {
        ok: false,
        reason: 'WORKSPACE_NOT_FOUND',
        message: `Workspace directory does not exist: '${project.workspacePath}'`,
        details: { workspacePath: project.workspacePath }
      };
    }

    // 6.4 Is directory
    try {
      const stat = statSync(project.workspacePath);
      if (!stat.isDirectory()) {
        return {
          ok: false,
          reason: 'WORKSPACE_INVALID',
          message: `Workspace path is not a directory: '${project.workspacePath}'`,
          details: { workspacePath: project.workspacePath }
        };
      }
    } catch (err: any) {
      return {
        ok: false,
        reason: 'WORKSPACE_INVALID',
        message: `Failed to inspect workspace path: ${err.message}`,
        details: { workspacePath: project.workspacePath }
      };
    }

    // 6.5 Is Git repository
    if (!this.gitInspector.isGitRepo(project.workspacePath)) {
      return {
        ok: false,
        reason: 'NOT_A_GIT_REPOSITORY',
        message: `Workspace '${project.workspacePath}' is not a valid Git repository.`,
        details: { workspacePath: project.workspacePath }
      };
    }

    // 6.6 Repository remote corresponds
    const actualRemote = this.gitInspector.getRemoteUrl(project.workspacePath);
    if (!actualRemote) {
      return {
        ok: false,
        reason: 'WORKSPACE_REPOSITORY_MISMATCH',
        message: `Workspace '${project.workspacePath}' has no origin remote configured. Expected '${project.repository}'.`,
        details: {
          expectedRepo: project.repository,
          actualRepo: undefined,
          workspacePath: project.workspacePath
        }
      };
    }

    const normalizeRepo = (url: string) =>
      url.replace(/^git@github\.com:/, 'https://github.com/')
         .replace(/\.git$/, '')
         .toLowerCase();

    if (!normalizeRepo(actualRemote).includes(normalizeRepo(project.repository))) {
      return {
        ok: false,
        reason: 'WORKSPACE_REPOSITORY_MISMATCH',
        message: `Workspace repository mismatch! Expected '${project.repository}', found '${actualRemote}'.`,
        details: {
          expectedRepo: project.repository,
          actualRepo: actualRemote,
          workspacePath: project.workspacePath
        }
      };
    }

    // 6.7 Branch verification
    const expectedBranch = options.targetBranch || project.defaultBranch;
    const actualBranch = this.gitInspector.getCurrentBranch(project.workspacePath);
    if (expectedBranch && actualBranch && actualBranch !== expectedBranch) {
      return {
        ok: false,
        reason: 'WORKSPACE_BRANCH_MISMATCH',
        message: `Workspace branch mismatch! Expected branch '${expectedBranch}', but current branch is '${actualBranch}'.`,
        details: {
          expectedBranch,
          actualBranch,
          workspacePath: project.workspacePath
        }
      };
    }

    // 6.8 Construct ExecutionContext
    const runId = options.runId || `run-${randomUUID()}`;
    const taskId = options.taskId || `task-${randomUUID().slice(0, 8)}`;
    const lastCommit = this.gitInspector.getLastCommit(project.workspacePath) || undefined;

    const context: ExecutionContext = {
      runId,
      taskId,
      projectId: project.projectId,
      projectName: project.projectName,
      workspacePath: project.workspacePath,
      repository: project.repository,
      branch: actualBranch || expectedBranch,
      commit: lastCommit,
      trigger: options.trigger || 'manual',
      parentRunId: options.parentRunId,
      actor: options.actor || 'system'
    };

    return {
      ok: true,
      context
    };
  }
}
