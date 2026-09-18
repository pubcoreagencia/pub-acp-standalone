import fs from 'node:fs';
import path from 'node:path';
import { IToolAdapter, ToolCategory, ToolResult } from './types.js';
import { ExecutionCapability } from '../actions/types.js';

export class WorkspaceTool implements IToolAdapter {
  readonly name: ToolCategory = 'workspace';
  readonly supportedOperations = ['read', 'write', 'delete', 'list'];

  getRequiredCapability(operation: string, _args: Record<string, unknown>): ExecutionCapability {
    switch (operation) {
      case 'read':
        return 'workspace.read';
      case 'write':
      case 'create':
        return 'workspace.write';
      case 'delete':
        return 'workspace.delete';
      case 'list':
        return 'workspace.list';
      default:
        return 'workspace.read';
    }
  }

  private resolvePathInsideWorkspace(
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

    const resolved = path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(workspaceRoot, trimmed);

    const rel = path.relative(workspaceRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
      return {
        ok: false,
        error: `Path traversal violation: path "${trimmed}" resolves outside workspace "${workspaceRoot}"`
      };
    }

    try {
      if (fs.existsSync(workspaceRoot)) {
        const canonicalWorkspace = fs.realpathSync(workspaceRoot);
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
              error: `Symlink escape violation: path "${trimmed}" resolves to "${canonicalCurr}" outside workspace`
            };
          }
        }
      }
    } catch (err: any) {
      return { ok: false, error: `Filesystem check failed: ${err.message}` };
    }

    return { ok: true, resolvedPath: resolved };
  }

  execute(workspaceRoot: string, operation: string, args: Record<string, unknown>): ToolResult {
    const start = Date.now();
    const capability = this.getRequiredCapability(operation, args);

    if (operation === 'read') {
      const relPath = String(args.path || '');
      const check = this.resolvePathInsideWorkspace(workspaceRoot, relPath);
      if (!check.ok || !check.resolvedPath) {
        return {
          tool: this.name,
          operation,
          capability,
          status: 'BLOCKED',
          blockedReason: 'PATH_SECURITY_VIOLATION',
          stderr: check.error,
          durationMs: Date.now() - start
        };
      }
      if (!fs.existsSync(check.resolvedPath)) {
        return {
          tool: this.name,
          operation,
          capability,
          status: 'FAILED',
          stderr: `File not found: ${relPath}`,
          durationMs: Date.now() - start
        };
      }
      const content = fs.readFileSync(check.resolvedPath, 'utf8');
      return {
        tool: this.name,
        operation,
        capability,
        status: 'SUCCESS',
        stdout: content,
        output: content,
        durationMs: Date.now() - start
      };
    }

    if (operation === 'write' || operation === 'create') {
      const relPath = String(args.path || '');
      const content = typeof args.content === 'string' ? args.content : '';
      const check = this.resolvePathInsideWorkspace(workspaceRoot, relPath);
      if (!check.ok || !check.resolvedPath) {
        return {
          tool: this.name,
          operation,
          capability,
          status: 'BLOCKED',
          blockedReason: 'PATH_SECURITY_VIOLATION',
          stderr: check.error,
          durationMs: Date.now() - start
        };
      }
      fs.mkdirSync(path.dirname(check.resolvedPath), { recursive: true });
      fs.writeFileSync(check.resolvedPath, content, 'utf8');
      const bytes = Buffer.byteLength(content, 'utf8');
      return {
        tool: this.name,
        operation,
        capability,
        status: 'SUCCESS',
        stdout: `Wrote ${bytes} bytes to ${relPath}`,
        output: { path: relPath, bytes },
        durationMs: Date.now() - start
      };
    }

    if (operation === 'delete') {
      const relPath = String(args.path || '');
      const check = this.resolvePathInsideWorkspace(workspaceRoot, relPath);
      if (!check.ok || !check.resolvedPath) {
        return {
          tool: this.name,
          operation,
          capability,
          status: 'BLOCKED',
          blockedReason: 'PATH_SECURITY_VIOLATION',
          stderr: check.error,
          durationMs: Date.now() - start
        };
      }
      if (fs.existsSync(check.resolvedPath)) {
        fs.unlinkSync(check.resolvedPath);
      }
      return {
        tool: this.name,
        operation,
        capability,
        status: 'SUCCESS',
        stdout: `Deleted ${relPath}`,
        output: { path: relPath, deleted: true },
        durationMs: Date.now() - start
      };
    }

    if (operation === 'list') {
      const relPath = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '.';
      const check = this.resolvePathInsideWorkspace(workspaceRoot, relPath === '.' ? '' : relPath);
      const targetDir = check.resolvedPath || workspaceRoot;
      if (!fs.existsSync(targetDir)) {
        return {
          tool: this.name,
          operation,
          capability,
          status: 'FAILED',
          stderr: `Directory not found: ${relPath}`,
          durationMs: Date.now() - start
        };
      }
      const files = fs.readdirSync(targetDir);
      return {
        tool: this.name,
        operation,
        capability,
        status: 'SUCCESS',
        stdout: files.join('\n'),
        output: files,
        durationMs: Date.now() - start
      };
    }

    return {
      tool: this.name,
      operation,
      capability,
      status: 'FAILED',
      stderr: `Unknown operation "${operation}" on tool "${this.name}"`,
      durationMs: Date.now() - start
    };
  }
}
