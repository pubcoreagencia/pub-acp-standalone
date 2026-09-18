import { IToolAdapter, ToolCategory, ToolRequest, ToolResult, ToolExecutionTelemetry, ToolBatchResult } from './types.js';
import { WorkspaceTool } from './WorkspaceTool.js';
import { GitTool } from './GitTool.js';
import { NpmTool } from './NpmTool.js';
import { NodeTool } from './NodeTool.js';
import { ProcessTool } from './ProcessTool.js';
import { BrowserTool } from './BrowserTool.js';
import { BrowserOperator } from '../browser/BrowserOperator.js';
import { ActionPolicy, ExecutionCapability } from '../actions/types.js';
import { AuthorizationEngine } from './AuthorizationEngine.js';

export class ToolRegistry {
  private readonly adapters = new Map<string, IToolAdapter>();
  private readonly policy: ActionPolicy;
  private readonly authEngine: AuthorizationEngine;

  constructor(policy: ActionPolicy = {}, browserOperator?: BrowserOperator) {
    this.policy = policy;
    this.authEngine = new AuthorizationEngine(policy);

    // Register standard tool adapters
    this.register(new WorkspaceTool());
    this.register(new GitTool());
    this.register(new NpmTool());
    this.register(new NodeTool());
    this.register(new ProcessTool());
    this.register(new BrowserTool(browserOperator));
  }

  register(adapter: IToolAdapter): void {
    this.adapters.set(adapter.name.toLowerCase(), adapter);
  }

  getAdapter(toolName: string): IToolAdapter | undefined {
    return this.adapters.get(toolName.toLowerCase());
  }

  getAuthorizationEngine(): AuthorizationEngine {
    return this.authEngine;
  }

  /**
   * Canonical Capability Evaluation:
   * Delegated to AuthorizationEngine.
   * In strict mode (default), capabilities is the SOLE authority.
   * Missing or false -> false. Legacy booleans CANNOT reopen permissions.
   */
  hasCapability(capability: ExecutionCapability): boolean {
    return this.authEngine.evaluate(capability).allowed;
  }

