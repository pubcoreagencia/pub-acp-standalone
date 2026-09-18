export type ActionType = 'FILE_CREATE' | 'FILE_WRITE' | 'FILE_READ' | 'FILE_DELETE' | 'EXEC';

export type ExecutionCapability =
  | 'workspace.read'
  | 'workspace.write'
  | 'workspace.delete'
  | 'workspace.list'
  | 'git.read'
  | 'git.mutate'
  | 'npm.test'
  | 'npm.build'
  | 'npm.run'
  | 'node.exec'
  | 'process.exec'
  | 'process.child_process'
  | 'network.outbound'
  | 'browser.status'
  | 'browser.navigate'
  | 'browser.read'
  | 'browser.screenshot';

export interface FileCreateAction {
  type: 'FILE_CREATE';
  path: string;
  content: string;
}

export interface FileWriteAction {
  type: 'FILE_WRITE';
  path: string;
  content: string;
}

export interface FileReadAction {
  type: 'FILE_READ';
  path: string;
}

export interface FileDeleteAction {
  type: 'FILE_DELETE';
  path: string;
}

export interface ExecAction {
  type: 'EXEC';
  command: string;
}

export type ActionDirective =
  | FileCreateAction
  | FileWriteAction
  | FileReadAction
  | FileDeleteAction
  | ExecAction;

export interface ActionResult {
  action: ActionDirective;
  capability: ExecutionCapability;
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  output?: string;
  error?: string;
  blockedReason?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutedCommandResult {
  command: string;
  executable: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  isSandboxed?: boolean;
  sandboxProvider?: string;
}

export interface ActionBatchExecutionResult {
  results: ActionResult[];
  appliedFiles: string[];
  readFiles: Record<string, string>;
  deletedFiles: string[];
  executedCommands: ExecutedCommandResult[];
  summary: string;
}

export type PolicyAuthorizationMode = 'strict' | 'legacy';

export interface ActionPolicy {
  capabilities?: Partial<Record<ExecutionCapability, boolean>>;
  authorizationMode?: PolicyAuthorizationMode;
  allowFileCreate?: boolean;
  allowFileWrite?: boolean;
  allowFileRead?: boolean;
  allowFileDelete?: boolean;
  allowExec?: boolean;
  allowedExecCommands?: string[];
  allowedExecutables?: string[];
  disallowShellOperators?: boolean;
  disallowExternalPathArgs?: boolean;
  execTimeoutMs?: number;
  sandboxProvider?: 'node-permission' | 'macos-sandbox' | 'windows-sandbox' | 'linux-sandbox' | 'restricted-process';
}
