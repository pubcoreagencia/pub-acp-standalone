import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { IToolAdapter, ToolCategory, ToolResult } from './types.js';
import { ExecutionCapability } from '../actions/types.js';

export class NpmTool implements IToolAdapter {
  readonly name: ToolCategory = 'npm';
  readonly supportedOperations = ['test', 'build', 'run'];

  // Explicit allowlist of permissible npm run targets to prevent arbitrary shell disguise
  private static readonly DANGEROUS_SCRIPT_PATTERNS = [
    /(\brm\s+-rf\b|\bdd\b|\bmkfs\b|\bformat\b)/i,
    /(\bcurl\b|\bwget\b|\bnc\b|\bsh\b|\bbash\b)\s+.*\|/i
  ];

  getRequiredCapability(operation: string, _args: Record<string, unknown>): ExecutionCapability {
    switch (operation) {
      case 'test':
        return 'npm.test';
      case 'build':
        return 'npm.build';
      case 'run':
      default:
        return 'npm.run';
    }
  }

  private validateScript(
    workspaceRoot: string,
    scriptName: string
  ): { ok: boolean; scriptContent?: string; error?: string } {
    const pkgPath = path.join(workspaceRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return { ok: false, error: 'package.json not found in workspace' };
    }
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (!pkg.scripts || typeof pkg.scripts[scriptName] !== 'string') {
        return {
          ok: false,
          error: `Script "${scriptName}" does not exist in package.json scripts [${Object.keys(pkg.scripts || {}).join(', ')}]`
        };
      }

      const scriptContent = pkg.scripts[scriptName].trim();

      // Guardrail against catastrophic script payloads
      for (const pat of NpmTool.DANGEROUS_SCRIPT_PATTERNS) {
        if (pat.test(scriptContent)) {
          return {
            ok: false,
            error: `Script "${scriptName}" contained potentially dangerous pattern in package.json: "${scriptContent}"`
          };
        }
      }

      return { ok: true, scriptContent };
    } catch (err: any) {
      return { ok: false, error: `Failed to parse package.json: ${err.message}` };
    }
  }

  execute(workspaceRoot: string, operation: string, args: Record<string, unknown>): ToolResult {
    const start = Date.now();
    const capability = this.getRequiredCapability(operation, args);

    let scriptToRun = operation;
    if (operation === 'run') {
      const scriptName = String(args.script || '').trim();
      if (!scriptName) {
        return {
          tool: this.name,
          operation,
          capability,
          status: 'FAILED',
          stderr: 'npm.run requires a non-empty "script" argument',
          durationMs: Date.now() - start
        };
      }
      const val = this.validateScript(workspaceRoot, scriptName);
      if (!val.ok) {
        return {
          tool: this.name,
          operation,
          capability,
          status: 'BLOCKED',
          blockedReason: 'NPM_SCRIPT_NOT_ALLOWED',
          stderr: val.error,
          durationMs: Date.now() - start
        };
      }
      scriptToRun = scriptName;
    } else {
      // test or build
      const val = this.validateScript(workspaceRoot, operation);
      if (!val.ok) {
        return {
          tool: this.name,
          operation,
          capability,
          status: 'FAILED',
          stderr: val.error,
          durationMs: Date.now() - start
        };
      }
    }

    const scriptInfo = this.validateScript(workspaceRoot, scriptToRun);

    const argv = ['run', scriptToRun];
    if (Array.isArray(args.args)) {
      argv.push('--', ...args.args.map(String));
    }

    try {
      const stdout = execFileSync('npm', argv, {
        cwd: workspaceRoot,
        timeout: 45000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });

      return {
        tool: this.name,
        operation,
        capability,
        status: 'SUCCESS',
        exitCode: 0,
        stdout: stdout.trim(),
        output: stdout.trim(),
        durationMs: Date.now() - start,
        metadata: {
          scriptName: scriptToRun,
          scriptContent: scriptInfo.scriptContent,
          npmInternalShellWarning: 'npm runs package.json scripts via subshell internally'
        }
      };
    } catch (err: any) {
      return {
        tool: this.name,
        operation,
        capability,
        status: 'FAILED',
        exitCode: typeof err.status === 'number' ? err.status : 1,
        stderr: err.stderr ? String(err.stderr).trim() : err.message,
        stdout: err.stdout ? String(err.stdout).trim() : '',
        durationMs: Date.now() - start,
        metadata: {
          scriptName: scriptToRun,
          scriptContent: scriptInfo.scriptContent
        }
      };
    }
  }
}
