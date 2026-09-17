# PUB ACP — Telemetria Real GPT ↔ AG

## Status

```text
STATUS: CLOSED
DATA DA AUDITORIA: 2026-09-16
VEREDITO: FECHADA E COMPLETA
```

---

## 1. Visão Geral e Garantias

Este documento formaliza a conclusão da auditoria de telemetria da conversa real entre o **GPT Planner** e o **Antigravity CLI (AG)** no `pub-acp-standalone`.

Ficou auditado e comprovado em nível de código-fonte que o sistema captura e transporta integralmente — de ponta a ponta — as mensagens e respostas reais trocadas pelos modelos durante a execução autônoma, viabilizando a exibição como uma **Chat View real no Control Room**, sem cortes ou resumos.

### Garantias Comprovadas
1. **Preservação Integral**: Os textos enviados pelo GPT e as respostas do AG são preservados 100% integrais ao longo de todo o pipeline, sem truncamento (`.slice()`), sem resumos automáticos e sem DTOs intermediários de compactação.
2. **Sanitização de Segurança**: A única transformação aplicada aos dados é a sanitização de credenciais e segredos em `src/observability/sanitizer.ts` (ex: substituição de padrões como `ghp_`, `sk-`, `bearer` por `[REDACTED]`), mantendo todo o conteúdo textual e técnico intocado.
3. **Isolamento Absoluto (Real vs Demo)**:
   ```text
   EXECUÇÃO REAL ≠ DEMOFEED
   ```
   Uma execução real (`ProjectDispatcher.dispatch()` ou `ClosedLoopEngine.runLoop()`) consome exclusivamente eventos gerados pelos motores vivos. O gerador sintético (`DemoFeed.ts`) é acionado apenas e estritamente sob demanda via botão "Simular Demo" (`POST /api/demo/start`).

---

## 2. Campos Canônicos da Telemetria

Os três pilares da conversação real e seus campos auditados são:

| Campo Canônico | Evento | Origem | Significado | Integridade |
| :--- | :--- | :--- | :--- | :--- |
| `details.prompt` | `GPT_DECISION` | `ClosedLoopEngine.ts:143` | Prompt de planejamento completo enviado ao GPT | 🟢 **100% INTEGRAL** |
| `details.instruction` | `AG_STARTED` | `ClosedLoopEngine.ts:224` | Instrução de engenharia real gerada pelo GPT para o AG | 🟢 **100% INTEGRAL** |
| `details.response` | `AG_OUTPUT` | `ClosedLoopEngine.ts:251` | Resposta completa produzida pelo Antigravity CLI | 🟢 **100% INTEGRAL** |

---

## 3. Pipeline Real de Ponta a Ponta

O fluxo real de transporte de dados foi auditado arquivo por arquivo:

```text
                           GPT (Free / ACP-Lab)
                                    │
                                    │ prompt real (gptPrompt)
                                    ▼
                              GPT_DECISION
                          details.prompt [100%]
                                    │
                                    ▼
                 [ ClosedLoopEngine.ts : emitEvent ]
                                    │
                                    ▼
                      [ EventBus.ts : publish ]
                     (sanitização de secrets)
                                    │
                                    ▼
                  [ RunStore.ts : appendEvent ]
                    (armazenamento integral)
                                    │
                                    ▼
                [ wireEventBus.ts : sincronização ]
                   (atualização do RunModel)
                                    │
                                    ▼
               [ ControlRoomServer.ts : SSE / REST ]
               (/api/runs/:id/stream & /api/runs/:id)
                                    │
                                    ▼
                    [ Frontend : public/app.js ]
                  (appendFlowEvent / createCard)
                                    │
                                    ▼
                 🧠 GPT → AG (Card Visual Control Room)
                 [Mensagem real expansível e copiável]

                                    │
                                    │ gptResult.text
                                    ▼
                               AG_STARTED
                       details.instruction [100%]
                                    │
                                    ▼
                              ANTIGRAVITY CLI
                                    │
                                    │ agResult.response
                                    ▼
                                AG_OUTPUT
                        details.response [100%]
                                    │
                                    ▼
                      [ EventBus.ts : publish ]
                                    │
                                    ▼
                  [ RunStore.ts : appendEvent ]
                                    │
                                    ▼
               [ ControlRoomServer.ts : SSE / REST ]
                                    │
                                    ▼
                    [ Frontend : public/app.js ]
                                    │
                                    ▼
                 🤖 AG → GPT (Card Visual Control Room)
                 [Resposta real expansível e copiável]
```

---

## 4. Gaps Futuros (Exclusos da Telemetria Atual)

Fica explicitamente documentado que os itens abaixo **NÃO** fazem parte da telemetria fechada do ciclo conversacional e representam evoluções futuras a serem desenhadas:

### GAP 1 — Validação Semântica
* **Situação Atual**: Não existe um passo intermediário canônico entre `AG_OUTPUT` e um validador autônomo (`VALIDATION_STARTED` / `VALIDATION_RESULT`) dentro do `ClosedLoopEngine`.
* **Comportamento**: A validação entre turnos só ocorre se instruída no próprio prompt do GPT ou se os testes forem disparados externamente.

### GAP 2 — Correção Semântica
* **Situação Atual**: Não existe um evento canônico específico com tipo `CORRECTION`.
* **Comportamento**: Quando há autocorreção, ela é tratada operacionalmente como um novo turno sequencial padrão (`GPT_DECISION` do Turno 2), lendo o erro retornado no turno anterior.

### GAP 3 — Separação Explícita entre Análise e Instrução
* **Situação Atual**: O retorno gerado pelo GPT Free é uma resposta textual única e monolítica.
* **Comportamento**: Não há uma divisão canônica estruturada entre *análise/raciocínio* do GPT e *instrução operacional de comando* entregue ao AG.
