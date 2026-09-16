# ANTIGRAVITY BRIDGE ARCHITECTURE

## 1. Contexto e Propósito

O objetivo deste componente no `pub-acp-standalone` é fornecer uma ponte de execução programática desacoplada para o agente Antigravity, viabilizando o loop de orquestração automatizado e eliminando qualquer intervenção manual de clipboard (`MANUAL_COPY_PASTE_OPERATIONS = 0`).

```text
               GPT FREE / ORQUESTRADOR
                         │
                         ▼
                ┌──────────────────┐
                │  ACP-STANDALONE  │
                │                  │
                │  Antigravity     │
                │  Bridge          │
                │  Session Manager │
                └────────┬─────────┘
                         │
                         ▼
                AntigravityTransport
                         │ (CLI subprocess / JSON IPC)
                         ▼
                     agy.exe
                         │ (native engine / tools)
                         ▼
                 Workspace / Sistema
```

---

## 2. Decisão Arquitetural de Transporte

Conforme a hierarquia de preferências:
1. **Preferência 1 (Adotada):** Interface CLI/Processo oficial (`agy.exe`).
   - Binário oficial localizado no ambiente: `C:\Users\Matheus Paes\AppData\Local\agy\bin\agy.exe`.
   - Modos utilizados:
     - `--print "<prompt>"` / `--output-format json` para execução determinística batch.
     - `--conversation "<conversation_id>"` para persistência nativa de contexto multi-turno.
     - `--add-dir "<workspace_dir>"` para vinculação de escopo e workspace local.
     - `--dangerously-skip-permissions` para execução automatizada sem bloqueio de prompt de confirmação de ferramenta.
2. **Rejeição de UI Automation / Clipboard (Preferência 4):**
   - Não foram utilizados atalhos de teclado, mouse ou `Ctrl+V`.
   - Sem risco de desvio de foco de janela no Windows.
   - Respostas retornam diretamente em JSON estruturado via stdout do processo.

---

## 3. Componentes Implementados

### `AntigravityTransport` (`src/antigravity/AntigravityTransport.ts`)
- Encapsula o ciclo de vida do processo filho `agy.exe`.
- Métodos principais:
  - `health()`: Verifica a integridade e disponibilidade do executável.
  - `sendPrompt(prompt, options)`: Executa turnos únicos ou vinculados a uma sessão, retornando `AntigravityExecutionResult`.
  - `sendPromptInConversation(conversationId, prompt, options)`: Garante continuação estrita na mesma thread do agente.

### `AntigravityBridge` (`src/antigravity/AntigravityBridge.ts`)
- Gerenciador de sessões e orquestrador de turnos contínuos.
- Métodos principais:
  - `executeTurn(sessionId, prompt, options)`: Vincula `sessionId` a uma `conversationId` permanente do Antigravity, acumulando o histórico de turnos.
  - `runLoop(sessionId, prompts, options)`: Permite execução sequencial orientada a loops programáticos (onde um turno pode computar dinamicamente o prompt do turno seguinte com base na resposta anterior).

---

## 4. Estados Estruturados de Execução

O protocolo opera com estados fortemente tipados:
- `IDLE`: Inicializado e aguardando.
- `DISPATCHING`: Montando parâmetros e invocando processo.
- `RUNNING`: Em processamento no runtime.
- `COMPLETED`: Turno finalizado com sucesso (`raw.status === 'SUCCESS'`).
- `FAILED`: Falha na execução ou no subprocesso.
- `TIMEOUT`: Excedido o limite de tempo configurado (`timeout_ms`).
- `HUMAN_REQUIRED`: Em caso de barreiras externas ou necessidade de autenticação.
- `UNKNOWN`: Estado indeterminado.

---

## 5. Garantia de Zero Copy/Paste

- Nenhuma operação de clipboard (Windows Clipboard API, `Ctrl+C`, `Ctrl+V`) é invocada.
- O teste de integração `tests/integration/antigravity-bridge.test.ts` provou a execução física de dois turnos sequenciais (criação e append do arquivo `TEST_BRIDGE.txt`) e simulação de loop de forma 100% autônoma.
