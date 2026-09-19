// src/discovery/WorkspaceCanonicalizationError.ts

/**
 * Enumerates the possible failure modes when canonicalising a workspace path.
 * These errors are used by {@link IWorkspaceCanonicalizer} to convey why a
 * path could not be turned into a safe, canonical absolute form.
 */
export enum WorkspaceCanonicalizationError {
  /** The supplied path does not exist on the filesystem. */
  PathNotFound = "PathNotFound",
  /** The process lacks permission to read the path. */
  PermissionDenied = "PermissionDenied",
  /** The path is syntactically invalid (e.g., contains illegal characters). */
  InvalidPath = "InvalidPath",
  /** A symlink/junction loop was detected while resolving the path. */
  SymlinkLoop = "SymlinkLoop",
  /** Realpath resolution failed for an unexpected reason. */
  RealpathFailed = "RealpathFailed",
}
