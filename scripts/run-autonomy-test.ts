import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GptTransport } from '../dist/gpt/index.js';
import { AntigravityTransport, AntigravityBridge } from '../dist/antigravity/index.js';

interface AutonomyCycleLog {
  step: number;
  gpt_decision: string;
  ag_result: string;
  gpt_duration_ms: number;
  ag_duration_ms: number;
}

async function runAutonomyTest() {
  console.log('==================================================');
  console.log('STARTING AUTONOMY TEST 001 - END-TO-END EXECUTION');
  console.log('==================================================\n');

  const appDir = path.resolve(process.cwd(), 'apps', 'todo-app');
  const gptTransport = new GptTransport({ baseUrl: 'http://127.0.0.1:5126', defaultTimeoutMs: 300000 });
  const agTransport = new AntigravityTransport({ defaultCwd: appDir, defaultTimeoutMs: 300000 });
  const agBridge = new AntigravityBridge(agTransport);

  // 1. Health check
  const gptHealth = await gptTransport.health(5000);
  if (gptHealth.status !== 'ok') {
    throw new Error(`GPT Transport not healthy: ${JSON.stringify(gptHealth)}`);
  }
  const agHealth = await agTransport.health();
  if (agHealth.status !== 'ok') {
    throw new Error(`Antigravity Transport not healthy: ${JSON.stringify(agHealth)}`);
  }
  console.log('[PRE-FLIGHT] GPT Transport & Antigravity Transport are both HEALTHY.\n');

  // Human Idea Specification (The ONLY human prompt)
  const initialHumanIdea = `Você é o arquiteto e líder técnico autônomo.
Sua missão é criar uma aplicação web completa de Lista de Tarefas, pronta para uso local.
Requisitos funcionais mínimos:
* adicionar tarefa;
* marcar tarefa como concluída;
* excluir tarefa;
* persistir tarefas localmente;
* funcionar em desktop e mobile;
* interface visual limpa e profissional.

O diretório exclusivo de trabalho da aplicação é:
"${appDir}"

O executor das ações no computador é o Antigravity (IA operacional).
Você decide a cada turno exatamente o que o Antigravity deve fazer (criar arquivos, instalar dependências, rodar testes, subir servidor de teste, validar responsividade e persistência, ou corrigir eventuais erros).

Regras de interação:
1. Em cada resposta, forneça as instruções concretas de execução técnica para o Antigravity executar agora neste turno.
2. Seja objetivo e instrua o Antigravity com os comandos, arquivos e validações necessárias.
3. Quando a aplicação estiver 100% pronta, testada e validada em todos os requisitos, encerre sua mensagem com o token: [[STATUS: READY]].

Inicie agora o Turno 1 decidindo a arquitetura, arquivos iniciais e implementação.`;

  const gptSessionId = `autonomy-gpt-${Date.now()}`;
  const agSessionId = `autonomy-ag-${Date.now()}`;

  let currentTurn = 1;
  const maxTurns = 12;
  let isReady = false;
  let gptSession = gptSessionId;
  let lastAgResponse = '';
  const telemetryLogs: AutonomyCycleLog[] = [];
  let autonomousCorrections = 0;

  while (currentTurn <= maxTurns && !isReady) {
    console.log(`\n--------------------------------------------------`);
    console.log(`>>> STEP ${String(currentTurn).padStart(2, '0')} INITIATED`);
    console.log(`--------------------------------------------------`);

    // 1. Determine prompt for GPT Free
    let gptPrompt: string;
    if (currentTurn === 1) {
      gptPrompt = initialHumanIdea;
    } else {
      // Dynamic feedback from actual AG execution - no templates, no hardcoded stages!
      gptPrompt = `[RELATÓRIO DE EXECUÇÃO DO ANTIGRAVITY - TURNO ${currentTurn - 1}]:\n` +
        `"""\n${lastAgResponse}\n"""\n\n` +
        `Analise o resultado real acima. Decida autonomamente o próximo passo operacional (implementar o que falta, criar ou rodar testes automatizados de unidade/persistência/interface, validar requisitos de desktop/mobile ou fazer correções se algo falhou).\n` +
        `Se a aplicação já estiver completamente implementada, testada e com todas as evidências comprovadas, inclua [[STATUS: READY]]. Caso contrário, forneça a instrução técnica de execução para o Antigravity.`;
    }

    console.log(`[GPT] Enviando contexto para GPT Free (Sessão: ${gptSession})...`);
    const gptStart = Date.now();
    const gptRes = await gptTransport.continueSession(gptSession, gptPrompt, {
      timeout_ms: 300000
    });
    const gptDuration = Date.now() - gptStart;

    if (gptRes.status !== 'COMPLETED') {
      console.error(`[GPT ERROR] Turno ${currentTurn} falhou no GPT:`, gptRes.error);
      throw new Error(`GPT execution error: ${gptRes.error?.message}`);
    }

    if (gptRes.session_id) {
      gptSession = gptRes.session_id;
    }

    const gptDecision = gptRes.text.trim();
    console.log(`[GPT_DECISION Turno ${currentTurn} (${gptDuration}ms)]:\n${gptDecision.slice(0, 300)}...\n`);

    if (gptDecision.toLowerCase().includes('corrig') || gptDecision.toLowerCase().includes('fix') || gptDecision.toLowerCase().includes('erro') || gptDecision.toLowerCase().includes('ajust')) {
      if (currentTurn > 1) {
        autonomousCorrections++;
      }
    }

    // Check if GPT declared completion
    if (gptDecision.includes('[[STATUS: READY]]')) {
      console.log(`[AUTONOMY] GPT Free sinalizou conclusão [[STATUS: READY]]!`);
      // If GPT included ready but also gave instructions, execute them
      if (gptDecision.replace('[[STATUS: READY]]', '').trim().length > 20) {
        console.log(`[AG] Executando validação/etapa final indicada pelo GPT...`);
        const agStart = Date.now();
        const agRes = await agBridge.executeTurn(agSessionId, gptDecision, {
          cwd: appDir,
          effort: 'low',
          timeout_ms: 300000
        });
        const agDuration = Date.now() - agStart;
        lastAgResponse = agRes.response;
        telemetryLogs.push({
          step: currentTurn,
          gpt_decision: gptDecision,
          ag_result: agRes.response,
          gpt_duration_ms: gptDuration,
          ag_duration_ms: agDuration
        });
      } else {
        telemetryLogs.push({
          step: currentTurn,
          gpt_decision: gptDecision,
          ag_result: 'Final declaration received. No further command required.',
          gpt_duration_ms: gptDuration,
          ag_duration_ms: 0
        });
      }
      isReady = true;
      break;
    }

    // 2. Antigravity executes GPT's decision
    console.log(`[AG] Executando decisão do GPT via Antigravity CLI...`);
    const agStart = Date.now();
    const agRes = await agBridge.executeTurn(agSessionId, gptDecision, {
      cwd: appDir,
      effort: 'low',
      timeout_ms: 300000
    });
    const agDuration = Date.now() - agStart;

    if (agRes.status !== 'COMPLETED') {
      console.error(`[AG ERROR] Turno ${currentTurn} falhou no Antigravity:`, agRes.error);
    }

    lastAgResponse = agRes.response;
    console.log(`[AG_RESULT Turno ${currentTurn} (${agDuration}ms)]:\n${lastAgResponse.slice(0, 300)}...\n`);

    telemetryLogs.push({
      step: currentTurn,
      gpt_decision: gptDecision,
      ag_result: lastAgResponse,
      gpt_duration_ms: gptDuration,
      ag_duration_ms: agDuration
    });

    currentTurn++;
  }

  // Save telemetry
  const telemetryData = {
    test: 'AUTONOMY_TEST_001',
    timestamp: new Date().toISOString(),
    isReady,
    totalTurns: telemetryLogs.length,
    autonomousCorrections,
    manualCopyPaste: 0,
    humanInterventions: 0,
    steps: telemetryLogs
  };

  fs.writeFileSync(
    path.resolve(process.cwd(), 'AUTONOMY_TEST_001_TELEMETRY.json'),
    JSON.stringify(telemetryData, null, 2),
    'utf-8'
  );

  console.log('\n==================================================');
  console.log(`AUTONOMY TEST 001 RUN COMPLETE - ${isReady ? 'PASS' : 'FINISHED TURNS'}`);
  console.log(`Total turns: ${telemetryLogs.length}`);
  console.log(`Autonomous corrections: ${autonomousCorrections}`);
  console.log('==================================================\n');
}

runAutonomyTest().catch((err) => {
  console.error('[FATAL RUNNER ERROR]:', err);
  process.exit(1);
});
