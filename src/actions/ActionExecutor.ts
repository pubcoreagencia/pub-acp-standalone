import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ActionDirective, ActionResult, ActionBatchExecutionResult } from './types.js';

export interface ActionExecutorOptions {
  allowExec?: boolean;
  execTimeoutMs?: number;
}

export class ActionExecutor {
  private readonly allowExec: boolean;
  private readonly execTimeoutMs: number;

  // Deny list of dangerous command prefixes or tokens when EXEC is enabled
  private static readonly BLOCKED_PATTERNS = [
    /(\b|\/)(rm\s+-rf\s+[\/~]|\bformat\b|\bdd\b|\bmkfs\b)/i,
    /(\bshutdown\b|\breboot\b|\binit\s+0\b)/i,
    /(>\s*\/dev\/sd[a-z]|>\s*\/dev\/nvme)/i
  ];

  constructor(options: ActionExecutorOptions = {}) {
    this.allowExec = options.allowExec ?? true;
    this.execTimeoutMs = options.execTimeoutMs ?? 30000;
  }

  /**
   * Fail-closed path validator. Guarantees target is strictly inside workspaceRoot.
   */
  resolvePathInsideWorkspace(workspaceRoot: string, targetPath: string): { ok: boolean; resolvedPath?: string; error?: string } {
    if (!targetPath || typeof targetPath !== 'string') {
      return { ok: false, error: 'Path must be a non-empty string' };
    }

    const trimmed = targetPath.trim();
    if (!trimmed) {
      return { ok: false, error: 'Path cannot be blank' };
    }

    // Resolve relative or absolute path against workspaceRoot
    const resolved = path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(workspaceRoot, trimmed);

    // Compute relative path from workspace root
    const rel = path.relative(workspaceRoot, resolved);

    // Fail-closed checks:
    // 1. Cannot escape up (starts with .. or ..[/\\])
    // 2. Cannot be an external absolute path (on Windows C: vs D:)
    // 3. Cannot be the workspace directory itself for file operations
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
      return {
        ok: false,
        error: `Path traversal violation: path "${trimmed}" resolves to "${resolved}" which is outside workspace "${workspaceRoot}"`
      };
    }

