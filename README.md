# pub-acp-standalone

Independent GPT-only autonomous execution client with provider-neutral HTTP transport.

## Propósito

O **PUB-ACP-STANDALONE** é um consumidor externo e independente construído do zero para testar e validar o **PUB-ACP-LAB** estritamente através do seu contrato público HTTP/JSON.

A pergunta central deste projeto é:
> Uma aplicação nova, criada do zero, consegue consumir o ACP-LAB exclusivamente através de seu contrato público e executar uma conversa real com ChatGPT Free sem intervenção humana?

## Arquitetura Black-Box

O `pub-acp-standalone` não possui acoplamento interno com CDP, Chrome, DOM ou drivers de browser. Ele opera exclusivamente como consumidor HTTP.

```text
PUB-ACP-STANDALONE
        │
        │ HTTP / JSON
        ▼
GPT Transport
        │
        ▼
OpenAI-compatible endpoint
        │
        ▼
GPT model
```

### O que o standalone conhece:
* OpenAI-compatible `GET /models`
* OpenAI-compatible `POST /chat/completions`
* JSON request e response
* `request_id`, `session_id`, `timeout_ms`
* Contratos de erro HTTP e JSON
* `GPT_BASE_URL`, `GPT_API_KEY`, `GPT_MODEL`

### O que o standalone NÃO conhece:
* Chrome, CDP, DOM
* `ChatGptDriver`, `BrowserManager`, `RecoveryManager`
* URLs internas ou sockets CDP

## Instalação e Requisitos

* Node.js >= 20.0.0
* npm >= 9.0.0

```bash
git clone https://github.com/pubcoreagencia/pub-acp-standalone.git
cd pub-acp-standalone
npm install
npm run build
```

## Configuração

O transporte GPT usa qualquer endpoint OpenAI-compatible:

```bash
export GPT_BASE_URL=https://api.openai.com/v1
export GPT_API_KEY=...
export GPT_MODEL=...
```

Um gateway local pode ser usado opcionalmente, configurando `GPT_BASE_URL` para o seu endpoint `/v1`.

## Comandos CLI

```bash
# Verificar saúde do endpoint GPT
npm run cli:health
# ou após build:
node dist/cli/index.js health

# Executar prompt
npm run cli:prompt "Olá, ChatGPT"
# ou com parâmetros:
node dist/cli/index.js prompt "Texto" --session <session-id> --timeout 60000
```

## Testes

```bash
# Executar todos os testes
npm test

# Executar suítes específicas
npm run test:contract
npm run test:integration
npm run test:e2e
```

## Legado

Os artefatos do ACP-LAB/Antigravity permanecem no repositório apenas como histórico e compatibilidade. Eles não fazem parte do caminho GPT-only ativo.

## Known Limitation — Provider compatibility

* **Conversas Longas:** O ChatGPT pode virtualizar e remover mensagens antigas do DOM em conversas com múltiplos turnos.
* **Mecanismo Atual:** O driver do ACP-LAB utiliza a contagem de nós `assistant` como parte da detecção de novos turnos.
* **Comportamento Observado:** Quando nós antigos saem do DOM, a contagem total diminui, o que pode fazer com que `waitForCompletion()` aguarde até o timeout, apesar de a resposta já ter sido renderizada na interface.
* **Escopo:** Esta investigação foi reproduzida e observada empiricamente durante a Phase 2. Trata-se de uma limitação do mecanismo de observação do driver, e **não** de evidência de dependência de Chrome em foreground.
* **Trabalho Futuro:** A correção desta limitação fica formalmente postergada para endurecimento posterior do driver:
  ```text
  FOLLOW-UP:
  DOM virtualization resilient turn detection
  ```

