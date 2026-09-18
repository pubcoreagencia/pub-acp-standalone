import {
  ProcessSandboxAdapter,
  SandboxContext,
  SandboxExecutionOptions,
  SandboxExecutionResult,
  SandboxProviderType
} from './types.js';
import { ExecutionCapability } from '../types.js';

/**
 * MacOSSandboxAdapter
 *
 * Architecture & Feasibility Analysis for macOS:
 * - Primitives evaluated: App Sandbox, Entitlements, XPC Services, Process Launch Constraints.
 * - Current Status on macOS: App Sandbox restricts files outside container via entitlements,
 *   requiring codesigning with entitlements and separate helper process via XPC.
 * - Deprecated / Inadvisable: sandbox-exec (deprecated / private Seatbelt API).
 * - Honest Classification: NOT YET AVAILABLE / LIMITATION without native compiled XPC helper.
 */
export class MacOSSandboxAdapter implements ProcessSandboxAdapter {
  readonly provider: SandboxProviderType = 'macos-sandbox';
  readonly isPlatformSupported: boolean = process.platform === 'darwin';

  prepare(workspacePath: string, capabilities: ExecutionCapability[]): SandboxContext {
    return {
      provider: this.provider,
      platform: 'darwin',
      workspacePath,
      grantedCapabilities: [...capabilities],
      childProcessAllowed: capabilities.includes('process.child_process'),
      networkAllowed: capabilities.includes('network.outbound' as any),
      workerAllowed: capabilities.includes('process.worker' as any),
      fsReadPaths: [workspacePath],
      fsWritePaths: [workspacePath],
      metadata: {
        status: 'LIMITATION',
        nativeXpcHelperRequired: true,
        entitlementsRequired: ['com.apple.security.app-sandbox', 'com.apple.security.files.user-selected.read-write']
      }
    };
  }

  execute(
    sandbox: SandboxContext,
    executable: string,
    argv: string[],
    options?: SandboxExecutionOptions
  ): SandboxExecutionResult {
    // Fail-Closed: Do NOT do silent fallback to unsandboxed OS execution
    return {
      success: false,
      exitCode: 126,
      stdout: '',
      stderr: 'MacOSSandboxAdapter: Native OS-level App Sandbox / XPC helper is not yet deployed on this host. Execution blocked by fail-closed policy.',
      command: `${executable} ${argv.join(' ')}`,
      executable,
      argv,
      blockedReason: 'MACOS_OS_SANDBOX_LIMITATION',
      isSandboxed: false,
      provider: this.provider,
      platform: 'darwin'
    };
  }
}

/**
 * WindowsSandboxAdapter
 *
 * Architecture & Feasibility Analysis for Windows:
 * - Primitives evaluated: Restricted Token, Job Objects, AppContainer, Windows Sandbox.
 * - Microsoft documentation: AppContainer isolates filesystem/network, CreateProcessInAppContainer API is experimental.
 * - Honest Classification: NOT YET AVAILABLE / LIMITATION without native Win32/C++ Job Object / AppContainer helper.
 */
export class WindowsSandboxAdapter implements ProcessSandboxAdapter {
  readonly provider: SandboxProviderType = 'windows-sandbox';
  readonly isPlatformSupported: boolean = process.platform === 'win32';

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
        status: 'LIMITATION',
        appContainerExperimental: true,
        jobObjectHelperRequired: true
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
      stderr: 'WindowsSandboxAdapter: Native Win32 AppContainer / Job Object helper is not yet deployed on this host. Execution blocked by fail-closed policy.',
      command: `${executable} ${argv.join(' ')}`,
      executable,
      argv,
      blockedReason: 'WINDOWS_OS_SANDBOX_LIMITATION',
      isSandboxed: false,
      provider: this.provider,
      platform: 'win32'
    };
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
