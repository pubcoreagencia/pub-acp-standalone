# Matriz de Testes — pub-acp-standalone

TEST | EXPECTED | ACTUAL | STATUS | EVIDENCE
---|---|---|---|---
`contract:health-mock` | HTTP 200 JSON { status: 'ok', initialized: true } | Recebido status 'ok' e initialized: true via mock server HTTP | PASS | `tests/contract/health.test.ts`
`contract:health-503-error` | HTTP 503 lança AcpLabClientError com code HTTP_ERROR e status 503 | Rejeição capturada com code: 'HTTP_ERROR', status: 503 | PASS | `tests/contract/health.test.ts`
`integration:live-health` | Comunicação real contra ACP-LAB na porta 5125 | Recebido payload de diagnóstico com { status: 'ok', initialized: true, isProcessing: false } | PASS | `tests/integration/live-health.test.ts`
`e2e:client-smoke` | Cliente instancia e expõe métodos públicos health e prompt | Métodos health e prompt validados como funções | PASS | `tests/e2e/client.e2e.test.ts`
`cli:health` | Execução CLI exibe "ACP-LAB ONLINE" e JSON formatado | CLI imprimiu "ACP-LAB ONLINE" e objeto de status na saída padrão | PASS | `npm run cli:health` / `dist/cli/index.js`
