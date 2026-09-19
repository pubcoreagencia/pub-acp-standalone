// src/discovery/DiscoveryOrchestrator.ts

import { IDiscoveryProvider } from "./IDiscoveryProvider";
import {
  DiscoveryScope,
  DiscoveryResult,
  DiscoveryStatus,
  DiscoveryProviderStatus,
  DiscoveryProviderResult,
  DiscoverySource,
} from "./DiscoveryContracts";
import { ProjectCandidate } from "./ProjectCandidate";
import { IWorkspaceCanonicalizer } from "./IWorkspaceCanonicalizer";

export class DiscoveryOrchestrator {
  private readonly providers: IDiscoveryProvider[];
  private readonly canonicalizer: IWorkspaceCanonicalizer;

  constructor(
    providers: IDiscoveryProvider[] = [],
    canonicalizer: IWorkspaceCanonicalizer
  ) {
    this.providers = [...providers];
    this.canonicalizer = canonicalizer;
  }

  public addProvider(provider: IDiscoveryProvider): void {
    this.providers.push(provider);
  }

  public async discover(scope: DiscoveryScope): Promise<DiscoveryResult> {
    const orchestratedAt = new Date().toISOString();
    const allDiagnostics: string[] = [];

    // Zero providers: semantically UNAVAILABLE as no provider source was queried
    if (this.providers.length === 0) {
      return {
        candidates: [],
        status: DiscoveryStatus.UNAVAILABLE,
        diagnostics: ["No discovery providers registered."],
        orchestratedAt,
      };
    }

    const abortController = new AbortController();
    let globalTimeoutTriggered = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    if (scope.timeoutMs && scope.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        globalTimeoutTriggered = true;
        abortController.abort();
      }, scope.timeoutMs);
    }

    // Execute all providers concurrently passing scope and signal
    const providerPromises = this.providers.map(async (provider): Promise<DiscoveryProviderResult> => {
      try {
        const res = await provider.discover(scope, abortController.signal);
        return res;
      } catch (err: unknown) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        const isAbort = abortController.signal.aborted || errorObj.name === "AbortError";
        return {
          candidates: [],
          status: isAbort ? DiscoveryProviderStatus.TIMEOUT : DiscoveryProviderStatus.FAILURE,
          diagnostics: [
            `Provider '${provider.name}' failed: ${errorObj.message}`,
          ],
          source: "filesystem" as DiscoverySource,
          providerName: provider.name,
          discoveredAt: new Date().toISOString(),
        };
      }
    });

    let providerResults: DiscoveryProviderResult[] = [];
    try {
      providerResults = await Promise.all(providerPromises);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }

    // Aggregate provider results & diagnostics
    const rawCandidates: ProjectCandidate[] = [];
    let hasSuccess = false;
    let hasCandidates = false;
    let hasFailureOrTimeout = false;
    let allUnavailableOrFailure = true;

    for (const res of providerResults) {
      if (res.diagnostics && res.diagnostics.length > 0) {
        allDiagnostics.push(...res.diagnostics);
      }

      if (
        res.status === DiscoveryProviderStatus.SUCCESS ||
        res.status === DiscoveryProviderStatus.EMPTY
      ) {
        allUnavailableOrFailure = false;
        if (res.status === DiscoveryProviderStatus.SUCCESS) {
          hasSuccess = true;
          if (res.candidates && res.candidates.length > 0) {
            hasCandidates = true;
            rawCandidates.push(...res.candidates);
          }
        }
      } else if (
        res.status === DiscoveryProviderStatus.FAILURE ||
        res.status === DiscoveryProviderStatus.TIMEOUT ||
        res.status === DiscoveryProviderStatus.UNAVAILABLE
      ) {
        hasFailureOrTimeout = true;
      }
    }

    // Process & canonicalize candidates
    const validCandidates: ProjectCandidate[] = [];

    for (const candidate of rawCandidates) {
      const pathToCanonicalize =
        candidate.canonicalWorkspacePath ||
        candidate.originalWorkspacePath ||
        "";

      const canonicalResult = await this.canonicalizer.canonicalize(pathToCanonicalize);

      if (canonicalResult.success) {
        validCandidates.push({
          ...candidate,
          canonicalWorkspacePath: canonicalResult.canonicalPath,
          originalWorkspacePath:
            candidate.originalWorkspacePath || pathToCanonicalize,
        });
      } else {
        allDiagnostics.push(
          `Candidate '${candidate.candidateId}' discarded: canonicalization failed with error ${canonicalResult.error}: ${canonicalResult.message || "Unknown error"}`
        );
      }
    }

    // Deduplicate strictly by canonicalWorkspacePath
    // Retain repositoryIdentity as secondary metadata; do not remove candidates sharing repo identity
    const seenWorkspaces = new Set<string>();
    const deduplicatedCandidates: ProjectCandidate[] = [];

    for (const cand of validCandidates) {
      if (!seenWorkspaces.has(cand.canonicalWorkspacePath)) {
        seenWorkspaces.add(cand.canonicalWorkspacePath);
        deduplicatedCandidates.push(cand);
      }
    }

    // Deterministic sorting (alphabetical by canonicalWorkspacePath)
    deduplicatedCandidates.sort((a, b) =>
      a.canonicalWorkspacePath.localeCompare(b.canonicalWorkspacePath)
    );

    // Apply maxCandidates limit strictly after deterministic sort
    let finalCandidates = deduplicatedCandidates;
    if (scope.maxCandidates && scope.maxCandidates > 0) {
      finalCandidates = finalCandidates.slice(0, scope.maxCandidates);
    }

    // Determine overall DiscoveryStatus
    let overallStatus: DiscoveryStatus;

    if (globalTimeoutTriggered && !hasSuccess) {
      overallStatus = DiscoveryStatus.TIMEOUT;
    } else if (allUnavailableOrFailure) {
      overallStatus = DiscoveryStatus.UNAVAILABLE;
    } else if (hasSuccess && hasFailureOrTimeout) {
      overallStatus = DiscoveryStatus.PARTIAL_FAILURE;
    } else if (!hasSuccess && hasFailureOrTimeout) {
      overallStatus = DiscoveryStatus.PARTIAL_FAILURE;
    } else if (hasCandidates && finalCandidates.length > 0) {
      overallStatus = DiscoveryStatus.SUCCESS_WITH_CANDIDATES;
    } else {
      overallStatus = DiscoveryStatus.SUCCESS_EMPTY;
    }

    return {
      candidates: finalCandidates,
      status: overallStatus,
      diagnostics: allDiagnostics.length > 0 ? allDiagnostics : undefined,
      orchestratedAt,
    };
  }
}
