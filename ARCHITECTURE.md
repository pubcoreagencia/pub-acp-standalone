# Arquitetura — pub-acp-standalone

## Visão Geral

O projeto implementa uma barreira estrita de isolamento (Black Box Boundary) em relação ao backend do **PUB-ACP-LAB**.

```text
PUB-ACP-STANDALONE
        │
        │ HTTP/JSON
        ▼
PUB-ACP-LAB
        │
        ▼
Chrome isolado
        │
        ▼
ChatGPT Free
```

## Componentes

1. **AcpLabClient (`src/client/`)**
   - Abstração de transporte HTTP via `fetch` nativo.
   - Gerenciamento de timeouts com `AbortController`.
   - Normalização e tratamento estruturado de erros com `AcpLabClientError`.
   - Métodos públicos: `health()` e `prompt()`.
   - Respeito integral aos campos `request_id`, `session_id`, `status` e `metadata`.

2. **CLI (`src/cli/`)**
   - Utilitário de linha de comando para validação rápida (`health` e `prompt`).

3. **Test Suites (`tests/`)**
   - `contract/`: Validação de contratos HTTP e payloads com mock server.
   - `integration/`: Verificação de comunicação real ponta a ponta contra daemon ACP-LAB.
   - `e2e/`: Cenários determinísticos de execução do consumidor independente.

## Boundary Inviolável

O cliente comunica-se apenas através de transporte HTTP/JSON padronizado:
- `GET /v1/health`
- `POST /v1/transport/prompt`

Nenhum módulo interno do ACP-LAB, automação de browser, CDP, DOM ou dependência do PDL é importado.
