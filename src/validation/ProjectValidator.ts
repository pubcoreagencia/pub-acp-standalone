import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import {
  IProjectValidator,
  ValidationMode,
  ValidationOutcome,
  ValidationPolicy
} from './types.js';

const execAsync = promisify(exec);

export interface ProjectValidatorConfig {
  maxBufferBytes?: number;
}

export class ProjectValidator implements IProjectValidator {
  private readonly maxBufferBytes: number;

  constructor(config: ProjectValidatorConfig = {}) {
    this.maxBufferBytes = config.maxBufferBytes ?? 10 * 1024 * 1024;
  }

  async validate(
    workspacePath: string,
    policy: ValidationPolicy,
    context?: { runId: string; turn: number }
  ): Promise<ValidationOutcome> {
    const startedAt = Date.now();

    if (policy.mode === 'NONE') {
      return this.outcome(
        'SKIPPED',
        'Validation disabled by policy.',
        startedAt
      );
    }

    if (!policy.command?.trim()) {
      if (policy.mode === 'OPTIONAL') {
        return this.outcome(
          'SKIPPED',
          'Optional validation has no command configured.',
          startedAt
        );
      }

      return this.outcome(
        'ERROR',
        'Required validation has no command configured.',
        startedAt
      );
    }

    try {
      const workspace = await stat(workspacePath);
      if (!workspace.isDirectory()) {
        return this.outcome(
          'ERROR',
          `Validation workspace is not a directory: ${workspacePath}`,
          startedAt
        );
      }
    } catch (error: any) {
      return this.outcome(
        'ERROR',
        `Validation workspace is unavailable: ${workspacePath}`,
        startedAt,
        undefined,
        error?.message
      );
    }

    try {
      const result = await execAsync(policy.command, {
        cwd: workspacePath,
        timeout: policy.timeoutMs,
        maxBuffer: this.maxBufferBytes,
        windowsHide: true
      });

      const details = [result.stdout, result.stderr]
        .filter(Boolean)
        .join('\n')
        .trim();

      return this.outcome(
        'PASS',
        `Validation command passed: ${policy.command}`,
        startedAt,
        0,
        details || undefined,
        context
      );
    } catch (error: any) {
      const timedOut =
        error?.killed === true ||
        error?.signal === 'SIGTERM' ||
        error?.code === 'ETIMEDOUT';

      const exitCode =
        typeof error?.code === 'number' ? error.code :
        typeof error?.status === 'number' ? error.status :
        null;

      const details = [error?.stdout, error?.stderr, error?.message]
        .filter(Boolean)
        .join('\n')
        .trim();

      return this.outcome(
        timedOut ? 'ERROR' : 'FAIL',
        timedOut
          ? `Validation timed out after ${policy.timeoutMs ?? 'configured'}ms: ${policy.command}`
          : `Validation command failed: ${policy.command}`,
        startedAt,
        exitCode,
        details || undefined,
        context
      );
    }
  }

  private outcome(
    status: ValidationOutcome['status'],
    summary: string,
    startedAt: number,
    exitCode?: number | null,
    details?: string,
    context?: { runId: string; turn: number }
  ): ValidationOutcome {
    const contextualDetails = context
      ? `runId=${context.runId}; turn=${context.turn}`
      : undefined;

    return {
      status,
      exitCode,
      summary,
      details: [contextualDetails, details].filter(Boolean).join('\n') || undefined,
      durationMs: Date.now() - startedAt
    };
  }
}
