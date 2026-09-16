import { randomUUID } from 'node:crypto';
import { IEventBus } from './EventBus.js';
import { IRunStore } from './RunStore.js';
import { RunModel, AutonomyEvent } from './types.js';

export class DemoFeedGenerator {
  private activeTimeouts: NodeJS.Timeout[] = [];

  constructor(
    private readonly eventBus: IEventBus,
    private readonly runStore: IRunStore
  ) {}

  stop(): void {
    for (const t of this.activeTimeouts) {
      clearTimeout(t);
    }
    this.activeTimeouts = [];
  }

  generateDemoRun(runId = `DEMO-RUN-${Math.floor(100 + Math.random() * 900)}`): string {
    const startedAt = new Date().toISOString();
    const demoRun: RunModel = {
      runId,
      project: 'SAGAZ (Simulated Demo)',
      status: 'STARTING',
      isDemo: true,
      startedAt,
      durationMs: 0,
      gptTurns: 0,
      agExecutions: 0,
      corrections: 0,
      tests: {
        build: 'RUNNING',
        unit: 'RUNNING',
        integration: 'NOT_AVAILABLE',
        e2e: 'NOT_AVAILABLE',
        smoke: 'NOT_AVAILABLE'
      },
      deployStatus: {
        status: 'NOT_AVAILABLE',
        publicUrl: 'NOT_AVAILABLE',
        httpStatus: 'NOT_AVAILABLE',
        lastDeploy: 'NOT_AVAILABLE',
        version: 'NOT_AVAILABLE'
      },
      workspace: {
        path: 'c:\\Users\\Matheus Paes\\Documents\\ChatGPT\\pub-acp-standalone\\apps\\demo-app',
        changedFiles: [],
        fileCount: 14,
        gitStatus: 'clean',
        lastCommit: '9b3df01 feat(demo): initialize test environment'
      },
      gptView: {
        lastDecision: 'NOT_AVAILABLE',
        contextSummary: 'NOT_AVAILABLE',
        analyzedResult: 'NOT_AVAILABLE',
        nextAction: 'NOT_AVAILABLE',
        timestamp: 'NOT_AVAILABLE'
      },
      agView: {
        status: 'IDLE',
        currentExecution: 'NOT_AVAILABLE',
        commandOrAction: 'NOT_AVAILABLE',
        durationMs: 'NOT_AVAILABLE',
        stdoutSummary: 'NOT_AVAILABLE',
        stderrSummary: 'NOT_AVAILABLE',
        changedFiles: [],
        result: 'NOT_AVAILABLE'
      },
      events: []
    };

    this.runStore.saveRun(demoRun);

    const steps: Array<{
      delay: number;
      fn: () => void;
    }> = [
      {
        delay: 50,
        fn: () => {
          const evt: AutonomyEvent = {
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'RUN_STARTED',
            summary: '[DEMO MODE] Autonomous run started for SAGAZ demo project.'
          };
          this.eventBus.publish(evt);
          this.runStore.appendEvent(runId, evt);
          this.runStore.updateState(runId, 'GPT_THINKING');
        }
      },
      {
        delay: 600,
        fn: () => {
          const evt: AutonomyEvent = {
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'GPT_DECISION',
            turn: 1,
            summary: 'Analyzed workspace structure. Instructing Antigravity to create server entrypoint.',
            details: {
              decision: 'Create minimal HTTP server with health check',
              reasoning: 'Project needs operational verification endpoint before scaling features'
            }
          };
          this.eventBus.publish(evt);
          this.runStore.appendEvent(runId, evt);
          this.runStore.updateState(runId, 'AG_RUNNING', {
            gptTurns: 1,
            gptView: {
              lastDecision: 'Create minimal HTTP server with health check',
              contextSummary: 'Initial project setup turn 1',
              analyzedResult: 'Workspace structure confirmed',
              nextAction: 'Execute agy agent with server scaffolding prompt',
              timestamp: new Date().toISOString()
            }
          });
        }
      },
      {
        delay: 1200,
        fn: () => {
          const evt: AutonomyEvent = {
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'AG_STARTED',
            turn: 1,
            summary: 'Antigravity CLI dispatched for Turn 1 with scaffolding prompt.',
            details: {
              effort: 'low',
              timeoutMs: 300000
            }
          };
          this.eventBus.publish(evt);
          this.runStore.appendEvent(runId, evt);
          this.runStore.updateState(runId, 'AG_RUNNING', {
            agExecutions: 1,
            agView: {
              status: 'RUNNING',
              currentExecution: 'Turn 1 Execution',
              commandOrAction: 'agy agent --instruction Scaffold src/server.ts',
              durationMs: 'NOT_AVAILABLE',
              stdoutSummary: 'Spawning agent...',
              stderrSummary: '',
              changedFiles: ['src/server.ts'],
              result: 'IN_PROGRESS'
            }
          });
        }
      },
      {
        delay: 1800,
        fn: () => {
          const evt: AutonomyEvent = {
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'AG_OUTPUT',
            turn: 1,
            summary: 'File src/server.ts created. Wrote 45 lines with /health route.',
            details: {
              file: 'src/server.ts',
              lines: 45
            }
          };
          this.eventBus.publish(evt);
          this.runStore.appendEvent(runId, evt);
        }
      },
      {
        delay: 2400,
        fn: () => {
          const evt: AutonomyEvent = {
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'AG_FINISHED',
            turn: 1,
            summary: 'Antigravity Turn 1 completed successfully in 1.2s.',
            details: {
              durationMs: 1200,
              exitCode: 0
            }
          };
          this.eventBus.publish(evt);
          this.runStore.appendEvent(runId, evt);
          this.runStore.updateState(runId, 'VALIDATING', {
            workspace: {
              path: 'c:\\Users\\Matheus Paes\\Documents\\ChatGPT\\pub-acp-standalone\\apps\\demo-app',
              changedFiles: ['src/server.ts'],
              fileCount: 15,
              gitStatus: 'modified: src/server.ts',
              lastCommit: '9b3df01 feat(demo): initialize test environment'
            },
            agView: {
              status: 'COMPLETED',
              currentExecution: 'Turn 1 Scaffolding',
              commandOrAction: 'agy agent',
              durationMs: 1200,
              stdoutSummary: 'Successfully created server.ts with 45 lines.',
              stderrSummary: 'None',
              changedFiles: ['src/server.ts'],
              result: 'SUCCESS'
            }
          });
        }
      },
      {
        delay: 3000,
        fn: () => {
          const evt: AutonomyEvent = {
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'VALIDATION_STARTED',
            turn: 1,
            summary: 'Running test validation suite: build & unit tests.',
            details: { suite: 'unit' }
          };
          this.eventBus.publish(evt);
          this.runStore.appendEvent(runId, evt);
        }
      },
      {
        delay: 3600,
        fn: () => {
          const evt: AutonomyEvent = {
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'VALIDATION_RESULT',
            turn: 1,
            summary: 'Validation failed: TypeScript build error - missing type declaration in server.ts:12.',
            details: {
              build: 'FAIL',
              unit: 'SKIPPED',
              error: 'TS2304: Cannot find name Express'
            }
          };
          this.eventBus.publish(evt);
          this.runStore.appendEvent(runId, evt);
          this.runStore.updateState(runId, 'GPT_THINKING', {
            tests: {
              build: 'FAIL',
              unit: 'SKIPPED',
              integration: 'NOT_AVAILABLE',
              e2e: 'NOT_AVAILABLE',
              smoke: 'NOT_AVAILABLE',
              lastRunAt: new Date().toISOString(),
              details: 'TS2304: Cannot find name Express'
            }
          });
        }
      },
      {
        delay: 4200,
        fn: () => {
          const evt: AutonomyEvent = {
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'GPT_REVIEW',
            turn: 2,
            summary: 'GPT reviewing build failure. Planning fix for import and types.',
            details: { errorDetected: 'Missing node/express imports' }
          };
          this.eventBus.publish(evt);
          this.runStore.appendEvent(runId, evt);
        }
      },
      {
        delay: 4800,
        fn: () => {
          const evt: AutonomyEvent = {
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'CORRECTION',
            turn: 2,
            summary: 'Self-correction triggered. Replacing express imports with native node:http module.',
            details: { fixType: 'Replace dependency with native node module' }
          };
          this.eventBus.publish(evt);
          this.runStore.appendEvent(runId, evt);
          this.runStore.updateState(runId, 'AG_RUNNING', {
            corrections: 1,
            gptTurns: 2,
            gptView: {
              lastDecision: 'Switch to native node:http without 3rd party dependencies',
              contextSummary: 'Build failed on express import. Correcting to zero-dep implementation.',
              analyzedResult: 'TypeScript compile error resolved in memory',
              nextAction: 'Instruct AG to rewrite src/server.ts with native node:http',
              timestamp: new Date().toISOString()
            }
          });
        }
      },
      {
        delay: 5400,
        fn: () => {
          const evt: AutonomyEvent = {
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'AG_STARTED',
            turn: 2,
            summary: 'Antigravity executing correction in src/server.ts.',
            details: { action: 'write_to_file' }
          };
          this.eventBus.publish(evt);
          this.runStore.appendEvent(runId, evt);
          this.runStore.updateState(runId, 'AG_RUNNING', {
            agExecutions: 2
          });
        }
      },
      {
        delay: 6000,
        fn: () => {
          const evt: AutonomyEvent = {
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'AG_FINISHED',
            turn: 2,
            summary: 'Antigravity Turn 2 correction applied cleanly.',
            details: { durationMs: 600, exitCode: 0 }
          };
          this.eventBus.publish(evt);
          this.runStore.appendEvent(runId, evt);
          this.runStore.updateState(runId, 'VALIDATING', {
            tests: {
              build: 'PASS',
              unit: 'PASS',
              integration: 'NOT_AVAILABLE',
              e2e: 'NOT_AVAILABLE',
              smoke: 'PASS',
              lastRunAt: new Date().toISOString(),
              details: 'All tests passed cleanly'
            }
          });
        }
      },
      {
        delay: 6600,
        fn: () => {
          const evt: AutonomyEvent = {
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'DEPLOY_STARTED',
            turn: 2,
            summary: 'Deploying updated package artifact to preview environment.',
            details: { target: 'local-preview' }
          };
          this.eventBus.publish(evt);
          this.runStore.appendEvent(runId, evt);
          this.runStore.updateState(runId, 'DEPLOYING', {
            deployStatus: {
              status: 'RUNNING',
              publicUrl: 'http://localhost:5125/preview',
              httpStatus: 'NOT_AVAILABLE',
              lastDeploy: new Date().toISOString(),
              version: 'v0.1.0-demo'
            }
          });
        }
      },
      {
        delay: 7200,
        fn: () => {
          const evt: AutonomyEvent = {
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'DEPLOY_RESULT',
            turn: 2,
            summary: 'Deploy finished. Live at http://localhost:5125/preview (HTTP 200).',
            details: { url: 'http://localhost:5125/preview', httpStatus: 200 }
          };
          this.eventBus.publish(evt);
          this.runStore.appendEvent(runId, evt);
          this.runStore.updateState(runId, 'WAITING', {
            deployStatus: {
              status: 'PASS',
              publicUrl: 'http://localhost:5125/preview',
              httpStatus: 200,
              lastDeploy: new Date().toISOString(),
              version: 'v0.1.0-demo'
            }
          });
        }
      },
      {
        delay: 7800,
        fn: () => {
          const evt: AutonomyEvent = {
            id: `evt-${randomUUID()}`,
            runId,
            timestamp: new Date().toISOString(),
            type: 'RUN_COMPLETED',
            summary: '[DEMO MODE] Autonomous loop completed all goals with 1 correction.'
          };
          this.eventBus.publish(evt);
          this.runStore.appendEvent(runId, evt);
          this.runStore.updateState(runId, 'COMPLETED');
        }
      }
    ];

    for (const step of steps) {
      const timeout = setTimeout(step.fn, step.delay);
      this.activeTimeouts.push(timeout);
    }

    return runId;
  }
}
