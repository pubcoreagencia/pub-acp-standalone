import { EventEmitter } from 'node:events';
import { AutonomyEvent } from './types.js';
import { sanitizeObject } from './sanitizer.js';

export type EventListener = (event: AutonomyEvent) => void;

export interface IEventBus {
  publish(event: AutonomyEvent): void;
  subscribe(runIdOrWildcard: string, listener: EventListener): () => void;
  getRecentEvents(runId?: string, limit?: number): AutonomyEvent[];
  clear(): void;
}

export class EventBus implements IEventBus {
  private readonly emitter = new EventEmitter();
  private readonly history: AutonomyEvent[] = [];
  private readonly maxHistoryPerRun: number;

  constructor(maxHistoryPerRun = 500) {
    this.maxHistoryPerRun = maxHistoryPerRun;
    this.emitter.setMaxListeners(100);
  }

  publish(event: AutonomyEvent): void {
    const sanitizedEvent = sanitizeObject(event);
    this.history.push(sanitizedEvent);

    // Prune history per run if it exceeds limit
    const runEvents = this.history.filter(e => e.runId === sanitizedEvent.runId);
    if (runEvents.length > this.maxHistoryPerRun) {
      const excess = runEvents.length - this.maxHistoryPerRun;
      let removed = 0;
      for (let i = 0; i < this.history.length && removed < excess; i++) {
        if (this.history[i].runId === sanitizedEvent.runId) {
          this.history.splice(i, 1);
          removed++;
          i--;
        }
      }
    }

    // Emit run-specific event
    this.emitter.emit(`run:${sanitizedEvent.runId}`, sanitizedEvent);
    // Emit wildcard event
    this.emitter.emit('event', sanitizedEvent);
  }

  subscribe(runIdOrWildcard: string, listener: EventListener): () => void {
    const eventName = runIdOrWildcard === '*' ? 'event' : `run:${runIdOrWildcard}`;
    this.emitter.on(eventName, listener);
    return () => {
      this.emitter.off(eventName, listener);
    };
  }

  getRecentEvents(runId?: string, limit = 100): AutonomyEvent[] {
    const events = runId
      ? this.history.filter(e => e.runId === runId)
      : this.history;
    return events.slice(-limit);
  }

  clear(): void {
    this.history.length = 0;
    this.emitter.removeAllListeners();
  }
}
