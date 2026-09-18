# PUB ACP — HANDOFF HERMES

## Repository

pubcoreagencia/pub-acp-standalone

## Branch

feature/gpt-executor-v1

## Latest checkpoint

HEAD remoto conhecido antes deste checkpoint:
e1d90905522e097a0a383fc7eab0f453dad30219
feat(control-room): add browser operator v0

## Objetivo atual

Transformar o PUB ACP em Control Room operacional de agente autônomo.

## Arquitetura comprovada

```
Control Room
→ Control Plane
→ ProjectRegistry
→ ProjectDispatcher
→ SafetyGate
→ WorkspaceLock
→ ClosedLoopEngine
→ GPT Direct
→ ToolRegistry
→ ferramentas
→ EventBus
→ RunStore
→ SSE
→ UI
```

## Executor modes

- `gpt-direct`
- `gpt-antigravity`

## GPT Direct comprovado

- `RUN_COMPLETED`
- `provider=gpt`
- `executorMode=gpt-direct`
- zero `AG_STARTED`
- zero `AG_OUTPUT`
- zero `AG_FINISHED`
- AG executions isoladas de Tools Direct

## Browser Operator V0

### Capabilities

| Capability | Descrição |
|---|---|
| `browser.status` | Estado da conexão CDP |
| `browser.navigate` | Navegar para URL |
| `browser.read` | Ler DOM/título/URL da página atual |
| `browser.screenshot` | Capturar screenshot |

### Endpoints REST

```
GET  /api/browser/status
POST /api/browser/navigate
GET  /api/browser/page
POST /api/browser/screenshot
```

### Chrome

- CDP: `127.0.0.1:9222`
- Perfil persistente: `~/Documents/PUB-ACP/browser-profile`
- Launcher: `launch_pub_acp_browser.sh`

## Browser proof

O Browser Operator real já foi executado e comprovado com:

- `CDP CONNECTED`
- `browser.navigate` → SUCCESS
- `browser.read` → SUCCESS
- `browser.screenshot` → SUCCESS
- `GPT Direct RUN` → COMPLETED

Evidência: `BROWSER_OPERATOR_V0_E2E_REPORT.json` na raiz do repositório.

## Ponto conhecido / dívida técnica

### Problema identificado

A última auditoria encontrou que o wiring da instância compartilhada do `BrowserOperator`/`EventBus` precisa ser confirmado.

**Risco:** `ToolRegistry` e `GptExecutionTransport` podem instanciar `BrowserOperator` de forma independente, em vez de reutilizar a instância compartilhada inicializada pelo Control Plane — fazendo com que eventos `BROWSER_*` não cheguem ao `RunStore`/SSE.

### Próximo trabalho do Hermes

Confirmar **dependency injection** da mesma instância em toda a cadeia:

```
createControlPlane
  └─ shared EventBus
  └─ shared BrowserOperator (instância única)
       └─ GptExecutionTransport
            └─ ToolRegistry
                 └─ BrowserTool (recebe shared BrowserOperator)
```

Depois repetir E2E e confirmar que os eventos abaixo chegam ao `RunStore`/SSE:

```
BROWSER_CONNECTED
BROWSER_NAVIGATION_STARTED
BROWSER_NAVIGATION_FINISHED
BROWSER_READ
BROWSER_SCREENSHOT
BROWSER_BLOCKED
BROWSER_ERROR
```

### Arquivos-chave

| Arquivo | Papel |
|---|---|
| `src/bootstrap/createControlPlane.ts` | Instanciação e wiring central |
| `src/browser/BrowserOperator.ts` | Operador CDP real |
| `src/tools/BrowserTool.ts` | Adapter para ToolRegistry |
| `src/tools/ToolRegistry.ts` | Registro e execução de tools |
| `src/bridge/execution.ts` | ExecutionBridge / GPT Direct turn loop |
| `src/bridge/ClosedLoopEngine.ts` | Engine de loop fechado |
| `src/observability/wireEventBus.ts` | Wiring EventBus → RunStore |
| `src/observability/types.ts` | Tipos de estado (`TOOL_RUNNING`, `DIRECT_RUNNING`) |
| `scripts/run-browser-operator-proof.ts` | Script E2E de prova do Browser Operator |

## Estado operacional

O código do Browser Operator V0 **já existe e deve ser preservado**.

## Proibições

- Não reescrever `ClosedLoopEngine`
- Não duplicar `EventBus`
- Não duplicar perfil de browser
- Não remover fluxo GPT→Antigravity

## Próximo executor

**HERMES**

## Regra de continuidade

GitHub é a fonte de verdade. Começar sempre conferindo:

```bash
git status
git branch --show-current
git rev-parse HEAD
git log -n 5 --oneline
```
