// src/discovery/ProjectCandidate.ts

import { DiscoverySource } from "./DiscoveryContracts";

/**
 * Identity of a Git repository (logical identity).
 */
export interface RepositoryIdentity {
  remoteUrl?: string;
  repoUuid?: string;
}

/**
 * Physical workspace identity.
 */
export interface WorkspaceIdentity {
  /** Fully resolved, case‑folded absolute path */
  canonicalWorkspacePath: string;
}

/**
 * Core ProjectCandidate produced by discovery providers.
 * Contains identity, observation, heuristic and provenance fields.
 */
export interface ProjectCandidate extends WorkspaceIdentity {
  /** Unique identifier for this candidate (e.g., UUID). */
  candidateId: string;
  /** Optional repository logical identity. */
  repositoryIdentity?: RepositoryIdentity;
  /** Optional explicit projectId derived from trusted source. */
  projectId?: string;
  /** Original path supplied by the provider (may be relative or non‑canonical). */
  originalWorkspacePath?: string;
  /** Current Git branch (if known). */
  currentBranch?: string;
  /** HEAD commit SHA (if known). */
  headCommitSha?: string;
  /** Remote URLs (if known). */
  remotes?: string[];
  /** Worktree specific information, opaque to discovery. */
  worktreeInfo?: Record<string, unknown>;
  /** Source of discovery (enumerated). */
  discoverySource: DiscoverySource;
  /** Name of the concrete provider that produced this candidate. */
  providerName: string;
  /** Timestamp when the provider discovered this candidate (ISO string). */
  discoveredAt: string;
  /** Heuristic confidence (0‑1). */
  confidence?: number;
  /** Arbitrary signals detected during discovery. */
  scratchSignals?: string[];
  /** Antigravity inference data, if any. */
  antigravityInference?: Record<string, unknown>;
}
