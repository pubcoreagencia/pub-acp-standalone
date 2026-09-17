# Antigravity Conversation Discovery — Arquitetura e Isolamento

## 1. Visão Geral

Este documento descreve o funcionamento, as garantias e o isolamento do adapter de descoberta de conversas do Google Antigravity (`AntigravitySessionStore`).

O objetivo do adapter é permitir que o ACP consulte as conversas existentes no Antigravity CLI e identifique com precisão cirúrgica quais pertencem ao workspace de um determinado projeto, viabilizando a futura seleção e retomada de trabalho a partir do Control Room.

---

## 2. Fonte Utilizada

O Antigravity CLI v1.2.4 persiste o índice de todas as conversas do usuário no banco SQLite central:
```text
~/.gemini/antigravity/conversation_summaries.db
```

### Características Técnicas
* **Modo de Acesso**: Estritamente **Read-Only** (`{ readOnly: true }` via `node:sqlite`).
* **Concorrência**: O banco opera com WAL (`.db-wal`). O acesso em somente leitura não compete por locks de escrita com o CLI e nunca interrompe a execução do `agy`.
* **Zero Spawns**: A consulta é puramente SQL em memória/disco; nenhum processo `agy` é iniciado durante o discovery.

---

## 3. Campos Consumidos

O adapter mapeia estritamente os campos essenciais da tabela `conversation_summaries` para a interface pública `AgConversationSummary`:

| Coluna SQLite | Campo `AgConversationSummary` | Significado |
| :--- | :--- | :--- |
| `conversation_id` | `conversationId` | UUID canônico da conversa (usado no `--conversation <id>`) |
| `title` | `title` | Título humano atribuído à conversa |
| `preview` | `preview` | Prévia do conteúdo ou último comando |
| `status` | `status` | Estado da conversa (`CASCADE_RUN_STATUS_IDLE`, `CASCADE_RUN_STATUS_RUNNING`) |
| `last_modified_time` | `lastModifiedTime` | Timestamp da última atividade |
| `step_count` | `stepCount` | Quantidade de passos executados na conversa |

---

## 4. Relação Conversation ↔ Workspace

O Antigravity armazena a associação com o diretório de trabalho na coluna `workspace_uris` em formato de array JSON contendo URIs codificados:
```json
["file:///c%3A/Users/Matheus%20Paes/Documents/ChatGPT/pub-acp-standalone"]
```

### Normalização Determinística
O método `normalizeWorkspacePathToUri(rawPath)` converte qualquer caminho de arquivo (ex: `C:\Users\...` no Windows ou `/home/...` no Linux) para o formato exato esperado:
1. Resolve o caminho absoluto (`path.resolve`).
2. Converte para URI (`url.pathToFileURL`).
3. No Windows, ajusta a letra do drive para minúsculo e a codificação do dois-pontos (`file:///c%3A/...`).
4. Remove barras finais (`/`) para evitar inconsistências de comparação.

---

## 5. Princípio de Isolamento e Fragilidade Potencial

> [!WARNING]
> O arquivo `conversation_summaries.db` é um **storage interno e não-contratual** do Google Antigravity, não uma API pública garantida por SLA.

Por esta razão:
1. **Zero Vazamento**: Nenhuma outra parte do ACP (nem `ProjectDispatcher`, nem `ClosedLoopEngine`, nem `ControlRoomServer`, nem `SafetyGate`) conhece o schema do SQLite, nem importa `node:sqlite`.
2. **Isolamento de Contrato**: Todo o acesso ao banco e normalização é encapsulado por `IAntigravitySessionStore`.
3. **Substituibilidade**: Caso futuras versões do Antigravity CLI disponibilizem um subcomando nativo como `agy conversations --json`, apenas o `AntigravitySessionStore` precisará ser ajustado, mantendo 100% dos consumidores intocados.
