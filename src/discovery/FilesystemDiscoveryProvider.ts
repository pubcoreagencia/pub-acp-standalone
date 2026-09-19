// src/discovery/FilesystemDiscoveryProvider.ts

import * as fs from "fs/promises";
import * as path from "path";
import { IDiscoveryProvider } from "./IDiscoveryProvider";
import {
  DiscoveryScope,
  DiscoveryProviderResult,
  DiscoveryProviderStatus,
  DiscoverySource,
} from "./DiscoveryContracts";
import { ProjectCandidate } from "./ProjectCandidate";

/**
 * Read-only discovery provider scanning designated roots in the filesystem.
 * Adheres strictly to bounded traversal:
 * - Traverses only explicitly configured roots (never whole drives or implicit roots).
 * - Enforces maxDepth strictly.
 * - Stops traversal promptly when maxCandidates is reached.
 * - Respects AbortSignal prior to every I/O call and directory step.
 * - Does NOT follow symlinks or junctions to guarantee avoidance of loops or unbounded expansion.
 * - Fails soft on permission/read errors per subtree without crashing overall discovery.
 * - Never invents project IDs, repository identity or authorization flags.
 */
export class FilesystemDiscoveryProvider implements IDiscoveryProvider {
  public readonly name = "FilesystemDiscoveryProvider";
  public readonly source: DiscoverySource = "filesystem";

  public async discover(
    scope: DiscoveryScope,
    signal: AbortSignal
  ): Promise<DiscoveryProviderResult> {
    const discoveredAt = new Date().toISOString();
    const diagnostics: string[] = [];
    const candidates: ProjectCandidate[] = [];

    // Check cancellation immediately
    if (signal.aborted) {
      return {
        candidates: [],
        status: DiscoveryProviderStatus.TIMEOUT,
        diagnostics: ["Discovery aborted before traversal started."],
        source: this.source,
        providerName: this.name,
        discoveredAt,
      };
    }

    // Explicit roots required - no full disk scan allowed
    if (!scope.roots || scope.roots.length === 0) {
      return {
        candidates: [],
        status: DiscoveryProviderStatus.UNAVAILABLE,
        diagnostics: ["No discovery roots configured. Full-disk scanning is prohibited."],
        source: this.source,
        providerName: this.name,
        discoveredAt,
      };
    }

    const maxDepth = typeof scope.maxDepth === "number" && scope.maxDepth >= 0 ? scope.maxDepth : 5;
    const maxCandidates =
      typeof scope.maxCandidates === "number" && scope.maxCandidates > 0
        ? scope.maxCandidates
        : Number.POSITIVE_INFINITY;

    let hadErrors = false;

    for (const root of scope.roots) {
      if (signal.aborted) {
        break;
      }
      if (candidates.length >= maxCandidates) {
        break;
      }

      // Verify root existence and directory type
      let rootStat;
      try {
        rootStat = await fs.lstat(root);
      } catch (err: unknown) {
        hadErrors = true;
        diagnostics.push(`Root inaccessible '${root}': ${(err as Error).message}`);
        continue;
      }

      if (!rootStat.isDirectory()) {
        hadErrors = true;
        diagnostics.push(`Root path '${root}' is not a directory.`);
        continue;
      }

      // Check if root itself is a workspace/repository
      if (await this.isWorkspaceCandidate(root, signal)) {
        candidates.push(this.createCandidate(root, discoveredAt));
        // Once a folder is identified as a workspace root, do not descend into its internals (e.g. submodules or internal dirs)
        continue;
      }

      // Traverse subdirectories recursively up to maxDepth
      try {
        await this.traverseDirectory(
          root,
          1,
          maxDepth,
          maxCandidates,
          candidates,
          diagnostics,
          discoveredAt,
          signal
        );
      } catch (err: unknown) {
        hadErrors = true;
        diagnostics.push(`Error traversing root '${root}': ${(err as Error).message}`);
      }
    }

    if (signal.aborted) {
      return {
        candidates: [],
        status: DiscoveryProviderStatus.TIMEOUT,
        diagnostics: [...diagnostics, "Discovery aborted during traversal."],
        source: this.source,
        providerName: this.name,
        discoveredAt,
      };
    }

    if (candidates.length >= maxCandidates) {
      diagnostics.push("Candidate limit reached.");
    }

    // Stable deterministic sorting by path
    candidates.sort((a, b) =>
      (a.originalWorkspacePath || "").localeCompare(b.originalWorkspacePath || "")
    );

    let status: DiscoveryProviderStatus;
    if (candidates.length > 0) {
      status = DiscoveryProviderStatus.SUCCESS;
    } else if (hadErrors && candidates.length === 0) {
      status = DiscoveryProviderStatus.FAILURE;
    } else {
      status = DiscoveryProviderStatus.EMPTY;
    }

    return {
      candidates,
      status,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
      source: this.source,
      providerName: this.name,
      discoveredAt,
    };
  }

  private async traverseDirectory(
    dirPath: string,
    currentDepth: number,
    maxDepth: number,
    maxCandidates: number,
    candidates: ProjectCandidate[],
    diagnostics: string[],
    discoveredAt: string,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted || currentDepth > maxDepth || candidates.length >= maxCandidates) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (err: unknown) {
      // Fail-soft on permission or access errors for this subtree
      diagnostics.push(`Permission/read error on '${dirPath}': ${(err as Error).message}`);
      return;
    }

    for (const entry of entries) {
      if (signal.aborted || candidates.length >= maxCandidates) {
        return;
      }

      // Skip non-directory entries and skip symlinks/junctions entirely to prevent loops
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        const entryName = entry.name;
        // Ignore standard internal/ignored directories
        if (
          entryName === ".git" ||
          entryName === "node_modules" ||
          entryName === ".gemini" ||
          entryName === ".idea" ||
          entryName === ".vscode"
        ) {
          continue;
        }

        const childPath = path.join(dirPath, entryName);

        // Check if child directory is a workspace candidate
        if (await this.isWorkspaceCandidate(childPath, signal)) {
          candidates.push(this.createCandidate(childPath, discoveredAt));
          // Do not traverse children of an identified workspace
          continue;
        }

        // Otherwise recurse if depth allows
        await this.traverseDirectory(
          childPath,
          currentDepth + 1,
          maxDepth,
          maxCandidates,
          candidates,
          diagnostics,
          discoveredAt,
          signal
        );
      }
    }
  }

  /**
   * Evaluates whether a directory is a workspace candidate.
   * Recognizes `.git` (which can be a directory in regular repos or a file in worktrees/submodules).
   */
  private async isWorkspaceCandidate(
    dirPath: string,
    signal: AbortSignal
  ): Promise<boolean> {
    if (signal.aborted) {
      return false;
    }

    const gitTarget = path.join(dirPath, ".git");
    try {
      // lstat works for both files and directories, and doesn't follow symlinks
      const stat = await fs.lstat(gitTarget);
      return stat.isDirectory() || stat.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Constructs a typed ProjectCandidate adhering to pure discovery invariants.
   * No projectId or repositoryIdentity is invented.
   */
  private createCandidate(
    workspacePath: string,
    discoveredAt: string
  ): ProjectCandidate {
    return {
      candidateId: `fs-${Buffer.from(workspacePath).toString("hex").slice(0, 16)}`,
      canonicalWorkspacePath: workspacePath, // Orchestrator handles real canonicalization via IWorkspaceCanonicalizer
      originalWorkspacePath: workspacePath,
      discoverySource: this.source,
      providerName: this.name,
      discoveredAt,
      scratchSignals: [],
    };
  }
}
