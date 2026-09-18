import { IEventBus } from './EventBus.js';
import { IRunStore } from './RunStore.js';
import { AutonomyEvent, RunModel } from './types.js';

export function wireEventBusToRunStore(eventBus: IEventBus, runStore: IRunStore): () => void {
  return eventBus.subscribe('*', (event: AutonomyEvent) => {
    let run = runStore.getRun(event.runId);
    if (!run) {
      run = {
        runId: event.runId,
        projectId: (event.details?.projectId as string) || undefined,
        projectName: (event.details?.projectName as string) || undefined,
        taskId: (event.details?.taskId as string) || undefined,
        project: (event.details?.projectName as string) || (event.details?.project as string) || 'ACP Standalone',
        status: 'STARTING',
        isDemo: event.summary?.includes('[DEMO MODE]') || false,
        startedAt: event.timestamp,
        durationMs: 0,
        gptTurns: 0,
        agExecutions: 0,
        toolExecutions: 0,
        browserNavigations: 0,
        browserReads: 0,
        browserScreenshots: 0,
        corrections: 0,
        tests: {
          build: 'NOT_AVAILABLE',
          unit: 'NOT_AVAILABLE',
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
          path: (event.details?.workspacePath as string) || (event.details?.cwd as string) || process.cwd(),
          expectedRepo: (event.details?.expectedRepo as string) || (event.details?.repository as string) || 'NOT_AVAILABLE',
          actualRepo: (event.details?.actualRepo as string) || (event.details?.repository as string) || 'NOT_AVAILABLE',
          branch: (event.details?.branch as string) || 'NOT_AVAILABLE',
          changedFiles: [],
          fileCount: 'NOT_AVAILABLE',
          gitStatus: 'NOT_AVAILABLE',
          lastCommit: (event.details?.commit as string) || 'NOT_AVAILABLE'
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
        events: [],
        executorMode: (event.details?.executorMode as any) || undefined,
        provider: (event.details?.provider as string) || undefined
      };
      runStore.saveRun(run);
    }

    runStore.appendEvent(event.runId, event);

    switch (event.type) {
      case 'RUN_CREATED':
      case 'RUN_STARTED':
        runStore.updateState(event.runId, 'STARTING', {
          projectId: (event.details?.projectId as string) || run.projectId,
          projectName: (event.details?.projectName as string) || run.projectName,
          taskId: (event.details?.taskId as string) || run.taskId,
          project: (event.details?.projectName as string) || (event.details?.project as string) || run.project,
          executorMode: (event.details?.executorMode as any) || run.executorMode,
          provider: (event.details?.provider as string) || run.provider,
          workspace: {
            ...run.workspace,
            path: (event.details?.workspacePath as string) || run.workspace.path,
            expectedRepo: (event.details?.expectedRepo as string) || (event.details?.repository as string) || run.workspace.expectedRepo,
            actualRepo: (event.details?.actualRepo as string) || (event.details?.repository as string) || run.workspace.actualRepo,
            branch: (event.details?.branch as string) || run.workspace.branch,
            lastCommit: (event.details?.commit as string) || run.workspace.lastCommit
          }
        });
        break;

      case 'EXECUTOR_SELECTED':
        runStore.updateState(event.runId, 'STARTING', {
          executorMode: (event.details?.executorMode as any) || run.executorMode,
          provider: (event.details?.provider as string) || run.provider
        });
        break;

      case 'PROJECT_RESOLVED':
        runStore.updateState(event.runId, 'STARTING', {
          projectId: (event.details?.projectId as string) || run.projectId,
          projectName: (event.details?.projectName as string) || run.projectName,
          project: (event.details?.projectName as string) || run.project
        });
        break;

      case 'WORKSPACE_VALIDATED':
        runStore.updateState(event.runId, 'STARTING', {
          workspace: {
            ...run.workspace,
            path: (event.details?.workspacePath as string) || run.workspace.path,
            expectedRepo: (event.details?.expectedRepo as string) || run.workspace.expectedRepo,
            actualRepo: (event.details?.actualRepo as string) || run.workspace.actualRepo,
            branch: (event.details?.branch as string) || run.workspace.branch,
            lastCommit: (event.details?.commit as string) || run.workspace.lastCommit
          }
        });
        break;

      case 'SAFETY_GATE_BLOCKED':
      case 'WORKSPACE_LOCK_BLOCKED':
        runStore.updateState(event.runId, 'BLOCKED', {
          workspace: {
            ...run.workspace,
            path: (event.details?.workspacePath as string) || run.workspace.path,
            expectedRepo: (event.details?.expectedRepo as string) || run.workspace.expectedRepo,
            actualRepo: (event.details?.actualRepo as string) || run.workspace.actualRepo
          }
        });
        break;

      case 'SAFETY_GATE_PASSED':
        runStore.updateState(event.runId, 'STARTING');
        break;

      case 'GPT_DECISION':
        runStore.updateState(event.runId, 'GPT_THINKING', {
          gptTurns: Math.max(run.gptTurns, event.turn || 1),
          gptView: {
            lastDecision: event.summary,
            contextSummary: (event.details?.promptSnippet as string) || 'Prompt dispatched to GPT',
            analyzedResult: 'Turn prompt generated',
            nextAction: 'Waiting for GPT generation',
            timestamp: event.timestamp
          }
        });
        break;

      case 'AG_STARTED':
        runStore.updateState(event.runId, 'AG_RUNNING', {
          agExecutions: run.agExecutions + 1,
          agView: {
            status: 'RUNNING',
            currentExecution: `Turn ${event.turn || 1}`,
            commandOrAction: 'agy agent',
            durationMs: 'NOT_AVAILABLE',
            stdoutSummary: (event.details?.instructionSnippet as string) || 'Instruction dispatched',
            stderrSummary: '',
            changedFiles: run.agView.changedFiles,
            result: 'IN_PROGRESS'
          }
        });
        break;

      case 'TOOL_STARTED':
        runStore.updateState(event.runId, 'TOOL_RUNNING', {
          toolExecutions: ((run as any).toolExecutions || 0) + 1
        });
        break;

      case 'AG_OUTPUT':
        runStore.updateState(event.runId, 'AG_RUNNING', {
          agView: {
            ...run.agView,
            stdoutSummary: (event.details?.outputSnippet as string) || event.summary,
            durationMs: (event.details?.durationMs as number) || run.agView.durationMs
          }
        });
        break;

      case 'SANDBOX_EXECUTION':
        runStore.updateState(event.runId, 'TOOL_RUNNING');
        break;

      case 'TOOL_FINISHED':
        runStore.updateState(event.runId, 'DIRECT_RUNNING');
        break;

      case 'BROWSER_CONNECTED':
        runStore.updateState(event.runId, 'BROWSER_RUNNING');
        break;

      case 'BROWSER_NAVIGATION_STARTED':
        runStore.updateState(event.runId, 'BROWSER_RUNNING');
        break;

      case 'BROWSER_NAVIGATION_FINISHED':
        runStore.updateState(event.runId, 'DIRECT_RUNNING', {
          browserNavigations: ((run as any).browserNavigations || 0) + 1
        });
        break;

      case 'BROWSER_READ':
        runStore.updateState(event.runId, 'DIRECT_RUNNING', {
          browserReads: ((run as any).browserReads || 0) + 1
        });
        break;

      case 'BROWSER_SCREENSHOT':
        runStore.updateState(event.runId, 'DIRECT_RUNNING', {
          browserScreenshots: ((run as any).browserScreenshots || 0) + 1
        });
        break;

      case 'BROWSER_BLOCKED':
        runStore.updateState(event.runId, 'DIRECT_RUNNING');
        break;

      case 'BROWSER_ERROR':
        runStore.updateState(event.runId, 'DIRECT_RUNNING');
        break;

      case 'AG_FINISHED':
        runStore.updateState(event.runId, 'VALIDATING', {
          agView: {
            ...run.agView,
            status: event.details?.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
            result: (event.details?.status as string) || 'FINISHED'
          }
        });
        break;

      case 'VALIDATION_STARTED':
        runStore.updateState(event.runId, 'VALIDATING');
        break;

      case 'VALIDATION_RESULT': {
        const buildStatus = (event.details?.build as any) || 'PASS';
        const unitStatus = (event.details?.unit as any) || 'PASS';
        runStore.updateState(event.runId, buildStatus === 'FAIL' ? 'GPT_THINKING' : 'VALIDATING', {
          tests: {
            ...run.tests,
            build: buildStatus,
            unit: unitStatus,
            lastRunAt: event.timestamp,
            details: (event.details?.error as string) || event.summary
          }
        });
        break;
      }

      case 'CORRECTION':
        runStore.updateState(event.runId, 'GPT_THINKING', {
          corrections: run.corrections + 1,
          gptView: {
            ...run.gptView,
            lastDecision: event.summary,
            nextAction: 'Executing self-correction instruction',
            timestamp: event.timestamp
          }
        });
        break;

      case 'DEPLOY_STARTED':
        runStore.updateState(event.runId, 'DEPLOYING', {
          deployStatus: {
            ...run.deployStatus,
            status: 'RUNNING',
            lastDeploy: event.timestamp
          }
        });
        break;

      case 'DEPLOY_RESULT':
        runStore.updateState(event.runId, 'WAITING', {
          deployStatus: {
            status: (event.details?.httpStatus === 200 ? 'PASS' : 'FAIL') as any,
            publicUrl: (event.details?.url as string) || 'NOT_AVAILABLE',
            httpStatus: (event.details?.httpStatus as number) || 'NOT_AVAILABLE',
            lastDeploy: event.timestamp,
            version: 'v0.1.0'
          }
        });
        break;

      case 'RUN_COMPLETED':
        runStore.updateState(event.runId, 'COMPLETED');
        break;

      case 'RUN_FAILED':
        runStore.updateState(event.runId, 'FAILED');
        break;
    }
  });
}
