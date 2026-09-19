import { randomUUID } from 'node:crypto';
import { IAgentRuntime } from './IAgentRuntime.js';
import {
  AgentCapability,
  ExecutionPlan,
  ExecutionRequest,
  RuntimeHealth,
  RuntimeSelectionPolicy
} from './types.js';

export class AgentRuntimeRouter {
  constructor(
    private readonly runtimes: { list(): IAgentRuntime[]; get(id: string): IAgentRuntime | undefined }
  ) {}

  async plan(
    request: ExecutionRequest,
    policy: RuntimeSelectionPolicy = {}
  ): Promise<ExecutionPlan> {
    const candidates = this.runtimes.list().filter(runtime =>
      this.isPolicyAllowed(runtime, policy) &&
      this.supportsCapabilities(runtime.capabilities.supported, request.requiredCapabilities)
    );

    if (candidates.length === 0) {
      throw new Error('No registered runtime satisfies the requested capabilities and policy.');
    }

    const healthy: Array<{ runtime: IAgentRuntime; health: RuntimeHealth }> = [];
    for (const runtime of candidates) {
      const health = await runtime.checkHealth();
      if (health.healthy && health.availableCapacity > 0) {
        healthy.push({ runtime, health });
      }
    }

    if (healthy.length === 0) {
      throw new Error('No eligible runtime is currently healthy or has available capacity.');
    }

    healthy.sort((a, b) =>
      a.runtime.id.localeCompare(b.runtime.id)
    );

    const selected = healthy[0].runtime;
    return Object.freeze({
      planId: `plan-${randomUUID()}`,
      runtimeId: selected.id,
      request,
      createdAt: new Date().toISOString()
    });
  }

  private isPolicyAllowed(runtime: IAgentRuntime, policy: RuntimeSelectionPolicy): boolean {
    const id = runtime.id.trim().toLowerCase();

    if (policy.allowedRuntimeIds?.length) {
      const allowed = policy.allowedRuntimeIds.map(value => value.trim().toLowerCase());
      if (!allowed.includes(id)) return false;
    }

    if (policy.requireHeadless && !runtime.capabilities.isHeadless) return false;
    if (policy.requireStreaming && !runtime.capabilities.supportsStreaming) return false;
    if (
      policy.requireHumanApproval !== undefined &&
      runtime.capabilities.requiresHumanApproval !== policy.requireHumanApproval
    ) {
      return false;
    }

    return true;
  }

  private supportsCapabilities(
    supported: AgentCapability[],
    required: AgentCapability[]
  ): boolean {
    const supportedSet = new Set(supported);
    return required.every(capability => supportedSet.has(capability));
  }
}