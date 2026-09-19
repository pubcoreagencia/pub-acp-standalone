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

export class WorkspaceCommandExecutor {
  async execute(request: WorkspaceCommandRequest): Promise<WorkspaceCommandResult> {
    const started = Date.now();
    const runId = request.runId || `cmd-${randomUUID()}`;
    const workspacePath = path.resolve(request.workspacePath);

    if (!request.command?.trim()) {
      return {
        runId,
        status: 'FAILED',
        output: 'Command is empty.',
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
