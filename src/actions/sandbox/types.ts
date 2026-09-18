import { ExecutionCapability } from '../types.js';

export type SandboxProviderType =
  | 'node-permission'
  | 'macos-sandbox'
  | 'windows-sandbox'
  | 'linux-sandbox'
  | 'restricted-process';

export interface SandboxContext {
  provider: SandboxProviderType;
  platform: NodeJS.Platform;
  workspacePath: string;
  grantedCapabilities: ExecutionCapability[];
  childProcessAllowed: boolean;
  networkAllowed: boolean;
  workerAllowed: boolean;
  fsReadPaths: string[];
  fsWritePaths: string[];
  metadata?: Record<string, unknown>;
}

export interface SandboxExecutionOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
}

export interface SandboxExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  executable: string;
  argv: string[];
  blockedReason?: string;
  isSandboxed: boolean;
  provider: SandboxProviderType;
  platform: NodeJS.Platform;
}

export interface ProcessSandboxAdapter {
  readonly provider: SandboxProviderType;
  readonly isPlatformSupported: boolean;

  prepare(
    workspacePath: string,
    capabilities: ExecutionCapability[]
  ): SandboxContext;

  execute(
    sandbox: SandboxContext,
    executable: string,
    argv: string[],
    options?: SandboxExecutionOptions
  ): SandboxExecutionResult;

  dispose?(sandbox: SandboxContext): void;
}
