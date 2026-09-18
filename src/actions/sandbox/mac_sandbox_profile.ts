import fs from 'node:fs';
import path from 'node:path';
import { SandboxContext } from './types.js';

export interface GenerateMacSandboxProfileOptions {
  denyOutsideReads?: boolean;
  sensitiveDenyReadPaths?: string[];
  customAllowWritePaths?: string[];
}

/**
 * Builds a macOS Seatbelt (sandbox_init) profile string tailored to the execution context.
 *
 * Enforces:
 * 1. Process containment: process-fork and process-exec permitted for process spawning.
 * 2. Filesystem write containment: strictly restricted to canonical workspace path,
 *    temp subpaths within workspace, and standard pseudo-devices (/dev/null, /dev/zero, /dev/tty, /dev/dtracehelper).
 * 3. Network containment: network access denied unless 'network.outbound' capability is present in sandbox context.
 * 4. Filesystem read containment: system shared binaries/libs are readable, but outside sensitive paths
 *    or explicitly disallowed paths are denied.
 */
export function generateMacSandboxProfile(
  sandbox: SandboxContext,
  options: GenerateMacSandboxProfileOptions = {}
): string {
  const canonicalWs = fs.existsSync(sandbox.workspacePath)
    ? fs.realpathSync(sandbox.workspacePath)
    : path.resolve(sandbox.workspacePath);

  // Normalize /var -> /private/var and /tmp -> /private/tmp for macOS Seatbelt compatibility
  const normalizedWs = canonicalWs.startsWith('/var/')
    ? `/private${canonicalWs}`
    : canonicalWs.startsWith('/tmp/')
    ? `/private${canonicalWs}`
    : canonicalWs;

  const lines: string[] = [
    '(version 1)',
    '(allow default)',
    '',
    ';; === Filesystem Write Containment ===',
    '(deny file-write*)',
    `;; Explicitly allow write inside workspace`,
    `(allow file-write* (subpath "${normalizedWs}"))`
  ];

  if (normalizedWs !== canonicalWs) {
    lines.push(`(allow file-write* (subpath "${canonicalWs}"))`);
  }

  // Additional explicitly allowed write paths (e.g. temporary subdirectories)
  if (options.customAllowWritePaths && options.customAllowWritePaths.length > 0) {
    for (const p of options.customAllowWritePaths) {
      lines.push(`(allow file-write* (subpath "${p}"))`);
    }
  }

  // Standard device writes required for basic CLI output and POSIX operations
  lines.push(
    '(allow file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper") (literal "/dev/tty"))'
  );

  lines.push('');
  lines.push(';; === Network Containment ===');
  if (!sandbox.networkAllowed) {
    lines.push(';; network.outbound capability absent -> deny all network operations');
    lines.push('(deny network*)');
  } else {
    lines.push(';; network.outbound capability present -> allow network operations');
    lines.push('(allow network*)');
  }

  lines.push('');
  lines.push(';; === Filesystem Read Containment ===');
  if (options.sensitiveDenyReadPaths && options.sensitiveDenyReadPaths.length > 0) {
    for (const p of options.sensitiveDenyReadPaths) {
      const norm = p.startsWith('/tmp') || p.startsWith('/var')
        ? `/private${p}`
        : p;
      lines.push(`(deny file-read* (subpath "${norm}"))`);
      if (norm !== p) {
        lines.push(`(deny file-read* (subpath "${p}"))`);
      }
    }
  }

  return lines.join('\n');
}
