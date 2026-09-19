# GPT Transport Architecture — PUB-ACP-STANDALONE

## 1. Overview
The GPT Transport in `pub-acp-standalone` (`src/gpt/GptTransport.ts`) is a provider-neutral HTTP adapter for OpenAI-compatible endpoints. It exposes health, prompt dispatch, logical session correlation, timeout handling, and structured errors.

## 2. Interface & Contracts
- **Interface**: `IGptTransport`
  - `sendPrompt(prompt: string, options?: GptPromptOptions): Promise<GptPromptResponse>`
  - `continueSession(sessionId: string, prompt: string, options?: GptPromptOptions): Promise<GptPromptResponse>`
  - `health(timeoutMs?: number): Promise<GptHealthResult>`
- **Request Payload**:
  - `prompt`: Text message sent to ChatGPT Free.
  - `session_id`: Session identifier for multi-turn continuity.
  - `timeout_ms`: Maximum execution duration per turn.
- **Response Payload**:
  - `text`: Complete textual content extracted from the ChatGPT turn.
  - `session_id`: Server/session identifier for multi-turn continuity.
  - `duration_ms`: Latency of the turn.
  - `status`: `'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'HUMAN_REQUIRED'`.

## 3. Interaction Flow with ClosedLoopEngine
```
           +--------------------+
           |  ClosedLoopEngine  |
           +---------+----------+
                     |
       +-------------+-------------+
       |                           |
       v                           v
+---------------+        +--------------------+
|  GptTransport |        | AntigravityBridge  |
+-------+-------+        +---------+----------+
        |                          |
        v (HTTP POST /v1/prompt)   v (JSON IPC stdio)
  [ACP-LAB:5125]               [agy.exe]
        |                          |
        v                          v
  [ChatGPT Free]          [Local File System]
```

## 4. Multi-Turn Contract
The provider HTTP layer is stateless. `session_id` is a logical ACP correlation identifier. ClosedLoopEngine includes prior runtime results in subsequent prompts, so browser-session persistence is not required.
1. Provider configuration is explicit through `GPT_BASE_URL`, `GPT_API_KEY`, and `GPT_MODEL`.
2. Health uses `GET /models`.
3. Execution uses `POST /chat/completions`.
4. Network, timeout, HTTP, malformed-response, and missing-model conditions map to structured transport errors.

A local gateway such as 9router is optional. ACP does not depend on it.
