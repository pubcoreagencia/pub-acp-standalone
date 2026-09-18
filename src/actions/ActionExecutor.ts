import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  ActionDirective,
  ActionResult,
  ActionBatchExecutionResult,
  ActionPolicy,
  ExecutedCommandResult
} from './types.js';

export interface ActionExecutorOptions {
  policy?: ActionPolicy;
  allowExec?: boolean;
  execTimeoutMs?: number;
}

export class ActionExecutor {
  private readonly policy: ActionPolicy;

  private static readonly BLOCKED_PATTERNS = [
    /(\b|\/)(rm\s+-rf\s+[\/~]|\bformat\b|\bdd\b|\bmkfs\b)/i,
    /(\bshutdown\b|\breboot\b|\binit\s+0\b)/i,
    /(>\s*\/dev\/sd[a-z]|>\s*\/dev\/nvme)/i
  ];

  constructor(options: ActionExecutorOptions = {}) {
    const defaultPolicy: ActionPolicy = {
      allowFileCreate: true,
      allowFileWrite: true,
      allowFileRead: true,
      allowFileDelete: true,
      allowExec: options.allowExec ?? options.policy?.allowExec ?? true,
      allowedExecCommands: options.policy?.allowedExecCommands,
      execTimeoutMs: options.execTimeoutMs ?? options.policy?.execTimeoutMs ?? 30000
    };

    this.policy = {
      ...defaultPolicy,
      ...options.policy
    };
  }

  getPolicy(): ActionPolicy {
    return { ...this.policy };
  }

  /**
   * Fail-closed path validator.
   * Guarantees target is strictly inside workspaceRoot and cannot escape via:
   * 1. Relative traversal (..)
   * 2. External absolute paths
   * 3. Symlink escape pointing outside the workspace boundary
   */
  resolvePathInsideWorkspace(
    workspaceRoot: string,
    targetPath: string
  ): { ok: boolean; resolvedPath?: string; error?: string } {
    if (!targetPath || typeof targetPath !== 'string') {
      return { ok: false, error: 'Path must be a non-empty string' };
    }

    const trimmed = targetPath.trim();
    if (!trimmed) {
      return { ok: false, error: 'Path cannot be blank' };
    }

    // 1. Resolve against workspaceRoot
    const resolved = path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(workspaceRoot, trimmed);

    // 2. Lexical relative path check
    const rel = path.relative(workspaceRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
      return {
        ok: false,
        error: `Path traversal violation: path "${trimmed}" resolves to "${resolved}" which is outside workspace "${workspaceRoot}"`
      };
    }

    // 3. Symlink Escape Protection (canonical realpath check)
    try {
      if (fs.existsSync(workspaceRoot)) {
        const canonicalWorkspace = fs.realpathSync(workspaceRoot);

        // Traverse up to find the closest existing filesystem node
        let curr = resolved;
        while (!fs.existsSync(curr) && curr !== path.dirname(curr)) {
          curr = path.dirname(curr);
        }

        if (fs.existsSync(curr)) {
          const canonicalCurr = fs.realpathSync(curr);
          const relCanonical = path.relative(canonicalWorkspace, canonicalCurr);
          if (relCanonical.startsWith('..') || path.isAbsolute(relCanonical)) {
            return {
              ok: false,
              error: `Symlink escape violation: path "${trimmed}" resolves via symlink to "${canonicalCurr}" which is outside workspace "${canonicalWorkspace}"`
            };
          }
        }
      }
    } catch (err: any) {
      return {
        ok: false,
        error: `Filesystem security verification failed for path "${trimmed}": ${err.message}`
      };
    }

    return { ok: true, resolvedPath: resolved };
  }

  /**
   * Validates command against explicit execution policy (allowlist & patterns).
   */
  isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
    if (!this.policy.allowExec) {
      return { allowed: false, reason: 'EXEC is disabled by policy (allowExec=false)' };
    }

    const trimmed = command.trim();
    if (!trimmed) {
      return { allowed: false, reason: 'Command is empty' };
    }

    // 1. Check blocked patterns (fail-closed guardrail against catastrophic commands)
    for (const pattern of ActionExecutor.BLOCKED_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { allowed: false, reason: `Dangerous command pattern detected and blocked: "${trimmed}"` };
      }
    }

    // 2. If allowedExecCommands list is configured, enforce strict allowlist
    if (this.policy.allowedExecCommands && this.policy.allowedExecCommands.length > 0) {
      const match = this.policy.allowedExecCommands.some(allowed => {
        const allowedTrim = allowed.trim();
        return trimmed === allowedTrim || trimmed.startsWith(`${allowedTrim} `);
      });

      if (!match) {
        return {
          allowed: false,
          reason: `Command "${trimmed}" is not in the allowedExecCommands policy allowlist`
        };
      }
    }

    return { allowed: true };
  }

  executeAction(workspaceRoot: string, action: ActionDirective): ActionResult {
    switch (action.type) {
      case 'FILE_CREATE': {
        if (!this.policy.allowFileCreate) {
          return { action, status: 'BLOCKED', error: 'FILE_CREATE is disabled by policy' };
        }
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

      case 'FILE_WRITE': {
        if (!this.policy.allowFileWrite) {
          return { action, status: 'BLOCKED', error: 'FILE_WRITE is disabled by policy' };
        }
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
        if (!this.policy.allowFileRead) {
          return { action, status: 'BLOCKED', error: 'FILE_READ is disabled by policy' };
        }
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
        if (!this.policy.allowFileDelete) {
          return { action, status: 'BLOCKED', error: 'FILE_DELETE is disabled by policy' };
        }
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
        const cmd = action.command.trim();
        const check = this.isCommandAllowed(cmd);
        if (!check.allowed) {
          return { action, status: 'BLOCKED', error: check.reason };
        }

        const timeoutMs = this.policy.execTimeoutMs ?? 30000;
        try {
          const stdout = execSync(cmd, {
            cwd: workspaceRoot,
            timeout: timeoutMs,
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
          const isTimeout = (err.killed && err.signal === 'SIGTERM') || err.code === 'ETIMEDOUT';
          const msg = isTimeout
            ? `Command timed out after ${timeoutMs}ms`
            : stderr.trim() || stdout.trim() || err.message;
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
    const executedCommands: ExecutedCommandResult[] = [];

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
