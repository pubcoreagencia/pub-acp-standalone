import { IToolAdapter, ToolCategory, ToolResult } from './types.js';
import { ExecutionCapability } from '../actions/types.js';
import { ActionExecutor } from '../actions/ActionExecutor.js';

export class ProcessTool implements IToolAdapter {
  readonly name: ToolCategory = 'process';
  readonly supportedOperations = ['exec'];
  private readonly executor: ActionExecutor;

  constructor(executor?: ActionExecutor) {
    this.executor = executor || new ActionExecutor();
  }

  getRequiredCapability(_operation: string, _args: Record<string, unknown>): ExecutionCapability {
    return 'process.exec';
  }

  execute(workspaceRoot: string, operation: string, args: Record<string, unknown>): ToolResult {
    const start = Date.now();
    const capability = this.getRequiredCapability(operation, args);

    if (operation !== 'exec') {
      return {
        tool: this.name,
        operation,
        capability,
        status: 'FAILED',
        stderr: `Unsupported process operation "${operation}"`,
        durationMs: Date.now() - start
      };
    }

    const command = String(args.command || '').trim();
    if (!command) {
      return {
        tool: this.name,
        operation,
        capability,
        status: 'FAILED',
        stderr: 'process.exec requires non-empty "command"',
        durationMs: Date.now() - start
      };
    }

    const actionRes = this.executor.executeAction(workspaceRoot, {
      type: 'EXEC',
      command
    });

    return {
      tool: this.name,
      operation,
      capability,
      status: actionRes.status,
      exitCode: actionRes.status === 'SUCCESS' ? 0 : 1,
      stdout: actionRes.output ? actionRes.output.trim() : '',
      stderr: actionRes.error ? actionRes.error.trim() : '',
      output: actionRes.output,
      blockedReason: actionRes.blockedReason,
      durationMs: Date.now() - start,
      metadata: actionRes.metadata
    };
  }
}
