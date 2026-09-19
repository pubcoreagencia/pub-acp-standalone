import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface WorkspaceCommandRequest {
  workspacePath: string;
  command: string;
  timeoutMs?: number;
  runId?: string;
  onOutput?: (chunk: string) => void;
}

export interface WorkspaceCommandResult {
  runId: string;
  status: 'COMPLETED' | 'FAILED' | 'TIMEOUT';
  output: string;
  exitCode: number | null;
  durationMs: number;
}

function normalizeForInspection(value: string): string {
  return value.replace(/\u0000/g, '').trim();
}

function hasShellNavigationEscape(command: string): boolean {
  const navigation = /(?:^|[;&|]\s*)(?:cd(?:\s|\.\.)|chdir\b|pushd\b|set-location\b|sl\b)/i;
  return navigation.test(command);
}

function hasExplicitAbsolutePath(command: string): boolean {
  const unixAbsolute = /(?:^|[\s"'=(>])\/(?!\/|\*)/;
  const windowsDrive = /(?:^|[\s"'=(>])[A-Za-z]:[\\/]/;
  const uncPath = /(?:^|[\s"'=(>])\\\\[^\s"'<>|]+/;
  return unixAbsolute.test(command) || windowsDrive.test(command) || uncPath.test(command);
}

function hasParentTraversal(command: string): boolean {
  return /(?:^|[\s"'=(>])\.\.(?:[\\/]|$)/.test(command);
}

export function validateWorkspaceCommand(command: string): string | null {
  const normalized = normalizeForInspection(command);

  if (!normalized) {
    return 'Command is empty.';
  }

  if (hasShellNavigationEscape(normalized)) {
    return 'Command rejected: shell directory navigation is not allowed.';
  }

  if (hasParentTraversal(normalized)) {
    return 'Command rejected: parent-directory traversal is not allowed.';
  }

  if (hasExplicitAbsolutePath(normalized)) {
    return 'Command rejected: explicit absolute or UNC filesystem paths are not allowed.';
  }

  return null;
}

export class WorkspaceCommandExecutor {
  async execute(request: WorkspaceCommandRequest): Promise<WorkspaceCommandResult> {
    const started = Date.now();
    const runId = request.runId || `cmd-${randomUUID()}`;
    const workspacePath = path.resolve(request.workspacePath);

    const commandError = validateWorkspaceCommand(request.command || '');
    if (commandError) {
      return {
        runId,
        status: 'FAILED',
        output: commandError,
        exitCode: null,
        durationMs: Date.now() - started
      };
    }

    return new Promise(resolve => {
      const child = spawn(request.command, {
        cwd: workspacePath,
        shell: true,
        windowsHide: true
      });

      let output = '';
      let settled = false;

      const finish = (
        status: WorkspaceCommandResult['status'],
        exitCode: number | null,
        extra = ''
      ) => {
        if (settled) return;
        settled = true;
        if (extra) output += extra;
        resolve({
          runId,
          status,
          output,
          exitCode,
          durationMs: Date.now() - started
        });
      };

      const append = (chunk: Buffer | string) => {
        const text = chunk.toString();
        output += text;
        request.onOutput?.(text);
      };

      child.stdout.on('data', append);
      child.stderr.on('data', append);
      child.on('error', error => finish('FAILED', null, `\nProcess error: ${error.message}`));
      child.on('close', code => finish(code === 0 ? 'COMPLETED' : 'FAILED', code));

      const timeoutMs = request.timeoutMs ?? 300000;
      const timer = setTimeout(() => {
        child.kill();
        finish('TIMEOUT', null, `\nCommand timed out after ${timeoutMs}ms.`);
      }, timeoutMs);

      child.on('close', () => clearTimeout(timer));
      child.on('error', () => clearTimeout(timer));
    });
  }
}
