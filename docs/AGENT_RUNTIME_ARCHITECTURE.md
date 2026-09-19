# PUB ACP — Multi-Agent Runtime Architecture

## 1. Executive Summary & Core Principle

O **PUB ACP (Agent Control Plane)** opera como um plano de controle desacoplado de qualquer runtime ou agente específico.

### O Princípio Canônico
> **Antigravity, Codex, Claude Code, Hermes, OpenClaw e outros não são o Core do ACP.**
> Eles são **Execution Runtimes** intercambiáveis, representados via adapters e governados por contratos formais de capacidades, políticas e segurança.

O Core do ACP é responsável por:
1. **Governança & Autorização** (`Catalog = Authorization`).
2. **Contexto & Isolamento de Projetos/Workspaces** (`WorkspaceLock`, `SafetyGate`).
3. **Orquestração de Descoberta** (`DiscoveryOrchestrator`).
4. **Ciclo Fechado de Execução** (`ClosedLoopEngine`, `EventBus`, `RunStore`).
5. **Roteamento de Execução** (`AgentRuntimeRouter`).

---

## 2. Diagrama Arquitetural Canônico

```text
                     GPT / Planner
                           │
                           ▼
                     ┌────────────┐
                     │  PUB ACP   │
                     │  CONTROL   │
                     │   PLANE    │
                     └─────┬──────┘
                           │
                     ExecutionPlan
                           │
                     RuntimeRouter
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
       ▼                   ▼                   ▼
 Antigravity Adapter  Codex Adapter   Claude Code Adapter
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                   Hermes / OpenClaw
                           │
                           ▼
                       Workspace
```

### Ciclo de Vida Operacional
```text
Discovery ──► Validation ──► Authorization ──► Execution
 (Candidates)  (Integrity)     (Catalog)     (RuntimeAdapter)
```

---

## 3. Matriz de Identidade & Domínio

Para eliminar acoplamentos e ambiguidades, os conceitos de identidade são estritamente separados:

| Conceito | Definição | Exemplo |
| :--- | :--- | :--- |
| **Repository Identity** | Identidade lógica de versão e histórico Git (remotes, origin URL, commit tree). | `git@github.com:org/repo.git` |
| **Workspace Identity** | Instância física absoluta e canônica do checkout no disco. | `C:/workspaces/checkout-1` |
| **Project Identity** | Unidade de autorização e governança no Catálogo ACP. | `pubcoreagencia-pub-acp-standalone` |
| **Runtime Identity** | Instância de motor/executor registrada no ACP. | `antigravity-local-worker-1` |
| **Agent Identity** | Especialização lógica, modelo ou persona do agente dentro do runtime. | `gemini-3.8-flash`, `claude-3-7-sonnet` |
| **Provider** | Fornecedor da tecnologia de execução do agente. | `google`, `openai`, `anthropic`, `oss` |
| **Account** | Credencial/quota/subscrição operacional que alimenta o runtime. | `billing-tier-pro-team-1` |
| **Session** | Sessão de interação e conversa mantida no runtime. | `session-uuid-42` |

> **Invariante:** Dois Workspaces físicos distintos podem compartilhar o mesmo Repository Identity (ex.: worktrees). A autorização e locks continuam operando por **Workspace/Project**. O **Runtime** executa apenas sobre um Workspace previamente autorizado.

---

## 4. Contratos Abstratos

### 4.1. `AgentCapabilities`
Capacidades declarativas expressas como dados estruturados, evitando `if (runtime === 'antigravity')`:

```ts
export type AgentCapability =
  | 'filesystem.read'
  | 'filesystem.write'
  | 'shell.execute'
  | 'git.read'
  | 'git.write'
  | 'test.execute'
  | 'network.access'
  | 'interactive'
  | 'streaming'
  | 'headless'
  | 'approval'
  | 'sandbox';

export interface AgentRuntimeCapabilities {
  supported: AgentCapability[];
  maxConcurrency?: number;
  supportsStreaming: boolean;
  requiresHumanApproval: boolean;
  isHeadless: boolean;
}
```

### 4.2. `AgentRuntime`
Contrato que todo adapter deve satisfazer:

```ts
export interface RuntimeHealth {
  healthy: boolean;
  latencyMs?: number;
  availableCapacity: number; // 0.0 a 1.0
  message?: string;
}

export interface IAgentRuntime {
  readonly id: string;
  readonly provider: string; // 'antigravity' | 'codex' | 'claude-code' | 'hermes' | 'openclaw'
  readonly version: string;
  readonly capabilities: AgentRuntimeCapabilities;

  checkHealth(): Promise<RuntimeHealth>;
  
  execute(
    plan: ExecutionPlan,
    onEvent?: (event: ExecutionEvent) => void,
    signal?: AbortSignal
  ): Promise<ExecutionResult>;
}
```

