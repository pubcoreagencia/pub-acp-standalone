import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ProcessSandboxAdapter,
  SandboxContext,
  SandboxExecutionOptions,
  SandboxExecutionResult,
  SandboxProviderType
} from './types.js';
import { ExecutionCapability } from '../types.js';
import { generateMacSandboxProfile, GenerateMacSandboxProfileOptions } from './mac_sandbox_profile.js';

export interface MacOSSandboxAdapterOptions {
  launcherPath?: string;
  profileOptions?: GenerateMacSandboxProfileOptions;
}

/**
 * MacOSSandboxAdapter
 *
 * Implements native macOS process containment leveraging the kernel Seatbelt sandbox
 * via a compiled native C launcher (bin/mac_sandbox_launcher) that calls sandbox_init().
 *
 * Enforces:
 * - Fail-Closed: If running on non-Darwin or if native binary helper is unavailable,
 *   execution is BLOCKED with blockedReason: 'SANDBOX_UNAVAILABLE'.
 * - Contention:
 *   1. file-write* denied globally, permitted strictly to canonical workspacePath.
 *   2. network* denied unless 'network.outbound' capability is present.
 *   3. file-read* denied for external sensitive paths.
 *   4. child processes spawned by fork/exec inherit the kernel sandbox containment.
 * - Accurate isSandboxed flag: Set to true ONLY when actually wrapped by the native sandbox.
 */
export class MacOSSandboxAdapter implements ProcessSandboxAdapter {
  readonly provider: SandboxProviderType = 'macos-sandbox';
  readonly isPlatformSupported: boolean = process.platform === 'darwin';

  private readonly launcherPath: string;
  private readonly profileOptions: GenerateMacSandboxProfileOptions;

  constructor(options: MacOSSandboxAdapterOptions = {}) {
    this.launcherPath = options.launcherPath || path.resolve(process.cwd(), 'bin', 'mac_sandbox_launcher');
    this.profileOptions = options.profileOptions || {};
  }

  prepare(workspacePath: string, capabilities: ExecutionCapability[]): SandboxContext {
    const canonicalWs = fs.existsSync(workspacePath)
      ? fs.realpathSync(workspacePath)
      : path.resolve(workspacePath);

    return {
      provider: this.provider,
      platform: 'darwin',
      workspacePath: canonicalWs,
      grantedCapabilities: [...capabilities],
      childProcessAllowed: capabilities.includes('process.child_process'),
      networkAllowed: capabilities.includes('network.outbound'),
      workerAllowed: capabilities.includes('process.worker' as any),
      fsReadPaths: [canonicalWs],
      fsWritePaths: [canonicalWs],
      metadata: {
        launcherPath: this.launcherPath,
        launcherExists: fs.existsSync(this.launcherPath)
      }
    };
  }

