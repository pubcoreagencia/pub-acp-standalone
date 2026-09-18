import { ActionPolicy, ExecutionCapability, PolicyAuthorizationMode } from '../actions/types.js';

export interface AuthorizationDecision {
  allowed: boolean;
  capability: ExecutionCapability;
  reason?: string;
  blockedReason?: string;
  mode: PolicyAuthorizationMode;
}

/**
 * AuthorizationEngine (V5.2)
 *
 * Canonical, single authority for capability evaluation in the Tool Runtime.
 *
 * CANONICAL RULES:
 * 1. Mode 'strict' is DEFAULT.
 * 2. If 'capabilities' map is present, it is the EXCLUSIVE authority.
 *    - capability === true   => ALLOW
 *    - capability === false  => BLOCK (CAPABILITY_POLICY_DENIED)
 *    - capability is absent  => BLOCK (CAPABILITY_POLICY_DENIED)
 *    Legacy booleans (allowExec, allowFileRead, etc.) CANNOT reopen permissions.
 * 3. Mode 'legacy' is only evaluated if explicitly requested via `authorizationMode: 'legacy'`
 *    AND no `capabilities` map was provided.
 */
export class AuthorizationEngine {
  private readonly policy: ActionPolicy;
  readonly mode: PolicyAuthorizationMode;

  constructor(policy: ActionPolicy = {}) {
    this.policy = policy;
    this.mode = policy.authorizationMode || 'strict';
  }

  evaluate(capability: ExecutionCapability): AuthorizationDecision {
    // 1. If capabilities dictionary is provided, it is the SOLE CANONICAL AUTHORITY.
    // Legacy flags cannot reopen permissions.
    if (this.policy.capabilities !== undefined) {
      const explicitVal = this.policy.capabilities[capability];
      if (explicitVal === true) {
        return {
          allowed: true,
          capability,
          mode: this.mode
        };
      }
      return {
        allowed: false,
        capability,
        blockedReason: 'CAPABILITY_POLICY_DENIED',
        reason: explicitVal === false
          ? `Capability "${capability}" is explicitly denied by canonical capabilities policy`
          : `Capability "${capability}" is missing from canonical capabilities policy (fail-closed)`,
        mode: this.mode
      };
    }

    // 2. Strict Mode default (no capabilities map supplied)
    if (this.mode === 'strict') {
      return {
        allowed: false,
        capability,
        blockedReason: 'CAPABILITY_POLICY_DENIED',
        reason: `Capability "${capability}" is denied: strict authorization requires explicit capabilities declaration`,
        mode: 'strict'
      };
    }

    // 3. Explicit Legacy Mode opt-in: fallback to legacy boolean flags
    let legacyAllowed = false;
    switch (capability) {
      case 'workspace.read':
      case 'workspace.list':
        legacyAllowed = this.policy.allowFileRead === true;
        break;
      case 'workspace.write':
        legacyAllowed = (this.policy.allowFileCreate === true || this.policy.allowFileWrite === true);
        break;
      case 'workspace.delete':
        legacyAllowed = this.policy.allowFileDelete === true;
        break;
      case 'node.exec':
      case 'process.exec':
        legacyAllowed = this.policy.allowExec === true;
        break;
      default:
        legacyAllowed = false;
        break;
    }

    if (legacyAllowed) {
      return {
        allowed: true,
        capability,
        mode: 'legacy'
      };
    }

    return {
      allowed: false,
      capability,
      blockedReason: 'CAPABILITY_POLICY_DENIED',
      reason: `Capability "${capability}" is denied by legacy policy booleans`,
      mode: 'legacy'
    };
  }
}
