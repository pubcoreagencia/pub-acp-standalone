import { GptTransport, IGptTransport, GptPromptResponse } from '../gpt/index.js';
import { AntigravityBridge, IAntigravityTransport, AntigravityTransport } from '../antigravity/index.js';
import { ActionParser, ActionExecutor, ActionExecutorOptions } from '../actions/index.js';

export type ExecutionProviderKind = 'antigravity' | 'gpt';

export interface ExecutionPromptOptions {
  request_id?: string;
  session_id?: string;
  timeout_ms?: number;
  cwd?: string;
  effort?: 'low' | 'medium' | 'high';
  model?: string;
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

  constructor(transport?: IAntigravityTransport) {
    this.bridge = new AntigravityBridge(transport || new AntigravityTransport());
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

  constructor(transport?: IGptTransport, executorOptions?: ActionExecutorOptions) {
    this.transport = transport || new GptTransport();
    this.executor = new ActionExecutor(executorOptions);
  }

  async health(timeoutMs = 5000): Promise<{ status: 'ok' | 'error' | 'human_required'; error?: string }> {
    return this.transport.health(timeoutMs);
  }

  async executeTurn(sessionId: string, prompt: string, options: ExecutionPromptOptions = {}): Promise<ExecutionResult> {
    const cwd = options.cwd || process.cwd();
    const systemAugmentedPrompt = `Você é o executor operacional técnico no workspace "${cwd}".
Sua tarefa é executar a seguinte instrução:
"""
${prompt}
"""

Use EXCLUSIVAMENTE o protocolo ACP de ações para interagir com o workspace:

1. Criar ou sobrescrever arquivo:
[FILE_CREATE: <caminho_relativo>]
<conteúdo_do_arquivo>
[/FILE_CREATE]

2. Ler arquivo existente para inspecionar conteúdo:
[FILE_READ: <caminho_relativo>][/FILE_READ]

3. Deletar arquivo:
[FILE_DELETE: <caminho_relativo>][/FILE_DELETE]

4. Executar comando no workspace (ex: testes, validação, verificação):
[EXEC: <comando>][/EXEC]

Segurança:
- Todos os caminhos devem ser estritamente relativos ou contidos no workspace "${cwd}".
- Qualquer tentativa de path traversal (..) será imediatamente bloqueada.
Ao finalizar, confirme as ações executadas e o resultado.`;

    const r: GptPromptResponse = await this.transport.continueSession(sessionId, systemAugmentedPrompt, {
      request_id: options.request_id,
      timeout_ms: options.timeout_ms,
      options: options.options
    });

    let executionOutput = r.text;
    const actions = ActionParser.parse(r.text);
    const batchResult = this.executor.executeBatch(cwd, actions);

    if (batchResult.summary) {
      executionOutput += `\n\n${batchResult.summary}`;
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
        appliedFiles: batchResult.appliedFiles,
        readFiles: batchResult.readFiles,
        deletedFiles: batchResult.deletedFiles,
        executedCommands: batchResult.executedCommands,
        actionResults: batchResult.results
      }
    };
  }

  getTransport(): IGptTransport {
    return this.transport;
  }

  getActionExecutor(): ActionExecutor {
    return this.executor;
  }
}
