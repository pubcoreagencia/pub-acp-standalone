import { IAgentRuntime } from './IAgentRuntime.js';

export interface IAgentRuntimeRegistry {
  register(runtime: IAgentRuntime): void;
  unregister(runtimeId: string): boolean;
  get(runtimeId: string): IAgentRuntime | undefined;
  list(): IAgentRuntime[];
  checkAllHealth(): Promise<Record<string, import('./types.js').RuntimeHealth>>;
}

export class AgentRuntimeRegistry implements IAgentRuntimeRegistry {
  private readonly runtimes = new Map<string, IAgentRuntime>();

  register(runtime: IAgentRuntime): void {
    if (!runtime || !runtime.id || typeof runtime.id !== 'string') {
      throw new Error('Agent runtime requires a valid id.');
    }
    this.runtimes.set(runtime.id.trim().toLowerCase(), runtime);
  }

  unregister(runtimeId: string): boolean {
    if (!runtimeId) return false;
    return this.runtimes.delete(runtimeId.trim().toLowerCase());
  }

  get(runtimeId: string): IAgentRuntime | undefined {
    if (!runtimeId) return undefined;
    return this.runtimes.get(runtimeId.trim().toLowerCase());
  }

  list(): IAgentRuntime[] {
    return Array.from(this.runtimes.values());
  }

  async checkAllHealth(): Promise<Record<string, import('./types.js').RuntimeHealth>> {
    const entries = await Promise.all(
      this.list().map(async runtime => [runtime.id, await runtime.checkHealth()] as const)
    );
    return Object.fromEntries(entries);
  }
}