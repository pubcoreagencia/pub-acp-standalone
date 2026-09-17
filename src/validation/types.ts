/**
 * PUB ACP — Validation Contract
 * 
 * Defines canonical interfaces, types, and policies for post-AG code validation.
 * 
 * Semantics:
 * - NONE: Validation deliberately disabled. Conceptual outcome: SKIPPED.
 * - OPTIONAL: Informational validation.
 *   - PASS -> COMPLETE
 *   - FAIL -> COMPLETE + warning/telemetry
 *   - ERROR -> COMPLETE + warning/telemetry
 *   - missing command -> SKIPPED
 * - REQUIRED: Mandatory validation.
 *   - PASS -> COMPLETE
 *   - FAIL + available turn -> CORRECT
 *   - FAIL + no available turn -> FAIL
 *   - ERROR -> FAIL
 *   - missing command -> Invalid configuration / ERROR
 * 
 * Note: RUN_COMPLETED does not automatically equate to VALIDATION_PASSED.
 * Validation status and lifecycle status are orthogonal concepts.
 */

export type ValidationMode = 'NONE' | 'OPTIONAL' | 'REQUIRED';

export type ValidationStatus =
  | 'PASS'
  | 'FAIL'
  | 'ERROR'
  | 'SKIPPED';

export interface ValidationPolicy {
  mode: ValidationMode;
  command?: string;
  timeoutMs?: number;
}

export interface ValidationOutcome {
  status: ValidationStatus;
  exitCode?: number | null;
  summary: string;
  details?: string;
  durationMs: number;
}

export interface IProjectValidator {
  validate(
    workspacePath: string,
    policy: ValidationPolicy,
    context?: {
      runId: string;
      turn: number;
    }
  ): Promise<ValidationOutcome>;
}
