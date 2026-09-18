import fs from 'node:fs';
import path from 'node:path';
import { ClosedLoopEngine } from '../dist/bridge/index.js';

async function main() {
  const workspace = path.resolve(process.cwd(), 'apps', 'todo-app');
  const engine = new ClosedLoopEngine(undefined, undefined, {
    executorProvider: 'gpt',
    cwd: workspace,
    defaultTimeoutMs: 300000,
    executorTimeoutMs: 300000
  });

  const health = await engine.getExecutor().health(5000);
  if (health.status !== 'ok') {
    throw new Error(`GPT executor is not healthy: ${JSON.stringify(health)}`);
  }

  const marker = path.join(workspace, 'GPT_EXECUTOR_PROOF.txt');
  try { fs.unlinkSync(marker); } catch {}

  const report = await engine.runLoop(
    `Você é o executor operacional autônomo. Trabalhe EXCLUSIVAMENTE no workspace "${workspace}".
Crie o arquivo GPT_EXECUTOR_PROOF.txt contendo exatamente "GPT EXECUTOR PASS".
Depois leia o arquivo para confirmar o conteúdo e informe o resultado. Não peça confirmação humana.`,
    {
      loopId: `gpt-executor-proof-${Date.now()}`,
      maxTurns: 2
    }
  );

  const exists = fs.existsSync(marker);
  const content = exists ? fs.readFileSync(marker, 'utf8').trim() : '';
  const pass = report.status === 'COMPLETED' && exists && content === 'GPT EXECUTOR PASS';

  console.log(JSON.stringify({
    proof: 'GPT_ORCHESTRATOR_TO_GPT_EXECUTOR',
    pass,
    report,
    markerExists: exists,
    markerContent: content,
    manualCopyPasteOperations: report.manual_copy_paste_operations
  }, null, 2));

  if (!pass) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
