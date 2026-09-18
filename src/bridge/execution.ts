import fs from 'node:fs';
import path from 'node:path';
import { GptTransport, IGptTransport, GptPromptResponse } from '../gpt/index.js';
import { AntigravityBridge, IAntigravityTransport, AntigravityTransport } from '../antigravity/index.js';

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

  constructor(transport?: IGptTransport) {
    this.transport = transport || new GptTransport();
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

Para criar ou modificar arquivos no workspace, use EXATAMENTE a diretiva de bloco:
[FILE_CREATE: <nome_relativo_do_arquivo>]
<conteudo_exato_do_arquivo>
[/FILE_CREATE]

Se a instrução solicitar a criação de um arquivo específico (por exemplo GPT_EXECUTOR_PROOF.txt), emita a diretiva correspondente.
Ao finalizar, confirme os arquivos criados e o resultado.`;

    const r: GptPromptResponse = await this.transport.continueSession(sessionId, systemAugmentedPrompt, {
      request_id: options.request_id,
      timeout_ms: options.timeout_ms,
      options: options.options
    });

    let executionOutput = r.text;
    const appliedFiles: string[] = [];

    if (r.status === 'COMPLETED' && r.text) {
      const regex = /\[FILE_(?:CREATE|WRITE):\s*([^\]]+)\]([\s\S]*?)\[\/FILE_(?:CREATE|WRITE)\]/gi;
      let match;
      while ((match = regex.exec(r.text)) !== null) {
        const relativePath = match[1].trim();
        const content = match[2];
        const targetPath = path.isAbsolute(relativePath)
          ? relativePath
          : path.resolve(cwd, relativePath);

        try {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, content, 'utf8');
          appliedFiles.push(relativePath);
        } catch (err: any) {
          executionOutput += `\n[ERRO AO GRAVAR ARQUIVO ${relativePath}: ${err.message}]`;
        }
      }

      if (appliedFiles.length > 0) {
        executionOutput += `\n[EXECUTOR_STATUS: Arquivos gravados com sucesso no workspace: ${appliedFiles.join(', ')}]`;
      }
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
        appliedFiles
      }
    };
  }

  getTransport(): IGptTransport {
    return this.transport;
  }
}
