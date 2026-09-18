import fs from 'node:fs';
import path from 'node:path';
import { ClosedLoopEngine } from '../dist/bridge/index.js';
import { WorkspaceResolver } from '../dist/multiproject/WorkspaceResolver.js';
import { SafetyGate } from '../dist/multiproject/SafetyGate.js';

async function main() {
  console.log('====================================================');
  console.log('PUB ACP STANDALONE - GPT EXECUTION RUNTIME V2 PROOF');
  console.log('====================================================\n');

  // 1. Resolve arbitrary workspace
  const targetWorkspace = path.resolve(process.cwd(), 'apps', 'gpt-executor-runtime-proof');
  console.log(`[1/5] Resolving arbitrary workspace: ${targetWorkspace}`);

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
  console.log(`  ✓ Workspace resolved successfully:`);
  console.log(`    - Project ID: ${context.projectId}`);
  console.log(`    - Project Name: ${context.projectName}`);
  console.log(`    - Workspace Path: ${context.workspacePath}`);
  console.log(`    - Branch: ${context.branch}`);
  console.log(`    - Repository: ${context.repository}`);

  // Clean previous artifacts if any
  const tokenFile = path.join(context.workspacePath, 'generated-token.txt');
  const finalProofFile = path.join(context.workspacePath, 'RUNTIME_V2_PROOF.txt');
  try { fs.unlinkSync(tokenFile); } catch {}
  try { fs.unlinkSync(finalProofFile); } catch {}

  // 2. Initialize ClosedLoopEngine with strict ActionPolicy
  console.log('\n[2/5] Initializing ClosedLoopEngine with fail-closed ActionPolicy...');
  const actionPolicy = {
    allowFileCreate: true,
    allowFileWrite: true,
    allowFileRead: true,
    allowFileDelete: true,
    allowExec: true,
    allowedExecCommands: ['node', 'git status', 'echo', 'cat', 'ls'],
    execTimeoutMs: 15000
  };

  const engine = new ClosedLoopEngine(undefined, undefined, {
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
  console.log(`  ✓ GPT Executor Health: OK (${JSON.stringify(health)})`);

  // 3. Execute multi-turn autonomous cycle requiring EXEC in Turn 1, then FILE_WRITE in Turn 2
  console.log('\n[3/5] Starting Multi-Turn Autonomous Execution with Real GPT...');
  const loopId = `runtime-v2-proof-${Date.now()}`;

  const prompt = `Você é o executor operacional técnico no workspace "${context.workspacePath}".
Executaremos um ciclo multi-turnos obrigatório:

ETAPA 1 (Turno Atual):
Execute um comando Node.js via [EXEC: <comando>][/EXEC] para gerar o token de segurança no arquivo "generated-token.txt".
Use exatamente o comando:
[EXEC: node -e "require('fs').writeFileSync('generated-token.txt', 'RUNTIME_TOKEN_998877'); console.log('TOKEN_GENERATED: RUNTIME_TOKEN_998877')"][/EXEC]

Após executar este comando, aguarde a saída de execução do sistema antes de concluir.`;

  const report = await engine.runLoop(prompt, {
    loopId,
    maxTurns: 3,
    executionContext: context,
    turnPromptBuilder: (prevExecutorResponse: string, turn: number) => {
      return `O executor retornou o seguinte resultado do Turno ${turn - 1}:
"""
${prevExecutorResponse}
"""

ETAPA 2 (Turno ${turn}):
1. Leia o arquivo "generated-token.txt" usando [FILE_READ: generated-token.txt][/FILE_READ] para confirmar o token gravado.
2. Em seguida, crie o arquivo "RUNTIME_V2_PROOF.txt" usando:
[FILE_CREATE: RUNTIME_V2_PROOF.txt]
GPT EXECUTION RUNTIME V2 PASS
Token: RUNTIME_TOKEN_998877
[/FILE_CREATE]
3. Quando os dois passos forem concluídos, finalize sua resposta com [[STATUS: READY]].`;
    }
  });

  // 4. Physical artifact verification
  console.log('\n[4/5] Verifying physical artifacts on filesystem...');
  const tokenExists = fs.existsSync(tokenFile);
  const tokenContent = tokenExists ? fs.readFileSync(tokenFile, 'utf8').trim() : '';

  const proofExists = fs.existsSync(finalProofFile);
  const proofContent = proofExists ? fs.readFileSync(finalProofFile, 'utf8').trim() : '';

  console.log(`  - generated-token.txt exists: ${tokenExists}`);
  console.log(`  - generated-token.txt content: "${tokenContent}"`);
  console.log(`  - RUNTIME_V2_PROOF.txt exists: ${proofExists}`);
  console.log(`  - RUNTIME_V2_PROOF.txt content:\n---\n${proofContent}\n---`);

  const execEvidence = report.turns.some(t =>
    t.antigravity_instruction.includes('[EXEC') ||
    t.antigravity_response.includes('[EXEC_RESULT') ||
    t.antigravity_response.includes('TOKEN_GENERATED')
  );

  const turnsCount = report.total_turns;
  const isMultiTurn = turnsCount >= 2;
  const pass = report.status === 'COMPLETED' &&
    tokenExists && tokenContent === 'RUNTIME_TOKEN_998877' &&
    proofExists && proofContent.includes('GPT EXECUTION RUNTIME V2 PASS') &&
    execEvidence &&
    isMultiTurn;

  // 5. Final Report
  console.log('\n[5/5] PROOF EVALUATION:');
  const resultSummary = {
    proof: 'GPT_EXECUTION_RUNTIME_V2',
    pass,
    workspacePath: context.workspacePath,
    arbitraryWorkspace: context.workspacePath.endsWith('apps/gpt-executor-runtime-proof'),
    totalTurns: turnsCount,
    isMultiTurn,
    execExecutedAndCaptured: execEvidence,
    tokenMatches: tokenContent === 'RUNTIME_TOKEN_998877',
    proofArtifactValid: proofContent.includes('GPT EXECUTION RUNTIME V2 PASS'),
    manualCopyPasteOperations: report.manual_copy_paste_operations,
    status: report.status
  };

  console.log(JSON.stringify(resultSummary, null, 2));

  if (!pass) {
    console.error('\n❌ PROOF FAILED!');
    process.exit(1);
  }

  console.log('\n✅ GPT EXECUTION RUNTIME V2 = PASS');
}

main().catch(err => {
  console.error('\n❌ PROOF EXCEPTION:', err);
  process.exit(1);
});
