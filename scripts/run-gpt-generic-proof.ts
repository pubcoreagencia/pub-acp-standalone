import fs from 'node:fs';
import path from 'node:path';
import { ClosedLoopEngine } from '../dist/bridge/index.js';
import { WorkspaceResolver } from '../dist/multiproject/WorkspaceResolver.js';
import { SafetyGate } from '../dist/multiproject/SafetyGate.js';

async function main() {
  // 1. Resolve workspace generically via WorkspaceResolver & SafetyGate
  const targetWorkspace = path.resolve(process.cwd(), 'apps', 'todo-app');
  console.log(`[PROOF] Resolving workspace: ${targetWorkspace}`);

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
  console.log(`[PROOF] ExecutionContext established:`);
  console.log(`  Project ID: ${context.projectId}`);
  console.log(`  Project Name: ${context.projectName}`);
  console.log(`  Workspace Path: ${context.workspacePath}`);
  console.log(`  Branch: ${context.branch}`);
  console.log(`  Repository: ${context.repository}`);

  // 2. Instantiate ClosedLoopEngine with GPT executor and ExecutionContext
  const engine = new ClosedLoopEngine(undefined, undefined, {
    executorProvider: 'gpt',
    cwd: context.workspacePath,
    executionContext: context,
    defaultTimeoutMs: 300000,
    executorTimeoutMs: 300000
  });

  const health = await engine.getExecutor().health(5000);
  if (health.status !== 'ok') {
    throw new Error(`GPT executor health check failed: ${JSON.stringify(health)}`);
  }
  console.log(`[PROOF] GPT executor health check: OK`);

  const proofFile = path.join(context.workspacePath, 'GPT_GENERIC_EXECUTION_PROOF.txt');
  try { fs.unlinkSync(proofFile); } catch {}

  // 3. Run multi-turn autonomous loop
  const loopId = `gpt-gen-proof-${Date.now()}`;
  console.log(`[PROOF] Starting ClosedLoopEngine with loopId: ${loopId}`);

  const report = await engine.runLoop(
    `Você é o executor operacional técnico no workspace "${context.workspacePath}".
Execute as seguintes etapas usando o protocolo ACP de ações:
1. Crie o arquivo GPT_GENERIC_EXECUTION_PROOF.txt com o conteúdo exatamente:
GPT GENERIC EXECUTION PASS
2. Em seguida, leia o arquivo GPT_GENERIC_EXECUTION_PROOF.txt com [FILE_READ: GPT_GENERIC_EXECUTION_PROOF.txt] para verificar.
3. Se tudo estiver correto e verificado, confirme a conclusão com [[STATUS: READY]].`,
    {
      loopId,
      maxTurns: 2,
      executionContext: context
    }
  );

  const exists = fs.existsSync(proofFile);
  const content = exists ? fs.readFileSync(proofFile, 'utf8').trim() : '';
  const pass = report.status === 'COMPLETED' && exists && content === 'GPT GENERIC EXECUTION PASS';

  console.log('\n--- PROOF RESULT ---');
  console.log(JSON.stringify({
    proof: 'GPT_GENERIC_EXECUTION_V1_1',
    pass,
    workspacePath: context.workspacePath,
    projectId: context.projectId,
    status: report.status,
    totalTurns: report.total_turns,
    manualCopyPasteOperations: report.manual_copy_paste_operations,
    proofFileExists: exists,
    proofFileContent: content
  }, null, 2));

  if (!pass) {
    console.error('[PROOF FAILED]');
    process.exit(1);
  }

  console.log('\n[PROOF PASSED]');
}

main().catch(err => {
  console.error('[PROOF ERROR]', err);
  process.exit(1);
});