  execute(
    sandbox: SandboxContext,
    executable: string,
    argv: string[],
    options: SandboxExecutionOptions = {}
  ): SandboxExecutionResult {
    const cmdString = `${executable} ${argv.join(' ')}`;

    // Fail-Closed: Must be on darwin platform
    if (!this.isPlatformSupported) {
      return {
        success: false,
        exitCode: 126,
        stdout: '',
        stderr: 'MacOSSandboxAdapter: Target platform is not macOS (darwin). Execution blocked by fail-closed policy.',
        command: cmdString,
        executable,
        argv,
        blockedReason: 'SANDBOX_UNAVAILABLE',
        isSandboxed: false,
        provider: this.provider,
        platform: process.platform
      };
    }

    // Fail-Closed: Native sandbox launcher must exist and be executable
    if (!fs.existsSync(this.launcherPath)) {
      return {
        success: false,
        exitCode: 126,
        stdout: '',
        stderr: `MacOSSandboxAdapter: Native sandbox launcher not found at "${this.launcherPath}". Native sandbox mechanism is unavailable.`,
        command: cmdString,
        executable,
        argv,
        blockedReason: 'SANDBOX_UNAVAILABLE',
        isSandboxed: false,
        provider: this.provider,
        platform: 'darwin'
      };
    }

    const cwd = options.cwd || sandbox.workspacePath;
    const timeoutMs = options.timeoutMs ?? 30000;
    const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024;

    // Generate macOS sandbox profile string
    const profile = generateMacSandboxProfile(sandbox, this.profileOptions);

    // Build launcher argv: [launcherPath, profile, executable, ...argv]
    const launcherArgv = [profile, executable, ...argv];

    try {
      const stdout = execFileSync(this.launcherPath, launcherArgv, {
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
        platform: 'darwin'
      };
    } catch (err: any) {
      const stdout = err.stdout ? String(err.stdout) : '';
      const stderr = err.stderr ? String(err.stderr) : '';
      const isTimeout = (err.killed && err.signal === 'SIGTERM') || err.code === 'ETIMEDOUT';
      const exitCode = typeof err.status === 'number' ? err.status : 1;

      let blockedReason: string | undefined;

      // Classify macOS Seatbelt sandbox violations
      const combinedOutput = `${stderr}\n${stdout}`;
      if (
        combinedOutput.includes('Operation not permitted') ||
        combinedOutput.includes('sandbox_init failed') ||
        combinedOutput.includes('PermissionError: [Errno 1]')
      ) {
        if (!sandbox.networkAllowed && (
          combinedOutput.includes('urlopen error') ||
          combinedOutput.includes('Couldn\'t connect to server') ||
          combinedOutput.includes('Immediate connect fail') ||
          combinedOutput.includes('socket.py') ||
          combinedOutput.includes('urllib')
        )) {
          blockedReason = 'MACOS_SANDBOX_NETWORK_DENIED';
        } else if (combinedOutput.includes('file-write') || combinedOutput.includes('write') || combinedOutput.includes('Operation not permitted')) {
          blockedReason = 'MACOS_SANDBOX_FS_DENIED';
        } else {
          blockedReason = 'MACOS_SANDBOX_VIOLATION';
        }
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
        platform: 'darwin'
      };
    }
  }
}

export interface WindowsSandboxAdapterOptions {
  launcherPath?: string;
}

/**
 * WindowsSandboxAdapter
 *
 * Architecture & Feasibility Analysis for Windows:
 * - Primitives evaluated: Win32 Job Objects, AppContainer, Restricted Token.
 * - Native Enforcement Specification:
 *   * Uses bin/win_sandbox_launcher.exe compiled from bin/win_sandbox_launcher.c.
 *   * Win32 Job Object enforces process tree containment, active process limit (child process containment),
 *     and tree-wide termination on timeout (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE).
 * - Fail-Closed Guarantee:
 *   * If running on non-Windows host (e.g. darwin/linux) or if native launcher binary is missing,
 *     MUST NOT execute unsandboxed or mask execution.
 *   * Execution is immediately BLOCKED with blockedReason: 'SANDBOX_UNAVAILABLE' and isSandboxed: false.
 */
export class WindowsSandboxAdapter implements ProcessSandboxAdapter {
  readonly provider: SandboxProviderType = 'windows-sandbox';
  readonly isPlatformSupported: boolean = process.platform === 'win32';

  private readonly launcherPath: string;

  constructor(options: WindowsSandboxAdapterOptions = {}) {
    this.launcherPath = options.launcherPath || path.resolve(process.cwd(), 'bin', 'win_sandbox_launcher.exe');
  }

  prepare(workspacePath: string, capabilities: ExecutionCapability[]): SandboxContext {
    return {
      provider: this.provider,
      platform: 'win32',
      workspacePath,
      grantedCapabilities: [...capabilities],
      childProcessAllowed: capabilities.includes('process.child_process'),
      networkAllowed: capabilities.includes('network.outbound' as any),
      workerAllowed: capabilities.includes('process.worker' as any),
      fsReadPaths: [workspacePath],
      fsWritePaths: [workspacePath],
      metadata: {
        launcherPath: this.launcherPath,
        launcherExists: fs.existsSync(this.launcherPath),
        isPlatformSupported: this.isPlatformSupported
      }
    };
  }

