// src/discovery/IWorkspaceCanonicalizer.ts

import { WorkspaceCanonicalizationResult } from "./WorkspaceCanonicalizationResult";

/**
 * Abstraction for turning arbitrary workspace paths into a canonical, case‑folded absolute path.
 * Implementations must be pure (no side‑effects) and must return a discriminated union indicating
 * success or the concrete error that prevented canonicalisation.
 */
export interface IWorkspaceCanonicalizer {
  /**
   * Resolve a path to its canonical form.
   * @param path The user‑provided workspace path (absolute, relative, or symbolic).
   * @returns A promise resolving to a {@link WorkspaceCanonicalizationResult}.
   */
  canonicalize(path: string): Promise<WorkspaceCanonicalizationResult>;
}
