import { AntigravityTransport, AntigravityTransportConfig } from './AntigravityTransport.js';
import { AntigravityExecutionResult, AntigravityPromptOptions } from './types.js';

export interface BridgeTurnRecord {
  turn: number;
  prompt: string;
  result: AntigravityExecutionResult;
  timestamp: string;
}

export interface BridgeSession {
  sessionId: string;
  conversationId: string | null;
  history: BridgeTurnRecord[];
  createdAt: string;
  lastActiveAt: string;
}

export interface IAntigravityTransport {
  health(): Promise<{ status: 'ok' | 'error'; agyPath?: string; version?: string; error?: string }>;
  sendPrompt(prompt: string, options?: AntigravityPromptOptions): Promise<AntigravityExecutionResult>;
  sendPromptInConversation?(
    conversationId: string,
    prompt: string,
    options?: Omit<AntigravityPromptOptions, 'conversation_id'>
  ): Promise<AntigravityExecutionResult>;
}

export class AntigravityBridge {
  private readonly transport: IAntigravityTransport;
  private readonly sessions = new Map<string, BridgeSession>();

  constructor(transportOrConfig?: IAntigravityTransport | AntigravityTransportConfig) {
    if (transportOrConfig && typeof (transportOrConfig as any).sendPrompt === 'function') {
      this.transport = transportOrConfig as IAntigravityTransport;
    } else {
      this.transport = new AntigravityTransport(transportOrConfig as AntigravityTransportConfig);
    }
  }

  getTransport(): IAntigravityTransport {
    return this.transport;
  }

  getSession(sessionId: string): BridgeSession | undefined {
    return this.sessions.get(sessionId);
  }

  async executeTurn(
    sessionId: string,
    prompt: string,
    options: Omit<AntigravityPromptOptions, 'session_id'> = {}
  ): Promise<AntigravityExecutionResult> {
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        sessionId,
        conversationId: options.conversation_id || null,
        history: [],
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString()
      };
      this.sessions.set(sessionId, session);
    }

    const conversationId = session.conversationId || options.conversation_id;

    const result = await this.transport.sendPrompt(prompt, {
      ...options,
      session_id: sessionId,
      conversation_id: conversationId || undefined
    });

    if (result.conversation_id && !session.conversationId) {
      session.conversationId = result.conversation_id;
    }

    session.lastActiveAt = new Date().toISOString();
    session.history.push({
      turn: session.history.length + 1,
      prompt,
      result,
      timestamp: new Date().toISOString()
    });

    return result;
  }

  async runLoop(
    sessionId: string,
    prompts: Array<string | ((prevResult: AntigravityExecutionResult) => string)>,
    options: Omit<AntigravityPromptOptions, 'session_id'> = {}
  ): Promise<AntigravityExecutionResult[]> {
    const results: AntigravityExecutionResult[] = [];
    let lastResult: AntigravityExecutionResult | null = null;

    for (let i = 0; i < prompts.length; i++) {
      const p = prompts[i];
      const actualPrompt = typeof p === 'function' ? p(lastResult!) : p;
      const res = await this.executeTurn(sessionId, actualPrompt, options);
      results.push(res);
      lastResult = res;

      if (res.status !== 'COMPLETED') {
        break;
      }
    }

    return results;
  }
}
