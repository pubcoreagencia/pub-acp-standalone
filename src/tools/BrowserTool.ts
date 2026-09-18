import { IToolAdapter, ToolCategory, ToolResult } from './types.js';
import { ExecutionCapability } from '../actions/types.js';
import { BrowserOperator } from '../browser/BrowserOperator.js';

export class BrowserTool implements IToolAdapter {
  readonly name: ToolCategory = 'browser';
  readonly supportedOperations = ['status', 'navigate', 'read', 'screenshot'];
  private readonly operator: BrowserOperator;

  constructor(operator?: BrowserOperator) {
    this.operator = operator || new BrowserOperator();
  }

  getOperator(): BrowserOperator {
    return this.operator;
  }

  getRequiredCapability(operation: string, _args: Record<string, unknown>): ExecutionCapability {
    switch (operation) {
      case 'status':
        return 'browser.status';
      case 'navigate':
        return 'browser.navigate';
      case 'read':
        return 'browser.read';
      case 'screenshot':
        return 'browser.screenshot';
      default:
        return 'browser.status';
    }
  }

  async execute(
    _workspaceRoot: string,
    operation: string,
    args: Record<string, unknown>,
    options: Record<string, unknown> = {}
  ): Promise<ToolResult> {
    const requiredCapability = this.getRequiredCapability(operation, args);
    const telemetryCtx = {
      runId: options.runId as string | undefined,
      turn: options.turn as number | undefined,
      provider: (options.provider as string | undefined) || 'gpt'
    };

    switch (operation) {
      case 'status': {
        const statusRes = await this.operator.getStatus(telemetryCtx);
        return {
          tool: this.name,
          operation,
          capability: requiredCapability,
          status: statusRes.status === 'CONNECTED' ? 'SUCCESS' : 'FAILED',
          output: statusRes,
          stdout: `Browser: ${statusRes.browser}\nStatus: ${statusRes.status}\nEndpoint: ${statusRes.cdpEndpoint}\nProfile: ${statusRes.profileDir}`
        };
      }

      case 'navigate': {
        const rawUrl = (args.url as string) || (args.input as string) || '';
        const navRes = await this.operator.navigate(rawUrl, telemetryCtx);
        if (navRes.status === 'BLOCKED') {
          return {
            tool: this.name,
            operation,
            capability: requiredCapability,
            status: 'BLOCKED',
            blockedReason: navRes.blockedReason,
            stderr: navRes.error,
            durationMs: navRes.durationMs
          };
        }
        if (navRes.status === 'FAILED') {
          return {
            tool: this.name,
            operation,
            capability: requiredCapability,
            status: 'FAILED',
            stderr: navRes.error,
            durationMs: navRes.durationMs
          };
        }
        return {
          tool: this.name,
          operation,
          capability: requiredCapability,
          status: 'SUCCESS',
          output: navRes,
          stdout: `Navigated to ${navRes.url} (Domain: ${navRes.domain}, Title: "${navRes.title || ''}") in ${navRes.durationMs}ms`,
          durationMs: navRes.durationMs
        };
      }

      case 'read': {
        const readRes = await this.operator.read(telemetryCtx);
        if (readRes.status === 'FAILED') {
          return {
            tool: this.name,
            operation,
            capability: requiredCapability,
            status: 'FAILED',
            stderr: readRes.error,
            durationMs: readRes.durationMs
          };
        }
        const linksSummary = readRes.links.length > 0
          ? `\nLinks (${readRes.links.length}):\n` + readRes.links.slice(0, 5).map(l => ` - [${l.text || 'link'}](${l.href})`).join('\n')
          : '';
        return {
          tool: this.name,
          operation,
          capability: requiredCapability,
          status: 'SUCCESS',
          output: readRes,
          stdout: `Page: ${readRes.url}\nTitle: "${readRes.title}"\n\nContent:\n${readRes.text.slice(0, 1000)}${linksSummary}`,
          durationMs: readRes.durationMs
        };
      }

      case 'screenshot': {
        const shotRes = await this.operator.screenshot(telemetryCtx);
        if (shotRes.status === 'FAILED') {
          return {
            tool: this.name,
            operation,
            capability: requiredCapability,
            status: 'FAILED',
            stderr: shotRes.error,
            durationMs: shotRes.durationMs
          };
        }
        return {
          tool: this.name,
          operation,
          capability: requiredCapability,
          status: 'SUCCESS',
          output: shotRes,
          stdout: `Screenshot saved: ${shotRes.filename} (${shotRes.bytes} bytes, path: ${shotRes.path})`,
          durationMs: shotRes.durationMs
        };
      }

      default:
        return {
          tool: this.name,
          operation,
          capability: requiredCapability,
          status: 'BLOCKED',
          blockedReason: 'UNKNOWN_OPERATION',
          stderr: `Unknown browser operation: ${operation}`
        };
    }
  }
}
