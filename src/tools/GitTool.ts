import { execFileSync } from 'node:child_process';
import { IToolAdapter, ToolCategory, ToolResult } from './types.js';
import { ExecutionCapability } from '../actions/types.js';

export class GitTool implements IToolAdapter {
  readonly name: ToolCategory = 'git';
  readonly supportedOperations = [
    'status',
    'diff',
    'log',
    'branch',
    'add',
    'commit',
    'push'
  ];

  getRequiredCapability(operation: string, _args: Record<string, unknown>): ExecutionCapability {
    switch (operation) {
      case 'status':
      case 'diff':
      case 'log':
      case 'branch':
        return 'git.read';
      case 'add':
      case 'commit':
      case 'push':
      default:
        return 'git.mutate';
    }
  }

  execute(workspaceRoot: string, operation: string, args: Record<string, unknown>): ToolResult {
    const start = Date.now();
    const capability = this.getRequiredCapability(operation, args);

    let argv: string[] = [];
    switch (operation) {
      case 'status':
        argv = ['status', '--short'];
        break;
      case 'diff':
        argv = ['diff'];
        if (typeof args.staged === 'boolean' && args.staged) {
          argv.push('--staged');
        }
        break;
      case 'log': {
        const count = typeof args.n === 'number' ? Math.min(args.n, 50) : 5;
        argv = ['log', `-${count}`, '--oneline'];
        break;
      }
      case 'branch':
        argv = ['branch', '--show-current'];
        break;
      case 'add': {
        const file = typeof args.path === 'string' ? args.path : '.';
        argv = ['add', file];
        break;
      }
      case 'commit': {
        const msg = typeof args.message === 'string' ? args.message : 'commit via ACP';
        argv = ['commit', '-m', msg];
        break;
      }
      case 'push': {
        const remote = typeof args.remote === 'string' ? args.remote : 'origin';
        const branch = typeof args.branch === 'string' ? args.branch : 'HEAD';
        argv = ['push', remote, branch];
        break;
      }
      default:
        return {
          tool: this.name,
          operation,
          capability,
          status: 'FAILED',
          stderr: `Unsupported git operation "${operation}"`,
          durationMs: Date.now() - start
        };
    }

    try {
      const stdout = execFileSync('git', argv, {
        cwd: workspaceRoot,
        timeout: 15000,
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
        durationMs: Date.now() - start
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
        durationMs: Date.now() - start
      };
    }
  }
}