  execute(
    sandbox: SandboxContext,
    executable: string,
    argv: string[],
    options: SandboxExecutionOptions = {}
  ): SandboxExecutionResult {
    const cmdString = `${executable} ${argv.join(' ')}`;

    // Fail-Closed: Must be on win32 platform
    if (!this.isPlatformSupported) {
      return {
        success: false,
        exitCode: 126,
        stdout: '',
        stderr: 'WindowsSandboxAdapter: Current host platform is not Windows (win32). Native Windows sandbox enforcement is unavailable on this host.',
        command: cmdString,
        executable,
        argv,
        blockedReason: 'SANDBOX_UNAVAILABLE',
        isSandboxed: false,
        provider: this.provider,
        platform: process.platform
      };
    }

    // Fail-Closed: Native sandbox launcher executable must exist
    if (!fs.existsSync(this.launcherPath)) {
      return {
        success: false,
        exitCode: 126,
        stdout: '',
        stderr: `WindowsSandboxAdapter: Native Windows sandbox launcher not found at "${this.launcherPath}". Native sandbox mechanism is unavailable.`,
        command: cmdString,
        executable,
        argv,
        blockedReason: 'SANDBOX_UNAVAILABLE',
        isSandboxed: false,
        provider: this.provider,
        platform: 'win32'
      };
    }

    const cwd = options.cwd || sandbox.workspacePath;
    const timeoutMs = options.timeoutMs ?? 30000;
    const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024;
    const allowChildFlag = sandbox.childProcessAllowed ? '1' : '0';

    const launcherArgv = [allowChildFlag, String(timeoutMs), executable, ...argv];

    try {
      const stdout = execFileSync(this.launcherPath, launcherArgv, {
        cwd,
        timeout: timeoutMs + 2000,
        maxBuffer,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...(options.env || {})
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
        platform: 'win32'
      };
    } catch (err: any) {
      const stdout = err.stdout ? String(err.stdout) : '';
      const stderr = err.stderr ? String(err.stderr) : '';
      const exitCode = typeof err.status === 'number' ? err.status : 1;

      let blockedReason: string | undefined;
      if (exitCode === 124 || stderr.includes('timed out')) {
        blockedReason = 'TIMEOUT';
      } else if (stderr.includes('Access is denied') || stderr.includes('ERROR_ACCESS_DENIED')) {
        blockedReason = 'WINDOWS_SANDBOX_ACCESS_DENIED';
      }

      return {
        success: false,
        exitCode,
        stdout,
        stderr: stderr.trim() || stdout.trim() || err.message,
        command: cmdString,
        executable,
        argv,
        blockedReason,
        isSandboxed: true,
        provider: this.provider,
        platform: 'win32'
      };
    }
  }
}

/**
 * LinuxSandboxAdapter
 *
 * Architecture & Feasibility Analysis for Linux:
 * - Primitives evaluated: Landlock LSM, seccomp-bpf, user namespaces, cgroups.
 * - Landlock kernel feature allows unprivileged processes to enforce filesystem and IPC restrictions.
 * - Honest Classification: NOT YET AVAILABLE / LIMITATION without native C/Rust Landlock wrapper binary.
 */
export class LinuxSandboxAdapter implements ProcessSandboxAdapter {
  readonly provider: SandboxProviderType = 'linux-sandbox';
  readonly isPlatformSupported: boolean = process.platform === 'linux';

  prepare(workspacePath: string, capabilities: ExecutionCapability[]): SandboxContext {
    return {
      provider: this.provider,
      platform: 'linux',
      workspacePath,
      grantedCapabilities: [...capabilities],
      childProcessAllowed: capabilities.includes('process.child_process'),
      networkAllowed: capabilities.includes('network.outbound' as any),
      workerAllowed: capabilities.includes('process.worker' as any),
      fsReadPaths: [workspacePath],
      fsWritePaths: [workspacePath],
      metadata: {
        status: 'LIMITATION',
        landlockLsmAvailable: true,
        nativeLandlockWrapperRequired: true
      }
    };
  }

  execute(
    sandbox: SandboxContext,
    executable: string,
    argv: string[],
    options?: SandboxExecutionOptions
  ): SandboxExecutionResult {
    return {
      success: false,
      exitCode: 126,
      stdout: '',
      stderr: 'LinuxSandboxAdapter: Native Linux Landlock/seccomp wrapper binary is not yet deployed on this host. Execution blocked by fail-closed policy.',
      command: `${executable} ${argv.join(' ')}`,
      executable,
      argv,
      blockedReason: 'LINUX_OS_SANDBOX_LIMITATION',
      isSandboxed: false,
      provider: this.provider,
      platform: 'linux'
    };
  }
}
