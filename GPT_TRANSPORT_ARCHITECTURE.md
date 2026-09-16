# GPT Transport Architecture — PUB-ACP-STANDALONE

## 1. Overview
The GPT Transport in `pub-acp-standalone` (`src/gpt/GptTransport.ts`) acts as the client-side adapter communicating with the local ACP-LAB HTTP daemon (`http://127.0.0.1:5125`). It strictly isolates the standalone framework from direct browser/CDP drivers and exposes a standard programmatic interface for prompt dispatch, response reception, multi-turn session continuation, and health checking.

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

## 4. Multi-Turn Reliability Resolution
In Phase 4, the multi-turn bottleneck in ACP-LAB's browser driver was permanently resolved:
1. **CDP Input Event Sync**: Verifies send button readiness after text insertion with synthetic event dispatch (`Input.insertText` / backspace) to update React internal state.
2. **Dual-Layer Completion Detection**: Replaced brittle copy button selectors with combined checks on streaming state, active stop buttons, and text stabilization.
3. **Stall Recovery**: Automatic reload recovery when streaming pulses enter suspended idle states, allowing server-side finalized answers to render.
4. **Proactive Modal Dismissal**: Dismisses feedback surveys ("Esta conversa foi útil?") and dialog overlays before interaction.
