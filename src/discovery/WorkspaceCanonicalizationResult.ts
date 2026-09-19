// src/discovery/WorkspaceCanonicalizationResult.ts

import { WorkspaceCanonicalizationError } from "./WorkspaceCanonicalizationError";

/**
 * Result of attempting to canonicalise a workspace path.
 * The result is a discriminated union so callers can reliably determine success
 * vs. failure without relying on exceptions or implicit "fallback" behaviour.
 */
export type WorkspaceCanonicalizationResult =
  | {
      /** Successful resolution */
      success: true;
      /** Fully resolved, case‑folded absolute path */
      canonicalPath: string;
    }
  | {
      /** Resolution failed */
      success: false;
      /** Enumerated error indicating why canonicalisation failed */
      error: WorkspaceCanonicalizationError;
      /** Optional human‑readable message providing extra context */
      message?: string;
    };