### 4.3. Contratos de Execução
A troca entre `ClosedLoopEngine` e qualquer `IAgentRuntime` é 100% agnóstica:

```ts
export type RunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED';

export interface ExecutionRequest {
  taskId: string;
  projectId: string;
  workspacePath: string;
  prompt: string;
  requiredCapabilities: AgentCapability[];
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ExecutionPlan {
  planId: string;
  runtimeId: string;
  request: ExecutionRequest;
  allocatedAccount?: string;
  createdAt: string;
}

export interface ExecutionEvent {
  runId: string;
  type: 'CHUNK' | 'TOOL_CALL' | 'STATUS_CHANGE' | 'ERROR';
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface ExecutionResult {
  runId: string;
  status: RunStatus;
  output: string;
  diagnostics?: string[];
  metrics?: {
    durationMs: number;
    tokensPrompt?: number;
    tokensCompletion?: number;
    turnsCount?: number;
  };
}
```

---

## 5. Componentes do Plano de Controle

### 5.1. `AgentRuntimeRegistry`
- Armazena e expõe instâncias de `IAgentRuntime`.
- Responsabilidades: `register(runtime)`, `unregister(runtimeId)`, `get(runtimeId)`, `list()`, `checkAllHealth()`.
- **Invariante de Segurança:** Não substitui o `ProjectRegistry` e **não concede autorização** a projetos ou diretórios.

### 5.2. `AgentRuntimeRouter`
- Recebe `ExecutionRequest` + Políticas do Sistema.
- Seleciona o runtime que satisfaça:
  1. `requiredCapabilities` é subconjunto de `runtime.capabilities.supported`.
  2. Runtime reporta `health.healthy === true` e `availableCapacity > 0`.
  3. Políticas do ACP (ex.: afinidade de projeto, permissões de sandbox).
- Produz o `ExecutionPlan` imutável para despacho.

### 5.3. Relação com o `ClosedLoopEngine`
- O `ClosedLoopEngine` deixa de depender de `AntigravityBridge` diretamente.
- O loop de controle delega a execução para a interface genérica `IAgentRuntime`.
- O adapter do Antigravity passa a ser apenas `AntigravityRuntimeAdapter implements IAgentRuntime`.

---

## 6. Governança de Contas, Capacidade & Fallback

### 6.1. Contas & Capacidade (Account / Capacity)
```text
Runtime
 ├── Account / Profile
 │    ├── capacity (slots disponíveis)
 │    ├── health (status da chave/sessão)
 │    └── limits (rate limits conhecidos da API)
 └── Session (estado transitório da conversa)
```
- A camada de contas permite selecionar instâncias de runtime que possuam capacidade operacional no momento.
- Não há mecanismos de evasão ou rotação ilícita; apenas seleção de rotas de execução legítimas e com slots vagos.

### 6.2. Política de Fallback
- O fallback não é silencioso nem arbitrário.
- Se `Runtime A` falha com `UNAVAILABLE` ou `TIMEOUT`:
  ```text
  Execution ──► Runtime A ──► Fail ──► Policy Check ──► Runtime B
  ```
- O fallback só ocorre se:
  1. O workspace e a tarefa permitirem explicitamente multi-runtime.
  2. `Runtime B` possuir paridade com as `requiredCapabilities`.
  3. A transição for auditada e registrada no `EventBus` do ACP.

---

## 7. Relação com a Fase 6.2 (Discovery)

A descoberta de runtimes segue as mesmas regras de governança de projetos:
- **Discovery de Projetos:** descobre candidatos a projetos no disco (`DISCOVERY ≠ AUTHORIZATION`).
- **Discovery de Runtimes:** descobre binários ou serviços de agentes instalados na máquina (ex: `antigravity.exe`, `claude`, `codex`).
- **Invariante Absoluto:** Encontrar um runtime ou um projeto **não o autoriza automaticamente**. O `Catalog` permanece como a única fonte de autorização de projetos, e as políticas de configuração do ACP definem os runtimes autorizados a executar.

---

## 8. Status do Antigravity
O `Antigravity` permanece plenamente suportado:
- Todo o código funcional atual é encapsulado em seu respectivo adapter.
- Nenhuma feature ou integração existente é removida.
- O Antigravity passa a ser um participante formal do ecossistema de runtimes do ACP, abrindo as portas para Claude Code, Codex, Hermes e OpenClaw sem refatorações destrutivas.
