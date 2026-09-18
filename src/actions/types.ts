export type ActionType = 'FILE_CREATE' | 'FILE_WRITE' | 'FILE_READ' | 'FILE_DELETE' | 'EXEC';

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
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  output?: string;
  error?: string;
}

export interface ActionBatchExecutionResult {
  results: ActionResult[];
  appliedFiles: string[];
  readFiles: Record<string, string>;
  deletedFiles: string[];
  executedCommands: Array<{ command: string; exitCode: number; stdout: string; stderr: string }>;
  summary: string;
}
