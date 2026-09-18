import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { GptTransport } from '../src/gpt/index.js';
import { AntigravityTransport } from '../src/antigravity/index.js';
import { ClosedLoopEngine } from '../src/bridge/ClosedLoopEngine.js';
import { ControlRoomServer } from '../src/server/ControlRoomServer.js';
import { ProjectRegistry } from '../src/multiproject/ProjectRegistry.js';
import { WorkspaceResolver } from '../src/multiproject/WorkspaceResolver.js';
import { SafetyGate } from '../src/multiproject/SafetyGate.js';
import { ProjectDispatcher } from '../src/multiproject/ProjectDispatcher.js';
import { ExecutionContext } from '../src/multiproject/types.js';
import { FileProjectContextStore } from '../src/context/FileProjectContextStore.js';

async function runProof2() {
  console.log('===============================================================');
  console.log('STARTING REAL PROOF 2: GENERIC EXECUTION (SECOND WORKSPACE)');
  console.log('===============================================================\n');

  // 1. Setup Second Workspace in controlled sandbox directory
  const sandboxDir = path.resolve(process.cwd(), 'sandbox-workspace-b');
  if (fs.existsSync(sandboxDir)) {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  }
  fs.mkdirSync(sandboxDir, { recursive: true });

  // Initialize real Git repository with distinct identity
  const originRepo = 'https://github.com/pubcoreagencia/pub-acp-sandbox-b.git';
  const branchName = 'main';

  execFileSync('git', ['init', '-b', branchName], { cwd: sandboxDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ACP Sandbox B'], { cwd: sandboxDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'sandbox-b@acp.local'], { cwd: sandboxDir, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', originRepo], { cwd: sandboxDir, stdio: 'ignore' });

  // Create initial project files for second workspace
  const initialReadme = '# Sandbox Project B\n\nIndependent generic project for ACP Proof 2.\n';
  const initialPackage = JSON.stringify({ name: 'sandbox-b', version: '1.0.0', private: true }, null, 2);
  const initialConfig = 'export const APP_CONFIG = { name: "Sandbox B", version: "1.0.0", env: "test" };\n';

  fs.writeFileSync(path.join(sandboxDir, 'README.md'), initialReadme, 'utf8');
  fs.writeFileSync(path.join(sandboxDir, 'package.json'), initialPackage, 'utf8');
  fs.writeFileSync(path.join(sandboxDir, 'config.ts'), initialConfig, 'utf8');

  execFileSync('git', ['add', '.'], { cwd: sandboxDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial commit for sandbox-b'], { cwd: sandboxDir, stdio: 'ignore' });

  const initialCommit = execFileSync('git', ['log', '-1', '--oneline'], { cwd: sandboxDir, encoding: 'utf8' }).trim();
  console.log(`[SANDBOX B SETUP] Created isolated Git repo at: ${sandboxDir}`);
  console.log(`[SANDBOX B SETUP] Origin: ${originRepo}, Branch: ${branchName}, Commit: ${initialCommit}\n`);

  // Record baseline state of apps/todo-app
  const todoAppIndex = path.resolve(process.cwd(), 'apps', 'todo-app', 'index.html');
  const todoAppBaseline = fs.readFileSync(todoAppIndex, 'utf8');

  // 2. Control Room Server (Port 5175 to avoid port collision)
  const server = new ControlRoomServer({ port: 5175, host: '127.0.0.1' });
  const serverInfo = await server.start();
  console.log(`[CONTROL ROOM] Server started at ${serverInfo.url}`);

  const eventBus = server.getEventBus();
  const runStore = server.getRunStore();

  // 3. Transports Pre-flight Health Check
  const gptTransport = new GptTransport({ baseUrl: 'http://127.0.0.1:5126', defaultTimeoutMs: 300000 });
  const agTransport = new AntigravityTransport({ defaultCwd: sandboxDir, defaultTimeoutMs: 300000 });

  console.log('\n[PRE-FLIGHT] Checking ACP-LAB health...');
  const gptHealth = await gptTransport.health(5000);
  if (gptHealth.status !== 'ok') {
    await server.stop();
    throw new Error(`FAIL-CLOSED: ACP-LAB not healthy: ${JSON.stringify(gptHealth)}`);
  }
  console.log('[PRE-FLIGHT] ACP-LAB is LIVE and HEALTHY.');

  console.log('\n[PRE-FLIGHT] Checking Antigravity CLI health...');
  const agHealth = await agTransport.health();
  if (agHealth.status !== 'ok') {
    await server.stop();
    throw new Error(`FAIL-CLOSED: Antigravity CLI not healthy: ${JSON.stringify(agHealth)}`);
  }
  console.log(`[PRE-FLIGHT] Antigravity CLI is LIVE and HEALTHY at: ${agHealth.agyPath}`);

  // 4. Configure Multi-Project Components
  const registry = new ProjectRegistry([
    {
      projectId: 'sandbox-b',
      projectName: 'Sandbox Project B',
      workspacePath: sandboxDir,
      repository: originRepo,
      defaultBranch: branchName,
      enabled: true
    }
  ]);

  const resolver = new WorkspaceResolver(registry);
  const safetyGate = new SafetyGate();

  // Engine Factory with executionContext propagation
  const engineFactory = (context: ExecutionContext) => {
    return new ClosedLoopEngine(gptTransport, agTransport, {
      cwd: context.workspacePath,
      eventBus: eventBus,
      executionContext: context
    });
  };

  const contextStore = new FileProjectContextStore();
  const dispatcher = new ProjectDispatcher(
    registry,
    contextStore,
    resolver,
    safetyGate,
    engineFactory,
    eventBus
  );

  // 5. Initial Human Prompt (Targeted exclusively at sandbox-b)
  const humanPrompt = `Você é o líder técnico autônomo do projeto Sandbox B.
O diretório exclusivo de trabalho é "${sandboxDir}".
Sua missão técnica:
Localize o arquivo "${path.join(sandboxDir, 'config.ts')}" e atualize a propriedade "version" de "1.0.0" para "1.1.0-ACP-PROOF2".
Não altere absolutamente nenhum outro arquivo nem diretório fora de "${sandboxDir}".
Após realizar a alteração e validar o arquivo config.ts, finalize sua mensagem obrigatoriamente com o token: [[STATUS: READY]].`;

  console.log('\n[DISPATCH] Dispatching request for "sandbox-b" through ProjectDispatcher...');
  const runId = `proof2-${Date.now()}`;
  const taskId = `task-proof2-b`;

  const dispatchResult = await dispatcher.dispatch({
    projectId: 'sandbox-b',
    runId,
    taskId,
    initialPrompt: humanPrompt,
    maxTurns: 1,
    trigger: 'proof2-generic-execution',
    actor: 'antigravity-verifier'
  });

  console.log('\n[DISPATCH RESULT]', {
    ok: dispatchResult.ok,
    runId: dispatchResult.runId,
    safetyBlocked: dispatchResult.safetyBlocked,
    status: dispatchResult.report?.status,
    totalDurationMs: dispatchResult.report?.total_duration_ms,
    turnsCount: dispatchResult.report?.turns?.length
  });

  // 6. Validation
  eventBus.publish({
    id: `evt-${randomUUID()}`,
    runId,
    timestamp: new Date().toISOString(),
    type: 'VALIDATION_STARTED',
    summary: 'Validating sandbox-b modifications and workspace isolation.',
    details: { runId, workspacePath: sandboxDir }
  });

  const modifiedConfig = fs.readFileSync(path.join(sandboxDir, 'config.ts'), 'utf8');
  const configUpdated = modifiedConfig.includes('1.1.0-ACP-PROOF2');

  // Verify that apps/todo-app was NOT touched
  const todoAppCurrent = fs.readFileSync(todoAppIndex, 'utf8');
  const todoAppUntouched = todoAppCurrent === todoAppBaseline;

  const validationPassed = configUpdated && todoAppUntouched;

  eventBus.publish({
    id: `evt-${randomUUID()}`,
    runId,
    timestamp: new Date().toISOString(),
    type: 'VALIDATION_RESULT',
    summary: validationPassed ? 'Validation PASSED: sandbox-b modified, todo-app 100% untouched.' : 'Validation FAILED',
    details: {
      runId,
      status: validationPassed ? 'PASS' : 'FAIL',
      configUpdated,
      todoAppUntouched
    }
  });

  // 7. Verify RunStore
  const run = runStore.getRun(runId);
  console.log('\n[RUN STORE VERIFICATION]');
  console.log(`Run found: ${!!run}, status: ${run?.status}`);
  if (run) {
    console.log(`Total events in run: ${run.events.length}`);
    run.events.forEach((evt, idx) => {
      console.log(`  ${idx + 1}. [${evt.type}] (Turn ${evt.turn ?? '-'}) ${evt.summary}`);
    });
  }

  // 8. Output Sandbox Git Status & Diff
  const sandboxGitStatus = execFileSync('git', ['status', '--short'], { cwd: sandboxDir, encoding: 'utf8' }).trim();
  const sandboxGitDiff = execFileSync('git', ['diff'], { cwd: sandboxDir, encoding: 'utf8' }).trim();
  console.log('\n[SANDBOX B GIT STATUS]:\n' + sandboxGitStatus);
  console.log('\n[SANDBOX B GIT DIFF]:\n' + sandboxGitDiff);

  await server.stop();
  console.log('\n[CONTROL ROOM] Server stopped.');

  console.log('\n===============================================================');
  console.log('REAL PROOF 2 FINISHED');
  console.log('===============================================================');
}

runProof2().catch(err => {
  console.error('\n[FATAL ERROR IN PROOF 2]:', err);
  process.exit(1);
});
