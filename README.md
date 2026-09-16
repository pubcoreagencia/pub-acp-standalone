# pub-acp-standalone

Independent Black-Box Consumer for `pub-acp-lab`.

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
PUB-ACP-LAB
        │
        ▼
Chrome isolado
        │
        ▼
ChatGPT Free
```

### O que o standalone conhece:
* HTTP endpoints (`GET /v1/health`, `POST /v1/transport/prompt`)
* JSON request e response
* `request_id`, `session_id`, `timeout_ms`
* Contratos de erro HTTP e JSON

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

O endpoint do ACP-LAB pode ser configurado via variável de ambiente:

```bash
# Padrão: http://127.0.0.1:5125
export ACP_LAB_URL=http://127.0.0.1:5125
```

## Comandos CLI

```bash
# Verificar saúde do ACP-LAB
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
