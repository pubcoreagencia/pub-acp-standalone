import { IToolAdapter, ToolCategory, ToolRequest, ToolResult, ToolExecutionTelemetry, ToolBatchResult } from './types.js';
import { WorkspaceTool } from './WorkspaceTool.js';
import { GitTool } from './GitTool.js';
import { NpmTool } from './NpmTool.js';
import { NodeTool } from './NodeTool.js';
import { ProcessTool } from './ProcessTool.js';
import { ActionPolicy, ExecutionCapability } from '../actions/types.js';

export class ToolRegistry {
  private readonly adapters = new Map<string, IToolAdapter>();
  private readonly policy: ActionPolicy;

  constructor(policy: ActionPolicy = {}) {
    this.policy = policy;

    // Register standard tool adapters
    this.register(new WorkspaceTool());
    this.register(new GitTool());
    this.register(new NpmTool());
    this.register(new NodeTool());
    this.register(new ProcessTool());
  }

  register(adapter: IToolAdapter): void {
    this.adapters.set(adapter.name.toLowerCase(), adapter);
  }

  getAdapter(toolName: string): IToolAdapter | undefined {
    return this.adapters.get(toolName.toLowerCase());
  }

  /**
   * Fail-Closed Capability Authorization:
   * - capability explicitly true  -> ALLOW
   * - capability explicitly false -> BLOCK
   * - capability absent           -> BLOCK (NO permissive default fallbacks)
   */
  hasCapability(capability: ExecutionCapability): boolean {
    if (this.policy.capabilities && this.policy.capabilities[capability] !== undefined) {
      return this.policy.capabilities[capability] === true;
    }

    // Strict Fail-Closed: if capabilities map is defined, any absent capability is DENIED
    if (this.policy.capabilities) {
      return false;
    }

    // Legacy ActionPolicy booleans support (only if capabilities dictionary wasn't supplied)
    switch (capability) {
      case 'workspace.read':
      case 'workspace.list':
        return this.policy.allowFileRead === true;
      case 'workspace.write':
        return (this.policy.allowFileCreate === true || this.policy.allowFileWrite === true);
      case 'workspace.delete':
        return this.policy.allowFileDelete === true;
      case 'node.exec':
      case 'process.exec':
        return this.policy.allowExec === true;
      default:
        // Everything else (git.mutate, git.read, npm.*) fails closed unless explicitly granted
        return false;
    }
  }

  executeRequest(
    workspaceRoot: string,
    request: ToolRequest,
    telemetryContext: { runId?: string; turn?: number; provider?: string } = {}
  ): { result: ToolResult; telemetry: ToolExecutionTelemetry } {
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
    const isAllowed = this.hasCapability(requiredCapability);

    if (!isAllowed) {
      const durationMs = Date.now() - start;
      const res: ToolResult = {
        tool: request.tool,
        operation: request.operation,
        capability: requiredCapability,
        status: 'BLOCKED',
        blockedReason: 'CAPABILITY_POLICY_DENIED',
        stderr: `Capability "${requiredCapability}" is denied by Policy Engine`,
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
        blockedReason: 'CAPABILITY_POLICY_DENIED',
        legacyExec: request.legacyExec
      };
      return { result: res, telemetry: telem };
    }

    try {
      const toolRes = adapter.execute(workspaceRoot, request.operation, request.args);
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

  executeBatch(
    workspaceRoot: string,
    requests: ToolRequest[],
    telemetryContext: { runId?: string; turn?: number; provider?: string } = {}
  ): ToolBatchResult {
    const results: ToolResult[] = [];
    const telemetries: ToolExecutionTelemetry[] = [];
    const summaryLines: string[] = [];

    for (const req of requests) {
      const { result, telemetry } = this.executeRequest(workspaceRoot, req, telemetryContext);
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
