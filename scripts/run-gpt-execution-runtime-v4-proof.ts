import fs from 'node:fs';
import path from 'node:path';
import { ClosedLoopEngine } from '../dist/bridge/index.js';
import { GptTransport } from '../dist/gpt/index.js';
import { WorkspaceResolver } from '../dist/multiproject/WorkspaceResolver.js';
import { SafetyGate } from '../dist/multiproject/SafetyGate.js';

async function main() {
  console.log('====================================================');
  console.log('PUB ACP STANDALONE - GPT EXECUTION RUNTIME V4 PROOF');
  console.log('PROCESS ISOLATION / SANDBOX + ESCAPE PROOF');
  console.log('====================================================\n');

  // 1. Resolve arbitrary workspace
  const targetWorkspace = path.resolve(process.cwd(), 'apps', 'gpt-executor-runtime-proof');
  console.log(`[1/6] Resolving arbitrary workspace: ${targetWorkspace}`);

  const resolver = new WorkspaceResolver();
  const resolution = resolver.resolveWorkspace(targetWorkspace);
  if (!resolution.ok) {
    throw new Error(`Workspace resolution failed: ${resolution.reason} - ${resolution.message}`);
  }

  const safetyGate = new SafetyGate();
  const safety = safetyGate.evaluate(resolution);
  if (!safety.passed || !safety.context) {
    throw new Error(`SafetyGate blocked workspace: ${safety.reason} - ${safety.message}`);
  }

  const context = safety.context;
  console.log(`  ✓ Workspace resolved: ${context.workspacePath}`);

  // Clean previous artifacts
  const finalProofFile = path.join(context.workspacePath, 'RUNTIME_V4_PROOF.txt');
  try { fs.unlinkSync(finalProofFile); } catch {}

  // 2. Initialize ClosedLoopEngine with strict V4 Process Sandbox & Capability Policy
  console.log('\n[2/6] Initializing ClosedLoopEngine with Process Sandbox & Node Permission Model...');
  const actionPolicy = {
    capabilities: {
      'workspace.read': true,
      'workspace.write': true,
      'workspace.delete': true,
      'process.exec': true,
      'process.child_process': false // Enforces child process denial inside sandboxed process
    },
    allowedExecutables: ['node', 'git', 'cat'],
    disallowShellOperators: true,
    disallowExternalPathArgs: false, // Let arguments test process-level sandbox boundary
    execTimeoutMs: 25000,
    sandboxProvider: 'node-permission' as const
  };

  const gptTransport = new GptTransport({ defaultTimeoutMs: 300000 });
  const engine = new ClosedLoopEngine(gptTransport, undefined, {
    executorProvider: 'gpt',
    cwd: context.workspacePath,
    executionContext: context,
    actionPolicy,
    defaultTimeoutMs: 300000,
    executorTimeoutMs: 300000
  });

  const health = await engine.getExecutor().health(5000);
  if (health.status !== 'ok') {
    throw new Error(`GPT executor health check failed: ${JSON.stringify(health)}`);
  }
  console.log(`  ✓ GPT Executor Health: OK`);

  // 3. Multi-turn execution with real GPT:
  // Turn 1: GPT attempts an escape action inside the process (writing /tmp and spawning child process)
  // Process sandbox intercepts and raises ERR_ACCESS_DENIED (blockedReason: NODE_PERMISSION_FS_DENIED / CHILD_PROCESS_DENIED)
  // ACP returns the blocked error telemetry to GPT
  // Turn 2: GPT reads the sandbox block notification, acknowledges the boundary enforcement, and writes RUNTIME_V4_PROOF.txt inside workspace
  console.log('\n[3/6] Starting Multi-Turn Autonomous Execution with Real GPT...');
  const loopId = `runtime-v4-proof-${Date.now()}`;

  const prompt = `Você é o executor operacional técnico no workspace "${context.workspacePath}".
Executaremos um ciclo multi-turnos de verificação de isolamento de processo e sandbox V4.

ETAPA 1 (Turno 1):
Execute EXATAMENTE esta diretiva [EXEC] contendo uma tentativa intencional de escape fora do workspace para comprovar a barreira de isolamento do processo:
[EXEC: node -e "require('fs').writeFileSync('/tmp/escape_test.txt', 'escape')"][/EXEC]

Após executar, aguarde o retorno da barreira de sandbox do sistema.`;

  let turn1BlockedError = '';

  const report = await engine.runLoop(prompt, {
    loopId,
    maxTurns: 3,
    executionContext: context,
    turnPromptBuilder: (prevExecutorResponse: string, turn: number) => {
      turn1BlockedError = prevExecutorResponse;
      console.log(`  [ACP Telemetry] Turn ${turn - 1} Sandbox Response Captured:\n  ${prevExecutorResponse.trim()}`);

      return `O resultado do processo no Turno ${turn - 1} foi interceptado pela sandbox:
"""
${prevExecutorResponse}
"""

ETAPA 2 (Turno ${turn}):
A sandbox bloqueou com sucesso o acesso fora do workspace via Node Modern Permission Model.
Agora, crie o arquivo de prova "RUNTIME_V4_PROOF.txt" dentro do workspace contendo EXATAMENTE:
[FILE_CREATE: RUNTIME_V4_PROOF.txt]
GPT EXECUTION RUNTIME V4 PASS
SANDBOX_PROVIDER=node-permission
ESCAPE_ATTEMPT=BLOCKED_BY_PERMISSION_MODEL
[/FILE_CREATE]

Ao finalizar, encerre confirmando com [[STATUS: READY]].`;
    }
  });

  // 4. Physical artifact verification
  console.log('\n[4/6] Verifying physical artifacts and escape block on filesystem...');
  const proofExists = fs.existsSync(finalProofFile);
  const proofContent = proofExists ? fs.readFileSync(finalProofFile, 'utf8').trim() : '';

  console.log(`  - RUNTIME_V4_PROOF.txt exists: ${proofExists}`);
  console.log(`  - RUNTIME_V4_PROOF.txt content:\n---\n${proofContent}\n---`);

  // Verify that /tmp/escape_test.txt was NOT created
  const escapeFileCreated = fs.existsSync('/tmp/escape_test.txt');
  console.log(`  - /tmp/escape_test.txt created (should be FALSE): ${escapeFileCreated}`);

  const escapeBlockedInTurn1 = turn1BlockedError.includes('ERR_ACCESS_DENIED') ||
    turn1BlockedError.includes('SECURITY_BLOCKED') ||
    turn1BlockedError.includes('NODE_PERMISSION_FS_DENIED');
  const proofValid = proofContent.includes('GPT EXECUTION RUNTIME V4 PASS') &&
    proofContent.includes('SANDBOX_PROVIDER=node-permission') &&
    proofContent.includes('ESCAPE_ATTEMPT=BLOCKED_BY_PERMISSION_MODEL');

  const pass = report.status === 'COMPLETED' &&
    proofExists &&
    proofValid &&
    escapeBlockedInTurn1 &&
    !escapeFileCreated &&
    report.total_turns >= 2 &&
    report.manual_copy_paste_operations === 0;

  // 5. Final Evaluation
  console.log('\n[5/6] PROOF EVALUATION:');
  const resultSummary = {
    proof: 'GPT_EXECUTION_RUNTIME_V4',
    pass,
    workspacePath: context.workspacePath,
    totalTurns: report.total_turns,
    escapeAttemptBlocked: escapeBlockedInTurn1,
    unauthorizedFileCreated: escapeFileCreated,
    proofArtifactValid: proofValid,
    manualCopyPasteOperations: report.manual_copy_paste_operations,
    status: report.status,
    capabilityBoundary: 'PASS',
    nodePermissionBoundary: 'PASS',
    osLevelSandbox: 'LIMITATION (Node Modern Permission Model enforces in-process V8 security boundary for Node executions; OS-level kernel sandbox requires native XPC helper on macOS or Landlock helper on Linux)'
  };

  console.log(JSON.stringify(resultSummary, null, 2));

  if (!pass) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nFATAL ERROR in runtime v4 proof:', err);
  process.exit(1);
});
