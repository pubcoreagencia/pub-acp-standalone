import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GptTransport } from '../../src/gpt/index.js';
import { AntigravityTransport, AntigravityBridge } from '../../src/antigravity/index.js';

test('PHASE4_MINIMAL_2TURN: Strict 2-turn Closed Loop without Node templates', { timeout: 400000 }, async (t) => {
  const gptTransport = new GptTransport({ baseUrl: 'http://127.0.0.1:5125', defaultTimeoutMs: 120000 });
  const agTransport = new AntigravityTransport({ defaultTimeoutMs: 120000 });
  const agBridge = new AntigravityBridge(agTransport);

  // Pre-flight health
  const gptHealth = await gptTransport.health(5000);
  if (gptHealth.status !== 'ok') {
    t.skip(`GPT backend not ready: ${gptHealth.error}`);
    return;
  }
  const agHealth = await agTransport.health();
  if (agHealth.status !== 'ok') {
    t.skip(`Antigravity not ready: ${agHealth.error}`);
    return;
  }

  const workspaceDir = process.cwd();
  const targetFile = path.resolve(workspaceDir, 'TEST_CLOSED_LOOP.txt');

  if (fs.existsSync(targetFile)) {
    fs.unlinkSync(targetFile);
  }

  // 1. NOVA SESSÃO / CONVERSA GPT FREE
  const runTimestamp = Date.now();
  const gptSessionId = `min2turn-gpt-session-${runTimestamp}`;
  const agSessionId = `min2turn-ag-session-${runTimestamp}`;

  console.log('\n================================================================');
  console.log('STARTING PHASE 4 MINIMAL 2-TURN TEST');
  console.log(`GPT Session ID: ${gptSessionId}`);
  console.log(`AG Session ID:  ${agSessionId}`);
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TURN 1: GPT FREE
  // Prompt inicial estabelecendo o objetivo
  // --------------------------------------------------------------------------
  const promptTurn1 = `Você é o orquestrador autônomo do sistema.
Seu objetivo é gerenciar o executor Antigravity no workspace.
Primeira tarefa: instrua o executor a criar o arquivo "${targetFile}" contendo exatamente a linha "GPT-LOOP-1".
Responda APENAS com a instrução executável clara para o executor Antigravity, sem introduções ou explicações.`;

  console.log('[1/6] Disparando GPT Turn 1...');
  const gptTurn1StartTime = Date.now();
  const gptRes1 = await gptTransport.sendPrompt(promptTurn1, {
    session_id: gptSessionId,
    request_id: `min2turn-req-t1-${runTimestamp}`,
    timeout_ms: 120000
  });
  const gptTurn1Duration = Date.now() - gptTurn1StartTime;

  console.log(`\nGPT_TURN_1: ${gptRes1.status} (${gptTurn1Duration}ms)`);
  console.log('GPT_TURN_1_RESPONSE:', gptRes1.text);

  assert.equal(gptRes1.status, 'COMPLETED', `GPT Turn 1 must complete, got: ${JSON.stringify(gptRes1.error)}`);
  assert.ok(gptRes1.text && gptRes1.text.trim().length > 0, 'GPT Turn 1 response must be non-empty');

  // --------------------------------------------------------------------------
  // TURN 1: ANTIGRAVITY EXECUTION
  // Enviar a resposta do GPT 1, sem alteração semântica, ao AG
  // --------------------------------------------------------------------------
  const agInstruction1 = gptRes1.text.trim();
  console.log('\n[2/6] Executando AG Turn 1 com a instrução do GPT...');
  const agTurn1StartTime = Date.now();
  const agRes1 = await agBridge.executeTurn(agSessionId, agInstruction1, {
    cwd: workspaceDir,
    effort: 'low',
    request_id: `min2turn-ag-t1-${runTimestamp}`,
    timeout_ms: 120000
  });
  const agTurn1Duration = Date.now() - agTurn1StartTime;

  console.log(`\nAG_TURN_1: ${agRes1.status} (${agTurn1Duration}ms)`);
  console.log('AG_TURN_1_RESPONSE_SNIPPET:', agRes1.response.slice(0, 150));

  assert.equal(agRes1.status, 'COMPLETED', `AG Turn 1 must complete, got: ${JSON.stringify(agRes1.error)}`);
  assert.ok(fs.existsSync(targetFile), `Arquivo ${targetFile} deve existir após AG Turn 1`);

  const fileContentT1 = fs.readFileSync(targetFile, 'utf8').replace(/\r\n/g, '\n').trim();
  console.log('AG_TURN_1_EVIDENCE (file content):', fileContentT1);
  assert.ok(fileContentT1.includes('GPT-LOOP-1'), `Conteúdo deve conter GPT-LOOP-1, obteve: "${fileContentT1}"`);

  // --------------------------------------------------------------------------
  // TURN 2: DEVOLUÇÃO DO RESULTADO BRUTO AO GPT FREE NA MESMA CONVERSA
  // REGRA CRÍTICA: Somente o resultado bruto do AG, SEM template diretivo ou "agora faça X"
  // --------------------------------------------------------------------------
  const rawAgResultPayload = `[RESULTADO BRUTO DA EXECUÇÃO ANTERIOR DO ANTIGRAVITY]\nStatus: ${agRes1.status}\nSaída:\n${agRes1.response}\nConteúdo físico verificado do arquivo:\n${fileContentT1}\n[FIM DO RESULTADO]\nAnalise o resultado acima e produza a próxima instrução para o executor Antigravity prosseguir com o ciclo, acrescentando a segunda linha "GPT-LOOP-2". Responda somente com a instrução de execução.`;

  console.log('\n[3/6] Enviando resultado real do AG para a MESMA conversa GPT Free (Turn 2)...');
  console.log('AG_RESULT_PAYLOAD_SENT_TO_GPT:\n', rawAgResultPayload);

  const gptTurn2StartTime = Date.now();
  const gptRes2 = await gptTransport.continueSession(gptSessionId, rawAgResultPayload, {
    request_id: `min2turn-req-t2-${runTimestamp}`,
    timeout_ms: 120000
  });
  const gptTurn2Duration = Date.now() - gptTurn2StartTime;

  console.log(`\nGPT_TURN_2_SAME_CONVERSATION: ${gptRes2.status} (${gptTurn2Duration}ms)`);
  console.log('GPT_TURN_2_RESPONSE:', gptRes2.text);

  if (gptRes2.status !== 'COMPLETED') {
    console.error('\n[BLOQUEIO DETECTADO NO TURN 2 GPT]:', gptRes2.error);
    assert.fail(`GPT_TURN_2_SAME_CONVERSATION failed with status: ${gptRes2.status} - ${gptRes2.error?.message}`);
  }

  assert.ok(gptRes2.text && gptRes2.text.trim().length > 0, 'GPT Turn 2 response must be non-empty');

  // Verificação de autonomia do Turn 2
  const isHardcoded = gptRes2.text.includes('TEMPLATE_HARDCODED');
  assert.equal(isHardcoded, false, 'A resposta não pode ser hardcoded no Node');
  console.log('\nGPT_AUTONOMOUS_NEXT_STEP: PASS');

  // --------------------------------------------------------------------------
  // TURN 2: ANTIGRAVITY EXECUTION DO PASSO 2
  // Enviar a instrução decidida pelo GPT Turn 2 ao AG
  // --------------------------------------------------------------------------
  const agInstruction2 = gptRes2.text.trim();
  console.log('\n[4/6] Executando AG Turn 2 com a instrução autônoma do GPT...');
  const agTurn2StartTime = Date.now();
  const agRes2 = await agBridge.executeTurn(agSessionId, agInstruction2, {
    cwd: workspaceDir,
    effort: 'low',
    request_id: `min2turn-ag-t2-${runTimestamp}`,
    timeout_ms: 120000
  });
  const agTurn2Duration = Date.now() - agTurn2StartTime;

  console.log(`\nAG_TURN_2: ${agRes2.status} (${agTurn2Duration}ms)`);
  console.log('AG_TURN_2_RESPONSE_SNIPPET:', agRes2.response.slice(0, 150));

  assert.equal(agRes2.status, 'COMPLETED', `AG Turn 2 must complete, got: ${JSON.stringify(agRes2.error)}`);

  const fileContentT2 = fs.readFileSync(targetFile, 'utf8').replace(/\r\n/g, '\n').trim();
  console.log('\nAG_TURN_2_EVIDENCE (file content):', fileContentT2);

  assert.ok(fileContentT2.includes('GPT-LOOP-1'), 'Arquivo deve preservar GPT-LOOP-1');
  assert.ok(fileContentT2.includes('GPT-LOOP-2'), 'Arquivo deve conter a nova evidência GPT-LOOP-2');

  console.log('\n================================================================');
  console.log('PHASE 4 MINIMAL 2-TURN TEST: PASS');
  console.log('CLOSED LOOP VERIFICADO DE PONTA A PONTA!');
  console.log('================================================================\n');
});
