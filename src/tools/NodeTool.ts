import { IToolAdapter, ToolCategory, ToolResult } from './types.js';
import { ExecutionCapability } from '../actions/types.js';
import { NodeProcessSandbox } from '../actions/sandbox/NodeProcessSandbox.js';

export class NodeTool implements IToolAdapter {
  readonly name: ToolCategory = 'node';
  readonly supportedOperations = ['eval', 'run'];
  private readonly sandbox = new NodeProcessSandbox();

  getRequiredCapability(_operation: string, _args: Record<string, unknown>): ExecutionCapability {
    return 'node.exec';
  }

  execute(workspaceRoot: string, operation: string, args: Record<string, unknown>): ToolResult {
    const start = Date.now();
    const capability = this.getRequiredCapability(operation, args);

    let argv: string[] = [];
    if (operation === 'eval') {
      const code = String(args.code || '');
      argv = ['-e', code];
    } else if (operation === 'run') {
      const script = String(args.script || '');
      argv = [script];
      if (Array.isArray(args.args)) {
        argv.push(...args.args.map(String));
      }
    } else {
      return {
        tool: this.name,
        operation,
        capability,
        status: 'FAILED',
        stderr: `Unsupported node operation "${operation}"`,
        durationMs: Date.now() - start
      };
    }

    const sandboxCtx = this.sandbox.prepare(workspaceRoot, [capability, 'workspace.read', 'workspace.write']);
    const res = this.sandbox.execute(sandboxCtx, 'node', argv, {
      cwd: workspaceRoot,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 25000
    });

    return {
      tool: this.name,
      operation,
      capability,
      status: res.blockedReason ? 'BLOCKED' : res.success ? 'SUCCESS' : 'FAILED',
      exitCode: res.exitCode,
      stdout: res.stdout.trim(),
      stderr: res.stderr.trim(),
      output: res.stdout.trim(),
      blockedReason: res.blockedReason,
      durationMs: Date.now() - start,
      metadata: {
        isSandboxed: res.isSandboxed,
        provider: res.provider,
        platform: res.platform
      }
    };
  }
}
