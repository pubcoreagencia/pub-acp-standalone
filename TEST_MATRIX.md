# Matriz de Testes — pub-acp-standalone

TEST | EXPECTED | ACTUAL | STATUS | EVIDENCE
---|---|---|---|---
`contract:health-mock` | HTTP 200 JSON { status: 'ok', initialized: true } | Recebido status 'ok' e initialized: true via mock server HTTP | PASS | `tests/contract/health.test.ts`
`contract:health-503-error` | HTTP 503 lança AcpLabClientError com code HTTP_ERROR e status 503 | Rejeição capturada com code: 'HTTP_ERROR', status: 503 | PASS | `tests/contract/health.test.ts`
`integration:live-health` | Comunicação real contra ACP-LAB na porta 5125 | Recebido payload com status: 'ok', initialized: true, browser_healthy: true, cdp_connected: true, page_responsive: true | PASS | `tests/integration/live-health.test.ts`
`e2e:client-smoke` | Cliente instancia e expõe métodos públicos health e prompt | Métodos health e prompt validados como funções | PASS | `tests/e2e/client.e2e.test.ts`
`e2e:real-prompt-turn1` | Resposta textual real do ChatGPT contendo 'ACP-STANDALONE-E2E-OK' | Retornado text 'ACP-STANDALONE-E2E-OK' em 2791ms, status: 'completed', turn: 1 | PASS | `tests/e2e/real-prompt.e2e.test.ts`
`e2e:session-continuity-turn2` | ChatGPT responde ao segundo prompt comprovando contexto anterior ('ACP-STANDALONE-E2E-OK') | Retornado text contendo 'ACP-STANDALONE-E2E-OK' na mesma sessão, status: 'completed', turn: 2 | PASS | `tests/e2e/real-prompt.e2e.test.ts`
`e2e:idempotency-replay` | Segundo request com mesmo request_id retorna replay idêntico instantaneamente sem refazer prompt físico | Replay idêntico concluído em 2ms com mesmo response token | PASS | `tests/e2e/real-prompt.e2e.test.ts`
`e2e:idempotency-conflict` | Mesmo request_id com payload diferente retorna erro estruturado IDEMPOTENCY_CONFLICT | Rejeição estruturada capturada: code 'IDEMPOTENCY_CONFLICT' | PASS | `tests/e2e/real-prompt.e2e.test.ts`
`e2e:error-invalid-request` | Prompt vazio retorna erro estruturado INVALID_REQUEST | Rejeição estruturada capturada: code 'INVALID_REQUEST' | PASS | `tests/e2e/real-prompt.e2e.test.ts`
`contract:session-busy` | Provocar concorrência direta sem acesso interno | Concorrência paralela estrita em um único thread físico | NOT TESTABLE FROM BLACK-BOX CONTRACT | Registrado conforme especificação da Phase 1 (requer concorrência artificial não exposta no contrato black-box)
`cli:health` | Execução CLI exibe "ACP-LAB ONLINE" e JSON formatado | CLI imprimiu "ACP-LAB ONLINE" e objeto de status na saída padrão | PASS | `npm run cli:health` / `dist/cli/index.js`
`cli:prompt` | Execução CLI submete prompt e imprime resposta física do ChatGPT | CLI imprimiu "ACP-CLI-E2E-OK" com metadados (turn 1, duration_ms: 2788) | PASS | `npm run cli:prompt`

## BACKGROUND BROWSER RELIABILITY

| Scenario              | Chrome State          | ACP HTTP | CDP  | Prompt | Multi-turn | Result | Evidence |
| --------------------- | --------------------- | -------- | ---- | ------ | ---------- | ------ | -------- |
| Foreground baseline   | Foreground            | PASS     | PASS | PASS   | N/A        | PASS   | `tests/integration/background-reliability.test.ts` |
| Behind-window         | Visible but unfocused | PASS     | PASS | PASS   | N/A        | PASS   | `tests/integration/background-reliability.test.ts` |
| Background multi-turn | Behind-window         | PASS     | PASS | PASS   | PASS       | PASS   | `tests/integration/background-reliability.test.ts` |
| Live health           | Background            | PASS     | PASS | N/A    | N/A        | PASS   | `tests/integration/live-health.test.ts` |

> Background browser execution is operationally validated. Chrome foreground/focus is not required by the tested transport path.
