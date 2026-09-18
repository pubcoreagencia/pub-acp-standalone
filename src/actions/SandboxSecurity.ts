import fs from 'node:fs';
import path from 'node:path';

export interface SandboxSecurityOptions {
  disallowShellOperators?: boolean;
  disallowExternalPathArgs?: boolean;
}

export class SandboxSecurity {
  // Shell operators that attempt process chaining, redirection, or subshells
  private static readonly SHELL_METACHARS = [
    ';', '&&', '||', '|', '`', '$(', '<', '>', '&'
  ];

  /**
   * Detects dangerous shell operators in raw command string.
   */
  static containsShellMetacharacters(command: string): { dangerous: boolean; char?: string } {
    for (const meta of SandboxSecurity.SHELL_METACHARS) {
      if (command.includes(meta)) {
        return { dangerous: true, char: meta };
      }
    }
    return { dangerous: false };
  }

  /**
   * Checks whether an argument looks like a filesystem path and points outside workspace.
   */
  static isExternalPathArgument(workspaceRoot: string, arg: string): { external: boolean; path?: string; reason?: string } {
    if (!arg || typeof arg !== 'string') return { external: false };

    // Ignore command flags, options, inline node code or tiny strings
    if (arg.startsWith('-') || arg.length < 2) return { external: false };

    // If argument is code or contains newlines / quotes, skip path check
    if (arg.includes('\n') || arg.includes(';') || arg.includes('=')) return { external: false };

    // 1. Explicit external directory prefixes
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (
      arg.startsWith('/tmp') ||
      arg.startsWith('/etc') ||
      arg.startsWith('/var') ||
      arg.startsWith('/usr') ||
      arg.startsWith('/bin') ||
      arg.startsWith('/sbin') ||
      arg.startsWith('/opt') ||
      (homeDir && arg.startsWith(homeDir)) ||
      /^[a-zA-Z]:[\\\/]/.test(arg)
    ) {
      // Check if it's actually within workspaceRoot
      const resolved = path.resolve(arg);
      const rel = path.relative(workspaceRoot, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return { external: true, path: arg, reason: `Argument references external absolute path "${arg}"` };
      }
    }

    // 2. Relative traversal inside argument
    if (arg.includes('../') || arg.includes('..\\') || arg === '..') {
      const resolved = path.resolve(workspaceRoot, arg);
      const rel = path.relative(workspaceRoot, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return { external: true, path: arg, reason: `Argument references escaping relative path "${arg}"` };
      }
    }

    // 3. Symlink argument traversal
    try {
      const resolved = path.resolve(workspaceRoot, arg);
      if (fs.existsSync(resolved)) {
        const canonicalWs = fs.realpathSync(workspaceRoot);
        const canonicalArg = fs.realpathSync(resolved);
        const rel = path.relative(canonicalWs, canonicalArg);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          return { external: true, path: arg, reason: `Argument references external symlink target "${canonicalArg}"` };
        }
      }
    } catch {
      // File doesn't exist or cannot be read, ignore
    }

    return { external: false };
  }
}
