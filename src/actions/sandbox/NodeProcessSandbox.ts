import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ExecutionCapability } from '../types.js';
import {
  ProcessSandboxAdapter,
  SandboxContext,
  SandboxExecutionOptions,
  SandboxExecutionResult,
  SandboxProviderType
} from './types.js';

export interface NodeProcessSandboxOptions {
  nodeBinaryPath?: string;
  allowSystemNodeModules?: boolean;
}

/**
 * NodeProcessSandbox
 *
 * Implements real process-level restriction leveraging Node.js Modern Permission Model:
 * - --permission enabled
 * - --allow-fs-read restricted strictly to canonical workspace path
 * - --allow-fs-write restricted strictly to canonical workspace path
 * - --allow-child-process granted ONLY if 'process.child_process' capability is present
 * - --allow-net granted ONLY if 'network.outbound' capability is present
 * - --allow-worker, --allow-ffi, --allow-wasi denied by default
 *
 * Fail-Closed: If command tries to escape workspace or spawn child process without capability,
 * the Node.js V8 runtime permission system raises ERR_ACCESS_DENIED.
 */
export class NodeProcessSandbox implements ProcessSandboxAdapter {
  readonly provider: SandboxProviderType = 'node-permission';
  readonly isPlatformSupported: boolean = true;

  private readonly nodeBinaryPath: string;

  constructor(options: NodeProcessSandboxOptions = {}) {
    this.nodeBinaryPath = options.nodeBinaryPath || process.execPath;
  }

  prepare(
    workspacePath: string,
    capabilities: ExecutionCapability[]
  ): SandboxContext {
    if (!workspacePath || typeof workspacePath !== 'string') {
      throw new Error('Workspace path must be a non-empty string');
    }

    const canonicalWorkspace = fs.existsSync(workspacePath)
      ? fs.realpathSync(workspacePath)
      : path.resolve(workspacePath);

    const childAllowed = capabilities.includes('process.child_process');
    const netAllowed = capabilities.includes('network.outbound');
    const workerAllowed = capabilities.includes('process.worker' as any);

    return {
      provider: this.provider,
      platform: process.platform,
      workspacePath: canonicalWorkspace,
      grantedCapabilities: [...capabilities],
      childProcessAllowed: childAllowed,
      networkAllowed: netAllowed,
      workerAllowed: workerAllowed,
      fsReadPaths: [canonicalWorkspace, `${canonicalWorkspace}/*`],
      fsWritePaths: [canonicalWorkspace, `${canonicalWorkspace}/*`]
    };
  }

  execute(
    sandbox: SandboxContext,
    executable: string,
    argv: string[],
    options: SandboxExecutionOptions = {}
  ): SandboxExecutionResult {
    const cwd = options.cwd || sandbox.workspacePath;
    const timeoutMs = options.timeoutMs ?? 30000;
    const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024;
    const baseExec = path.basename(executable);

    // If target executable is node, we wrap with the Node Permission Model flags
    if (baseExec === 'node' || executable === process.execPath) {
      const permissionFlags: string[] = ['--permission'];

      // Restrict filesystem read/write strictly to workspace
      permissionFlags.push(`--allow-fs-read=${sandbox.workspacePath}`);
      permissionFlags.push(`--allow-fs-read=${sandbox.workspacePath}/*`);
      permissionFlags.push(`--allow-fs-write=${sandbox.workspacePath}`);
      permissionFlags.push(`--allow-fs-write=${sandbox.workspacePath}/*`);

      // Child processes denied unless explicit capability granted
      if (sandbox.childProcessAllowed) {
        permissionFlags.push('--allow-child-process');
      }

      // Network denied unless explicit capability granted
      if (sandbox.networkAllowed) {
        permissionFlags.push('--allow-net');
      }

      if (sandbox.workerAllowed) {
        permissionFlags.push('--allow-worker');
      }

      const fullArgv = [...permissionFlags, ...argv];
      const cmdString = `${executable} ${argv.join(' ')}`;

      try {
        const stdout = execFileSync(this.nodeBinaryPath, fullArgv, {
          cwd,
          timeout: timeoutMs,
          maxBuffer,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            ...(options.env || {}),
            PWD: cwd
          }
        });

        return {
          success: true,
          exitCode: 0,
          stdout,
          stderr: '',
          command: cmdString,
          executable,
          argv,
          isSandboxed: true,
          provider: this.provider,
          platform: sandbox.platform
        };
      } catch (err: any) {
        const stdout = err.stdout ? String(err.stdout) : '';
        const stderr = err.stderr ? String(err.stderr) : '';
        const isTimeout = (err.killed && err.signal === 'SIGTERM') || err.code === 'ETIMEDOUT';
        const exitCode = typeof err.status === 'number' ? err.status : 1;

        let blockedReason: string | undefined;
        // Check specific permissions first before general ERR_ACCESS_DENIED
        if (stderr.includes('ChildProcess') || stderr.includes('Use --allow-child-process')) {
          blockedReason = 'NODE_PERMISSION_CHILD_PROCESS_DENIED';
        } else if (stderr.includes('WorkerThreads') || stderr.includes('Use --allow-worker')) {
          blockedReason = 'NODE_PERMISSION_WORKER_DENIED';
        } else if (stderr.includes('Network') || stderr.includes('--allow-net') || stderr.includes('getaddrinfo ERR_ACCESS_DENIED')) {
          blockedReason = 'NODE_PERMISSION_NETWORK_DENIED';
        } else if (stderr.includes('FileSystemRead') || stderr.includes('FileSystemWrite') || stderr.includes('ERR_ACCESS_DENIED')) {
          blockedReason = 'NODE_PERMISSION_FS_DENIED';
        }

        const msg = isTimeout
          ? `Command timed out after ${timeoutMs}ms`
          : stderr.trim() || stdout.trim() || err.message;

        return {
          success: false,
          exitCode,
          stdout,
          stderr: msg,
          command: cmdString,
          executable,
          argv,
          blockedReason,
          isSandboxed: true,
          provider: this.provider,
          platform: sandbox.platform
        };
      }
    }

    // For non-node binaries: direct execution with shell: false and cwd containment
    const cmdString = `${executable} ${argv.join(' ')}`;
    try {
      const stdout = execFileSync(executable, argv, {
        cwd,
        timeout: timeoutMs,
        maxBuffer,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...(options.env || {}),
          PWD: cwd
        }
      });

      return {
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
        command: cmdString,
        executable,
        argv,
        isSandboxed: false, // Explicitly false: non-node binary without OS-level container
        provider: 'restricted-process',
        platform: sandbox.platform
      };
    } catch (err: any) {
      const stdout = err.stdout ? String(err.stdout) : '';
      const stderr = err.stderr ? String(err.stderr) : '';
      const isTimeout = (err.killed && err.signal === 'SIGTERM') || err.code === 'ETIMEDOUT';
      const exitCode = typeof err.status === 'number' ? err.status : 1;

      const msg = isTimeout
        ? `Command timed out after ${timeoutMs}ms`
        : stderr.trim() || stdout.trim() || err.message;

      return {
        success: false,
        exitCode,
        stdout,
        stderr: msg,
        command: cmdString,
        executable,
        argv,
        isSandboxed: false,
        provider: 'restricted-process',
        platform: sandbox.platform
      };
    }
  }
}
