// src/discovery/GitDiscoveryProvider.ts

import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { IDiscoveryProvider } from "./IDiscoveryProvider";
import {
  DiscoveryScope,
  DiscoveryProviderResult,
  DiscoveryProviderStatus,
  DiscoverySource,
} from "./DiscoveryContracts";
import { ProjectCandidate, RepositoryIdentity } from "./ProjectCandidate";

const execFileAsync = promisify(execFile);

export interface GitCommandRunner {
  run(
    args: string[],
    cwd: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<{ stdout: string; stderr: string }>;
}

export class DefaultGitCommandRunner implements GitCommandRunner {
  async run(
    args: string[],
    cwd: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<{ stdout: string; stderr: string }> {
    // execFile does not invoke a shell, protecting against shell injection
    return await execFileAsync("git", args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024, // 1MB output limit
      signal,
      encoding: "utf8",
    });
  }
}

/**
 * Read-only discovery provider scanning and enriching Git repositories across designated roots.
 * Guarantees:
 * - Operates strictly on explicitly provided roots.
 * - Only runs fixed, immutable, read-only Git subcommands via execFile (no shell injection).
 * - Never executes mutating commands (no clone, fetch, pull, push, checkout, reset, clean, etc.).
 * - Enforces per-command timeout and respects AbortSignal.
 * - Separates Repository Identity (remoteUrl/repoUuid) from Physical Workspace Identity.
 * - Never collapses distinct physical workspaces sharing identical remotes (e.g. worktrees).
 * - Derives projectId only when trusted remote origin is configured (matching catalog convention); undefined otherwise.
 * - Read-only isolation: never modifies authorization stores and confers no execution grants.
 */
export class GitDiscoveryProvider implements IDiscoveryProvider {
  public readonly name = "GitDiscoveryProvider";
  public readonly source: DiscoverySource = "git";
  private readonly gitRunner: GitCommandRunner;

  constructor(gitRunner: GitCommandRunner = new DefaultGitCommandRunner()) {
    this.gitRunner = gitRunner;
  }

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
        diagnostics: ["Git discovery aborted before traversal started."],
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
    const commandTimeoutMs =
      typeof scope.timeoutMs === "number" && scope.timeoutMs > 0
        ? Math.min(scope.timeoutMs, 5000)
        : 5000;

    let hadErrors = false;

    for (const root of scope.roots) {
      if (signal.aborted) {
        break;
      }
      if (candidates.length >= maxCandidates) {
        diagnostics.push("Candidate limit reached.");
        break;
      }

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

      // Check if root itself is a Git workspace
      if (await this.isGitWorkspace(root, signal)) {
        const cand = await this.inspectGitWorkspace(
          root,
          commandTimeoutMs,
          discoveredAt,
          diagnostics,
          signal
        );
        if (cand) {
          candidates.push(cand);
        }
        continue;
      }

      // Traverse subdirectories bounded by maxDepth
      try {
        await this.traverseDirectory(
          root,
          1,
          maxDepth,
          maxCandidates,
          commandTimeoutMs,
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
        diagnostics: [...diagnostics, "Git discovery aborted during traversal."],
        source: this.source,
        providerName: this.name,
        discoveredAt,
      };
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
    commandTimeoutMs: number,
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
      diagnostics.push(`Permission/read error on '${dirPath}': ${(err as Error).message}`);
      return;
    }

    for (const entry of entries) {
      if (signal.aborted || candidates.length >= maxCandidates) {
        return;
      }

      // Skip symlinks/junctions entirely to prevent traversal loops
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        const entryName = entry.name;
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

        if (await this.isGitWorkspace(childPath, signal)) {
          const cand = await this.inspectGitWorkspace(
            childPath,
            commandTimeoutMs,
            discoveredAt,
            diagnostics,
            signal
          );
          if (cand) {
            candidates.push(cand);
          }
          // Once a Git workspace is found, do not descend into its internal directory tree
          continue;
        }

        await this.traverseDirectory(
          childPath,
          currentDepth + 1,
          maxDepth,
          maxCandidates,
          commandTimeoutMs,
          candidates,
          diagnostics,
          discoveredAt,
          signal
        );
      }
    }
  }

