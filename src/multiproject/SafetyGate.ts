import { ResolutionResult, SafetyGateResult } from './types.js';

export class SafetyGate {
  evaluate(resolution: ResolutionResult): SafetyGateResult {
    if (!resolution.ok || !resolution.context) {
      return {
        passed: false,
        reason: resolution.reason || 'SECURITY_RULE_VIOLATION',
        message: resolution.message || 'Safety Gate blocked execution due to invalid resolution.',
        details: resolution.details
      };
    }

    const { context } = resolution;

    // Strict validation of mandatory fields
    if (!context.runId || !context.workspacePath || !context.projectId || !context.repository) {
      return {
        passed: false,
        reason: 'SECURITY_RULE_VIOLATION',
        message: 'ExecutionContext is missing mandatory fields (runId, workspacePath, projectId, repository).',
        details: { context }
      };
    }

    // Disallow root directory or sensitive parent paths
    const normalized = context.workspacePath.replace(/\\/g, '/').toLowerCase();
    if (normalized === '/' || /^[a-z]:\/?$/i.test(normalized)) {
      return {
        passed: false,
        reason: 'SECURITY_RULE_VIOLATION',
        message: `Execution in root filesystem is blocked: '${context.workspacePath}'`,
        details: { workspacePath: context.workspacePath }
      };
    }

    return {
      passed: true,
      context
    };
  }
}