  async executeRequest(
    workspaceRoot: string,
    request: ToolRequest,
    telemetryContext: { runId?: string; turn?: number; provider?: string } = {}
  ): Promise<{ result: ToolResult; telemetry: ToolExecutionTelemetry }> {
    const start = Date.now();
    const adapter = this.getAdapter(request.tool);

    if (!adapter) {
      const durationMs = Date.now() - start;
      const res: ToolResult = {
        tool: request.tool,
        operation: request.operation,
        capability: 'process.exec',
        status: 'BLOCKED',
        blockedReason: 'TOOL_NOT_FOUND',
        stderr: `Tool "${request.tool}" is not registered in ToolRegistry`,
        durationMs
      };
      const telem: ToolExecutionTelemetry = {
        runId: telemetryContext.runId,
        turn: telemetryContext.turn,
        provider: telemetryContext.provider || 'gpt',
        tool: request.tool,
        operation: request.operation,
        capability: 'process.exec',
        args: request.args,
        workspace: workspaceRoot,
        policyDecision: 'BLOCK',
        executionProvider: 'registry',
        result: 'BLOCKED',
        durationMs,
        blockedReason: 'TOOL_NOT_FOUND',
        legacyExec: request.legacyExec
      };
      return { result: res, telemetry: telem };
    }

    // Check if operation is supported by the tool adapter
    if (!adapter.supportedOperations.includes(request.operation)) {
      const durationMs = Date.now() - start;
      const res: ToolResult = {
        tool: request.tool,
        operation: request.operation,
        capability: 'process.exec',
        status: 'BLOCKED',
        blockedReason: 'UNKNOWN_OPERATION',
        stderr: `Operation "${request.operation}" is not supported by tool "${adapter.name}". Supported: [${adapter.supportedOperations.join(', ')}]`,
        durationMs
      };
      const telem: ToolExecutionTelemetry = {
        runId: telemetryContext.runId,
        turn: telemetryContext.turn,
        provider: telemetryContext.provider || 'gpt',
        tool: request.tool,
        operation: request.operation,
        capability: 'process.exec',
        args: request.args,
        workspace: workspaceRoot,
        policyDecision: 'BLOCK',
        executionProvider: adapter.name,
        result: 'BLOCKED',
        durationMs,
        blockedReason: 'UNKNOWN_OPERATION',
        legacyExec: request.legacyExec
      };
      return { result: res, telemetry: telem };
    }

    const requiredCapability = adapter.getRequiredCapability(request.operation, request.args);
    const authDecision = this.authEngine.evaluate(requiredCapability);

    if (!authDecision.allowed) {
      const durationMs = Date.now() - start;
      const res: ToolResult = {
        tool: request.tool,
        operation: request.operation,
        capability: requiredCapability,
        status: 'BLOCKED',
        blockedReason: authDecision.blockedReason || 'CAPABILITY_POLICY_DENIED',
        stderr: authDecision.reason || `Capability "${requiredCapability}" is denied by Policy Engine`,
        durationMs
      };
      const telem: ToolExecutionTelemetry = {
        runId: telemetryContext.runId,
        turn: telemetryContext.turn,
        provider: telemetryContext.provider || 'gpt',
        tool: request.tool,
        operation: request.operation,
        capability: requiredCapability,
        args: request.args,
        workspace: workspaceRoot,
        policyDecision: 'BLOCK',
        executionProvider: adapter.name,
        result: 'BLOCKED',
        durationMs,
        blockedReason: authDecision.blockedReason || 'CAPABILITY_POLICY_DENIED',
        legacyExec: request.legacyExec
      };
      return { result: res, telemetry: telem };
    }

    try {
      const toolRes = await adapter.execute(workspaceRoot, request.operation, request.args, {
        runId: telemetryContext.runId,
        turn: telemetryContext.turn,
        provider: telemetryContext.provider
      });
      const durationMs = Date.now() - start;
      const telem: ToolExecutionTelemetry = {
        runId: telemetryContext.runId,
        turn: telemetryContext.turn,
        provider: telemetryContext.provider || 'gpt',
        tool: request.tool,
        operation: request.operation,
        capability: requiredCapability,
        args: request.args,
        workspace: workspaceRoot,
        policyDecision: 'ALLOW',
        executionProvider: adapter.name,
        result: toolRes.status,
        exitCode: toolRes.exitCode,
        durationMs,
        blockedReason: toolRes.blockedReason,
        legacyExec: request.legacyExec
      };
      return { result: toolRes, telemetry: telem };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const res: ToolResult = {
        tool: request.tool,
        operation: request.operation,
        capability: requiredCapability,
        status: 'FAILED',
        stderr: err.message,
        durationMs
      };
      const telem: ToolExecutionTelemetry = {
        runId: telemetryContext.runId,
        turn: telemetryContext.turn,
        provider: telemetryContext.provider || 'gpt',
        tool: request.tool,
        operation: request.operation,
        capability: requiredCapability,
        args: request.args,
        workspace: workspaceRoot,
        policyDecision: 'ALLOW',
        executionProvider: adapter.name,
        result: 'FAILED',
        durationMs,
        legacyExec: request.legacyExec
      };
      return { result: res, telemetry: telem };
    }
  }

  async executeBatch(
    workspaceRoot: string,
    requests: ToolRequest[],
    telemetryContext: { runId?: string; turn?: number; provider?: string } = {}
  ): Promise<ToolBatchResult> {
    const results: ToolResult[] = [];
    const telemetries: ToolExecutionTelemetry[] = [];
    const summaryLines: string[] = [];

    for (const req of requests) {
      const { result, telemetry } = await this.executeRequest(workspaceRoot, req, telemetryContext);
      results.push(result);
      telemetries.push(telemetry);

      const legacyTag = req.legacyExec ? ' (legacyExec=true)' : '';
      if (result.status === 'SUCCESS') {
        const outStr = typeof result.stdout === 'string' && result.stdout ? `\n${result.stdout}\n` : '';
        summaryLines.push(`[TOOL_RESULT: ${result.tool}.${result.operation}]${legacyTag}\nstatus=SUCCESS${outStr}[/TOOL_RESULT]`);
      } else if (result.status === 'BLOCKED') {
        summaryLines.push(`[TOOL_BLOCKED: ${result.tool}.${result.operation}]${legacyTag}\ncapability=${result.capability}\nreason=${result.blockedReason}\nerror=${result.stderr}[/TOOL_BLOCKED]`);
      } else {
        summaryLines.push(`[TOOL_ERROR: ${result.tool}.${result.operation}]${legacyTag}\nstatus=FAILED\nexitCode=${result.exitCode ?? 1}\nerror=${result.stderr || result.stdout}[/TOOL_ERROR]`);
      }
    }

    return {
      results,
      telemetry: telemetries,
      summary: summaryLines.join('\n')
    };
  }
}
