// src/discovery/WorkspaceCanonicalizer.ts

import { IWorkspaceCanonicalizer } from "./IWorkspaceCanonicalizer";
import { WorkspaceCanonicalizationResult } from "./WorkspaceCanonicalizationResult";
import { WorkspaceCanonicalizationError } from "./WorkspaceCanonicalizationError";
import * as path from "path";
import * as fs from "fs";

/**
 * Concrete implementation of {@link IWorkspaceCanonicalizer} for the current OS.
 * It resolves paths to absolute, real (symlink‑resolved) and case‑folded forms on Windows.
 * Errors are mapped to {@link WorkspaceCanonicalizationError} values.
 */
export class WorkspaceCanonicalizer implements IWorkspaceCanonicalizer {
  async canonicalize(inputPath: string): Promise<WorkspaceCanonicalizationResult> {
    // Resolve to absolute path first (relative to cwd if needed)
    let absolutePath: string;
    try {
      absolutePath = path.isAbsolute(inputPath)
        ? inputPath
        : path.resolve(process.cwd(), inputPath);
    } catch (e) {
      return {
        success: false,
        error: WorkspaceCanonicalizationError.InvalidPath,
        message: (e as Error).message,
      };
    }

    try {
      const realPath = fs.realpathSync.native(absolutePath);
      // On Windows we perform case‑folding to achieve deterministic matching
      const canonicalPath = process.platform === "win32" ? realPath.toLowerCase() : realPath;
      return { success: true, canonicalPath };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      let errorEnum: WorkspaceCanonicalizationError;
      switch (err.code) {
        case "ENOENT":
          errorEnum = WorkspaceCanonicalizationError.PathNotFound;
          break;
        case "EACCES":
          errorEnum = WorkspaceCanonicalizationError.PermissionDenied;
          break;
        case "EINVAL":
          errorEnum = WorkspaceCanonicalizationError.InvalidPath;
          break;
        case "ELOOP":
          errorEnum = WorkspaceCanonicalizationError.SymlinkLoop;
          break;
        default:
          errorEnum = WorkspaceCanonicalizationError.RealpathFailed;
      }
      return { success: false, error: errorEnum, message: err.message };
    }
  }
}