    return { ok: true, resolvedPath: resolved };
  }

  executeAction(workspaceRoot: string, action: ActionDirective): ActionResult {
    switch (action.type) {
      case 'FILE_CREATE':
      case 'FILE_WRITE': {
        const check = this.resolvePathInsideWorkspace(workspaceRoot, action.path);
        if (!check.ok || !check.resolvedPath) {
          return { action, status: 'BLOCKED', error: check.error };
        }
        try {
          fs.mkdirSync(path.dirname(check.resolvedPath), { recursive: true });
          fs.writeFileSync(check.resolvedPath, action.content, 'utf8');
          return {
            action,
            status: 'SUCCESS',
            output: `Wrote ${Buffer.byteLength(action.content, 'utf8')} bytes to ${action.path}`
          };
        } catch (err: any) {
          return { action, status: 'FAILED', error: err.message };
        }
      }

      case 'FILE_READ': {
        const check = this.resolvePathInsideWorkspace(workspaceRoot, action.path);
        if (!check.ok || !check.resolvedPath) {
          return { action, status: 'BLOCKED', error: check.error };
        }
        try {
          if (!fs.existsSync(check.resolvedPath)) {
            return { action, status: 'FAILED', error: `File not found: ${action.path}` };
          }
          const content = fs.readFileSync(check.resolvedPath, 'utf8');
          return { action, status: 'SUCCESS', output: content };
        } catch (err: any) {
          return { action, status: 'FAILED', error: err.message };
        }
      }

      case 'FILE_DELETE': {
        const check = this.resolvePathInsideWorkspace(workspaceRoot, action.path);
        if (!check.ok || !check.resolvedPath) {
          return { action, status: 'BLOCKED', error: check.error };
        }
        try {
          if (fs.existsSync(check.resolvedPath)) {
            fs.unlinkSync(check.resolvedPath);
            return { action, status: 'SUCCESS', output: `Deleted ${action.path}` };
          }
          return { action, status: 'SUCCESS', output: `File already absent: ${action.path}` };
        } catch (err: any) {
          return { action, status: 'FAILED', error: err.message };
        }
      }

      case 'EXEC': {
        if (!this.allowExec) {
          return { action, status: 'BLOCKED', error: 'EXEC command is disabled by configuration' };
        }
        const cmd = action.command.trim();
        if (!cmd) {
          return { action, status: 'FAILED', error: 'Command is empty' };
        }

        // Check blocked patterns
        for (const pattern of ActionExecutor.BLOCKED_PATTERNS) {
          if (pattern.test(cmd)) {
            return { action, status: 'BLOCKED', error: `Dangerous command pattern detected and blocked: "${cmd}"` };
          }
        }

        try {
          const stdout = execSync(cmd, {
            cwd: workspaceRoot,
            timeout: this.execTimeoutMs,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
              ...process.env,
              PWD: workspaceRoot
            }
          });
          return { action, status: 'SUCCESS', output: stdout };
        } catch (err: any) {
          const stdout = err.stdout ? String(err.stdout) : '';
          const stderr = err.stderr ? String(err.stderr) : '';
          const msg = stderr.trim() || stdout.trim() || err.message;
          return { action, status: 'FAILED', error: msg, output: stdout };
        }
      }

      default: {
        return { action: action as any, status: 'BLOCKED', error: `Unknown action type` };
      }
    }
  }

  executeBatch(workspaceRoot: string, actions: ActionDirective[]): ActionBatchExecutionResult {
    const results: ActionResult[] = [];
    const appliedFiles: string[] = [];
    const readFiles: Record<string, string> = {};
    const deletedFiles: string[] = [];
    const executedCommands: Array<{ command: string; exitCode: number; stdout: string; stderr: string }> = [];

    for (const action of actions) {
      const res = this.executeAction(workspaceRoot, action);
      results.push(res);

      if (action.type === 'FILE_CREATE' || action.type === 'FILE_WRITE') {
        if (res.status === 'SUCCESS') appliedFiles.push(action.path);
      } else if (action.type === 'FILE_READ') {
        if (res.status === 'SUCCESS' && res.output !== undefined) {
          readFiles[action.path] = res.output;
        }
      } else if (action.type === 'FILE_DELETE') {
        if (res.status === 'SUCCESS') deletedFiles.push(action.path);
      } else if (action.type === 'EXEC') {
        executedCommands.push({
          command: action.command,
          exitCode: res.status === 'SUCCESS' ? 0 : 1,
          stdout: res.output || '',
          stderr: res.error || ''
        });
      }
    }

    // Build human/model readable summary
    const summaryLines: string[] = [];
    if (appliedFiles.length > 0) {
      summaryLines.push(`[ACTION_STATUS: Arquivos gravados com sucesso: ${appliedFiles.join(', ')}]`);
    }
    for (const [fPath, content] of Object.entries(readFiles)) {
      summaryLines.push(`[FILE_CONTENT: ${fPath}]\n${content}\n[/FILE_CONTENT]`);
    }
    if (deletedFiles.length > 0) {
      summaryLines.push(`[ACTION_STATUS: Arquivos removidos: ${deletedFiles.join(', ')}]`);
    }
    for (const cmd of executedCommands) {
      if (cmd.exitCode === 0) {
        summaryLines.push(`[EXEC_RESULT: ${cmd.command}]\n${cmd.stdout}\n[/EXEC_RESULT]`);
      } else {
        summaryLines.push(`[EXEC_ERROR: ${cmd.command}]\n${cmd.stderr}\n[/EXEC_ERROR]`);
      }
    }
    for (const r of results) {
      if (r.status === 'BLOCKED') {
        summaryLines.push(`[SECURITY_BLOCKED: ${(r.action as any).path || (r.action as any).command} - ${r.error}]`);
      } else if (r.status === 'FAILED' && r.action.type !== 'EXEC') {
        summaryLines.push(`[ACTION_ERROR: ${(r.action as any).path} - ${r.error}]`);
      }
    }

    return {
      results,
      appliedFiles,
      readFiles,
      deletedFiles,
      executedCommands,
      summary: summaryLines.join('\n')
    };
  }
}
