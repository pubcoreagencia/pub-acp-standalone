import { RunModel, AutonomyEvent, RunState } from './types.js';
import { sanitizeObject } from './sanitizer.js';

export interface IRunStore {
  getRuns(): RunModel[];
  getRun(runId: string): RunModel | undefined;
  saveRun(run: RunModel): void;
  appendEvent(runId: string, event: AutonomyEvent): void;
  updateState(runId: string, status: RunState, updates?: Partial<RunModel>): void;
  clear(): void;
}

export class MemoryRunStore implements IRunStore {
  private readonly runs = new Map<string, RunModel>();

  getRuns(): RunModel[] {
    return Array.from(this.runs.values()).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  getRun(runId: string): RunModel | undefined {
    return this.runs.get(runId);
  }

  saveRun(run: RunModel): void {
    const sanitized = sanitizeObject(run);
    this.runs.set(run.runId, sanitized);
  }

  appendEvent(runId: string, event: AutonomyEvent): void {
    const run = this.runs.get(runId);
    const sanitizedEvent = sanitizeObject(event);
    if (run) {
      run.events.push(sanitizedEvent);
      if (run.startedAt) {
        run.durationMs = Math.max(0, new Date(sanitizedEvent.timestamp).getTime() - new Date(run.startedAt).getTime());
      }
    }
  }

  updateState(runId: string, status: RunState, updates?: Partial<RunModel>): void {
    const run = this.runs.get(runId);
    if (run) {
      run.status = status;
      if (updates) {
        Object.assign(run, sanitizeObject(updates));
      }
      if (status === 'COMPLETED' || status === 'FAILED' || status === 'STOPPED') {
        run.finishedAt = new Date().toISOString();
        if (run.startedAt) {
          run.durationMs = Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime());
        }
      }
    }
  }

  clear(): void {
    this.runs.clear();
  }
}
