import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  AntigravityExecutionResult,
  AntigravityPromptOptions,
  AntigravityRawCliResponse
} from './types.js';

export interface AntigravityTransportConfig {
  agyPath?: string;
  defaultTimeoutMs?: number;
  defaultCwd?: string;
}

export class AntigravityTransport {
  private readonly agyPath: string;
  private readonly defaultTimeoutMs: number;
  private readonly defaultCwd: string;

  constructor(config: AntigravityTransportConfig = {}) {
    this.agyPath = config.agyPath || 'C:\\Users\\Matheus Paes\\AppData\\Local\\agy\\bin\\agy.exe';
    this.defaultTimeoutMs = config.defaultTimeoutMs || 300000;
    this.defaultCwd = config.defaultCwd || process.cwd();
  }

  async health(): Promise<{ status: 'ok' | 'error'; agyPath: string; version?: string; error?: string }> {
    return new Promise((resolve) => {
      const proc = spawn(this.agyPath, ['--help'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('error', (err) => {
        resolve({
          status: 'error',
          agyPath: this.agyPath,
          error: `Failed to spawn agy: ${err.message}`
        });
      });

      proc.on('close', (code) => {
        const combined = stdout + stderr;
        if (code === 0 && combined.includes('Usage of agy.exe')) {
          resolve({
            status: 'ok',
            agyPath: this.agyPath
          });
        } else {
          resolve({
            status: 'error',
            agyPath: this.agyPath,
            error: stderr || `Process exited with code ${code}`
          });
        }
      });
    });
  }

  async sendPrompt(prompt: string, options: AntigravityPromptOptions = {}): Promise<AntigravityExecutionResult> {
    const startTime = Date.now();
    const requestId = options.request_id || `ag-req-${randomUUID()}`;
    const sessionId = options.session_id || `ag-session-${randomUUID()}`;
    const timeoutMs = options.timeout_ms || this.defaultTimeoutMs;
    const cwd = options.cwd || this.defaultCwd;

    const args: string[] = ['--print', prompt, '--output-format', 'json'];

    if (cwd) {
      args.push('--add-dir', cwd);
    }

    if (options.conversation_id) {
      args.push('--conversation', options.conversation_id);
    }

    if (options.dangerouslySkipPermissions !== false) {
      args.push('--dangerously-skip-permissions');
    }

    if (options.effort) {
      args.push('--effort', options.effort);
    }

    if (options.model) {
      args.push('--model', options.model);
    }

    return new Promise((resolve) => {
      let isTimedOut = false;
      const proc = spawn(this.agyPath, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        isTimedOut = true;
        try {
          proc.kill();
        } catch {}
      }, timeoutMs);

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        resolve({
          request_id: requestId,
          session_id: sessionId,
          conversation_id: options.conversation_id || null,
          status: 'FAILED',
          response: '',
          duration_ms: durationMs,
          error: {
            code: 'SPAWN_ERROR',
            message: err.message
          }
        });
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        if (isTimedOut) {
          resolve({
            request_id: requestId,
            session_id: sessionId,
            conversation_id: options.conversation_id || null,
            status: 'TIMEOUT',
            response: stdout.trim(),
            duration_ms: durationMs,
            error: {
              code: 'TIMEOUT',
              message: `Antigravity CLI execution timed out after ${timeoutMs}ms`
            }
          });
          return;
        }

        if (code !== 0 && !stdout.trim()) {
          resolve({
            request_id: requestId,
            session_id: sessionId,
            conversation_id: options.conversation_id || null,
            status: 'FAILED',
            response: '',
            duration_ms: durationMs,
            error: {
              code: 'CLI_ERROR',
              message: stderr.trim() || `CLI exited with code ${code}`
            }
          });
          return;
        }

        try {
          const raw = JSON.parse(stdout.trim()) as AntigravityRawCliResponse;
          const status = raw.status === 'SUCCESS' ? 'COMPLETED' : 'FAILED';
          resolve({
            request_id: requestId,
            session_id: sessionId,
            conversation_id: raw.conversation_id || options.conversation_id || null,
            status,
            response: raw.response || '',
            duration_ms: durationMs,
            num_turns: raw.num_turns,
            usage: raw.usage,
            error: raw.error ? { code: 'EXECUTION_ERROR', message: raw.error } : undefined,
            metadata: {
              raw_status: raw.status,
              duration_seconds: raw.duration_seconds
            }
          });
        } catch (parseErr: any) {
          resolve({
            request_id: requestId,
            session_id: sessionId,
            conversation_id: options.conversation_id || null,
            status: code === 0 ? 'COMPLETED' : 'FAILED',
            response: stdout.trim(),
            duration_ms: durationMs,
            error: code !== 0 ? {
              code: 'UNPARSEABLE_OUTPUT',
              message: stderr.trim() || parseErr.message
            } : undefined
          });
        }
      });
    });
  }

  async sendPromptInConversation(
    conversationId: string,
    prompt: string,
    options: Omit<AntigravityPromptOptions, 'conversation_id'> = {}
  ): Promise<AntigravityExecutionResult> {
    return this.sendPrompt(prompt, {
      ...options,
      conversation_id: conversationId
    });
  }
}