  private async isGitWorkspace(dirPath: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) {
      return false;
    }
    const gitTarget = path.join(dirPath, ".git");
    try {
      const stat = await fs.lstat(gitTarget);
      return stat.isDirectory() || stat.isFile();
    } catch {
      return false;
    }
  }

  private async inspectGitWorkspace(
    workspacePath: string,
    timeoutMs: number,
    discoveredAt: string,
    diagnostics: string[],
    signal: AbortSignal
  ): Promise<ProjectCandidate | null> {
    if (signal.aborted) {
      return null;
    }

    try {
      // 1. Verify it is a valid Git worktree and find top-level
      const revParseRes = await this.gitRunner.run(
        ["rev-parse", "--show-toplevel"],
        workspacePath,
        timeoutMs,
        signal
      );
      const topLevel = revParseRes.stdout.trim() || workspacePath;

      // 2. Query branch name (--show-current returns empty string on detached HEAD)
      const branchRes = await this.gitRunner.run(
        ["branch", "--show-current"],
        topLevel,
        timeoutMs,
        signal
      );
      const rawBranch = branchRes.stdout.trim();
      const currentBranch = rawBranch.length > 0 ? rawBranch : "HEAD (detached)";

      // 3. Query HEAD commit SHA
      const commitRes = await this.gitRunner.run(
        ["rev-parse", "HEAD"],
        topLevel,
        timeoutMs,
        signal
      );
      const headCommitSha = commitRes.stdout.trim() || undefined;

      // 4. Query remotes and remote URLs
      const remotesListRes = await this.gitRunner.run(
        ["remote"],
        topLevel,
        timeoutMs,
        signal
      );
      const remoteNames = remotesListRes.stdout
        .split("\n")
        .map((r) => r.trim())
        .filter((r) => r.length > 0);

      const remotes: string[] = [];
      let originUrl: string | undefined;

      for (const name of remoteNames) {
        try {
          const urlRes = await this.gitRunner.run(
            ["config", "--get", `remote.${name}.url`],
            topLevel,
            timeoutMs,
            signal
          );
          const url = urlRes.stdout.trim();
          if (url) {
            remotes.push(url);
            if (name === "origin") {
              originUrl = url;
            }
          }
        } catch {
          // Non-fatal if a specific remote has no URL configured
        }
      }

      // If no origin, fallback to first remote if available
      const primaryRemoteUrl = originUrl || (remotes.length > 0 ? remotes[0] : undefined);

      // 5. Derive repositoryIdentity
      const repositoryIdentity: RepositoryIdentity | undefined = primaryRemoteUrl
        ? { remoteUrl: primaryRemoteUrl }
        : undefined;

      // 6. Derive projectId only when trusted remote origin is configured (matching catalog convention)
      let projectId: string | undefined;
      if (originUrl) {
        const repoSlug = originUrl
          .replace(/^git@github\.com:/, "")
          .replace(/^https:\/\/github\.com\//, "")
          .replace(/\.git$/, "")
          .trim();
        projectId = repoSlug.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      }

      // 7. Check if worktree or subproject (.git file vs directory)
      let isWorktree = false;
      try {
        const gitStat = await fs.lstat(path.join(topLevel, ".git"));
        isWorktree = gitStat.isFile();
      } catch {
        // Ignored
      }

      const candidateId = `git-${Buffer.from(topLevel).toString("hex").slice(0, 16)}`;

      return {
        candidateId,
        canonicalWorkspacePath: topLevel,
        originalWorkspacePath: topLevel,
        projectId,
        repositoryIdentity,
        currentBranch,
        headCommitSha,
        remotes: remotes.length > 0 ? remotes : undefined,
        worktreeInfo: isWorktree ? { isWorktree: true } : undefined,
        discoverySource: this.source,
        providerName: this.name,
        discoveredAt,
        scratchSignals: [],
      };
    } catch (err: unknown) {
      diagnostics.push(
        `Failed to inspect Git workspace at '${workspacePath}': ${(err as Error).message}`
      );
      return null;
    }
  }
}
