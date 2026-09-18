import { GptTransport, IGptTransport, GptPromptResponse } from '../gpt/index.js';
import { AntigravityBridge, IAntigravityTransport, AntigravityTransport } from '../antigravity/index.js';
import { ActionParser, ActionExecutor, ActionExecutorOptions, ActionPolicy } from '../actions/index.js';
import { ToolParser, ToolRegistry } from '../tools/index.js';
import { BrowserOperator } from '../browser/BrowserOperator.js';

export type ExecutionProviderKind = 'antigravity' | 'gpt';

export interface ExecutionPromptOptions {
  request_id?: string;
  session_id?: string;
  timeout_ms?: number;
  cwd?: string;
  effort?: 'low' | 'medium' | 'high';
  model?: string;
  turn?: number;
  run_id?: string;
  conversation_id?: string;
  options?: Record<string, unknown>;
}

export interface ExecutionResult {
  request_id: string;
  session_id: string;
  status: 'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'HUMAN_REQUIRED';
  response: string;
  duration_ms: number;
  error?: { code: string; message: string; details?: unknown };
  metadata?: Record<string, unknown>;
}

export interface IExecutionTransport {
  health(timeoutMs?: number): Promise<{ status: 'ok' | 'error' | 'human_required'; error?: string }>;
  executeTurn(sessionId: string, prompt: string, options?: ExecutionPromptOptions): Promise<ExecutionResult>;
}

export class AntigravityExecutionTransport implements IExecutionTransport {
  private readonly bridge: AntigravityBridge;

  constructor(transportOrBridge?: IAntigravityTransport | AntigravityBridge) {
    if (transportOrBridge instanceof AntigravityBridge) {
      this.bridge = transportOrBridge;
    } else {
      this.bridge = new AntigravityBridge(transportOrBridge || new AntigravityTransport());
    }
  }

  async health(): Promise<{ status: 'ok' | 'error'; error?: string }> {
    const h = await this.bridge.getTransport().health();
    return { status: h.status, error: h.error };
  }

  async executeTurn(sessionId: string, prompt: string, options: ExecutionPromptOptions = {}): Promise<ExecutionResult> {
    const r = await this.bridge.executeTurn(sessionId, prompt, options as any);
    return {
      request_id: r.request_id,
      session_id: r.session_id,
      status: r.status === 'COMPLETED' ? 'COMPLETED' : r.status === 'TIMEOUT' ? 'TIMEOUT' : r.status === 'HUMAN_REQUIRED' ? 'HUMAN_REQUIRED' : 'FAILED',
      response: r.response,
      duration_ms: r.duration_ms,
      error: r.error,
      metadata: r.metadata
    };
  }

  getBridge(): AntigravityBridge {
    return this.bridge;
  }
}

export class GptExecutionTransport implements IExecutionTransport {
  private readonly transport: IGptTransport;
  private readonly executor: ActionExecutor;
  private readonly toolRegistry: ToolRegistry;

  constructor(
    transport?: IGptTransport,
    executorOptions?: ActionExecutorOptions,
    browserOperator?: BrowserOperator
  ) {
    this.transport = transport || new GptTransport();
    this.executor = new ActionExecutor(executorOptions);
    this.toolRegistry = new ToolRegistry(executorOptions?.policy, browserOperator);
  }

  async health(timeoutMs = 5000): Promise<{ status: 'ok' | 'error' | 'human_required'; error?: string }> {
    return this.transport.health(timeoutMs);
  }

  async executeTurn(sessionId: string, prompt: string, options: ExecutionPromptOptions = {}): Promise<ExecutionResult> {
    const cwd = options.cwd || process.cwd();
    const currentTurn = options.turn ?? (options.options?.turn as number | undefined) ?? 1;
    const currentRunId = options.run_id || (options.options?.run_id as string | undefined) || options.request_id;

    const systemAugmentedPrompt = `Você é o executor operacional técnico no workspace "${cwd}".
Sua tarefa é executar a seguinte instrução:
"""
${prompt}
"""

Use o protocolo ACP de Capabilities e Tools semânticas para operar no workspace:

1. Tools Semânticas (Recomendado):
[TOOL: workspace.read]
path=caminho/arquivo.txt
[/TOOL]

[TOOL: workspace.write]
path=caminho/arquivo.txt
content=conteudo
[/TOOL]

[TOOL: git.status][/TOOL]
[TOOL: git.diff][/TOOL]
[TOOL: git.log][/TOOL]

[TOOL: npm.test][/TOOL]
[TOOL: npm.build][/TOOL]

[TOOL: browser.status][/TOOL]
[TOOL: browser.navigate]
url=http://127.0.0.1:...
[/TOOL]
[TOOL: browser.read][/TOOL]
[TOOL: browser.screenshot][/TOOL]

2. Diretivas Legadas (Compatibilidade V1-V4):
[FILE_CREATE: <caminho_relativo>]
<conteúdo_do_arquivo>
[/FILE_CREATE]

[FILE_READ: <caminho_relativo>][/FILE_READ]
[FILE_DELETE: <caminho_relativo>][/FILE_DELETE]
[EXEC: <comando>][/EXEC]

Segurança:
- Todos os caminhos devem estar estritamente contidos no workspace "${cwd}".
- Qualquer tentativa de path traversal ou violação de capability será imediatamente bloqueada.
Ao finalizar, confirme as ações executadas e o resultado.`;

    const r: GptPromptResponse = await this.transport.continueSession(sessionId, systemAugmentedPrompt, {
      request_id: options.request_id,
      timeout_ms: options.timeout_ms,
      options: options.options
    });

    let executionOutput = r.text;

    // 1. Parse directives from the instruction prompt or model response
    let toolRequests = ToolParser.parse(prompt);
    if (toolRequests.length === 0) {
      toolRequests = ToolParser.parse(r.text);
    }

    let batchSummary = '';
    let executedTelemetry: any[] = [];

    if (toolRequests.length > 0) {
      const toolBatch = await this.toolRegistry.executeBatch(cwd, toolRequests, {
        runId: currentRunId,
        turn: currentTurn,
        provider: 'gpt'
      });
      batchSummary = toolBatch.summary;
      executedTelemetry = toolBatch.telemetry;
    } else {
      // Fallback to legacy parser if no tool requests parsed
      let actions = ActionParser.parse(prompt);
      if (actions.length === 0) {
        actions = ActionParser.parse(r.text);
      }
      if (actions.length > 0) {
        const batchResult = this.executor.executeBatch(cwd, actions);
        batchSummary = batchResult.summary;
      }
    }

    if (batchSummary) {
      executionOutput += `\n\n${batchSummary}`;
    }

    return {
      request_id: r.request_id,
      session_id: r.session_id,
      status: r.status === 'HUMAN_REQUIRED' ? 'HUMAN_REQUIRED' :
        r.status === 'TIMEOUT' ? 'TIMEOUT' :
        r.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
      response: executionOutput,
      duration_ms: r.duration_ms,
      error: r.error,
      metadata: {
        ...r.metadata,
        toolTelemetry: executedTelemetry
      }
    };
  }

  getTransport(): IGptTransport {
    return this.transport;
  }

  getActionExecutor(): ActionExecutor {
    return this.executor;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }
}
