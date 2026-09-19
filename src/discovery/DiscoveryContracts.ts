// src/discovery/DiscoveryContracts.ts

import { ProjectCandidate } from "./ProjectCandidate";

/** Enumeration of discovery sources. */
export type DiscoverySource = "filesystem" | "git" | "antigravity" | "cwd";

/** Status values for an individual provider result. */
export enum DiscoveryProviderStatus {
  /** Provider succeeded and returned one or more candidates. */
  SUCCESS = "SUCCESS",
  /** Provider succeeded but returned no candidates. */
  EMPTY = "EMPTY",
  /** Provider failed due to an error. */
  FAILURE = "FAILURE",
  /** Provider timed out or was aborted. */
  TIMEOUT = "TIMEOUT",
  /** Provider could not be reached or is unavailable. */
  UNAVAILABLE = "UNAVAILABLE",
}

/** Result returned by a discovery provider. */
export interface DiscoveryProviderResult {
  /** Candidates discovered by this provider. */
  candidates: ProjectCandidate[];
  /** Provider status. */
  status: DiscoveryProviderStatus;
  /** Optional diagnostic messages (errors, warnings, etc.). */
  diagnostics?: string[];
  /** Source of this provider (filesystem, git, …). */
  source: DiscoverySource;
  /** Human‑readable name of the concrete provider implementation. */
  providerName: string;
  /** ISO timestamp when this provider produced its result. */
  discoveredAt: string;
}

/** Overall discovery status after orchestration. */
export enum DiscoveryStatus {
  /** At least one provider returned candidates. */
  SUCCESS_WITH_CANDIDATES = "SUCCESS_WITH_CANDIDATES",
  /** All providers succeeded but no candidates were found. */
  SUCCESS_EMPTY = "SUCCESS_EMPTY",
  /** Some providers failed or timed out, but at least one succeeded. */
  PARTIAL_FAILURE = "PARTIAL_FAILURE",
  /** All providers failed or were unavailable. */
  UNAVAILABLE = "UNAVAILABLE",
  /** Orchestration timed out before completing. */
  TIMEOUT = "TIMEOUT",
}

/** Scope and limits for a discovery operation. */
export interface DiscoveryScope {
  /** Root paths to search (absolute, canonical). */
  roots: string[];
  /** Maximum directory depth to traverse (optional). */
  maxDepth?: number;
  /** Upper bound on total candidates returned (optional). */
  maxCandidates?: number;
  /** Timeout for the whole discovery run in ms (optional). */
  timeoutMs?: number;
}

/** Result of the orchestrated discovery run. */
export interface DiscoveryResult {
  /** Normalized, deduplicated candidates */
  candidates: ProjectCandidate[];
  /** Overall status */
  status: DiscoveryStatus;
  /** Diagnostics collected from each provider (if any). */
  diagnostics?: string[];
  /** Timestamp when orchestration completed. */
  orchestratedAt: string;
}
