# PUB ACP — GPT Runtime Architecture

## 1. Canonical operating model

PUB ACP is a decoupled control plane. The **active execution path is GPT-only**.

The current production-like path is:

```text
GPT
 ↓
PUB ACP
 ↓
Discovery
 ↓
Workspace Resolver
 ↓
Safety Gate
 ↓
Execution Context
 ↓
ClosedLoopEngine
 ↓
GptRuntimeAdapter
 ↓
Workspace Command Executor
 ↓
Authorized Workspace
```

The current runtime is `gpt-runtime`. Antigravity-specific components remain in the repository as legacy compatibility and historical test material, but **Antigravity is not part of the active execution path**.

## 2. Core responsibilities

The ACP Core owns:

1. **Governance & authorization** through the project catalog.
2. **Workspace isolation** through canonicalization, resolver checks, SafetyGate, and WorkspaceLock.
3. **Project discovery** through DiscoveryOrchestrator and discovery providers.
4. **Closed-loop execution** through ClosedLoopEngine.
5. **Observability** through EventBus, RunStore, and Control Room/SSE.
6. **Runtime abstraction** through `IAgentRuntime` and the GPT adapter.

Discovery is never authorization:

```text
DISCOVERY → candidate
CATALOG   → authorization
SAFETY    → execution boundary
RUNTIME   → execution
```

## 3. Identity model

| Identity | Meaning |
|---|---|
| Repository | Logical Git repository identity |
| Workspace | Canonical physical checkout path |
| Project | ACP authorization/governance unit |
| Runtime | Execution engine registered in ACP |
| Agent | Logical model/persona used by a runtime |
| Provider | Technology provider |
| Account | Credential/quota context |
| Session | Conversation/session state |

Two physical workspaces may share the same repository identity. Authorization and locks remain bound to the physical Project/Workspace.

## 4. Execution contracts

Every runtime implements `IAgentRuntime`:

```ts
export interface IAgentRuntime {
  readonly id: string;
  readonly provider: string;
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

The active implementation is:

- runtime id: `gpt-runtime`
- provider: `openai-chatgpt`
- adapter: `src/runtime/gpt/GptRuntimeAdapter.ts`
- command bridge: `src/runtime/execution/WorkspaceCommandExecutor.ts`

## 5. Runtime registry and router

`AgentRuntimeRegistry` and `AgentRuntimeRouter` are **generic infrastructure**, not the current execution path.

The current `ClosedLoopEngine` receives an `IAgentRuntime` directly and defaults to `GptRuntimeAdapter`.

Therefore:

```text
Current:
ClosedLoopEngine → GptRuntimeAdapter

Future:
ClosedLoopEngine → RuntimeRouter → selected IAgentRuntime
```

No claim should be made that the router currently selects the active runtime.

## 6. GPT execution protocol

GPT is used as the execution planner. The adapter accepts exactly one JSON action:

```json
{"action":"shell","command":"<single command>"}
```

or:

```json
{"action":"complete","message":"<task complete>"}
```

or:

```json
{"action":"fail","message":"<cannot continue>"}
```

The ACP executes `shell` actions from the authorized workspace.

The protocol is intentionally small:

```text
GPT decision
   ↓
validate action
   ↓
workspace command boundary
   ↓
execute
   ↓
capture output
   ↓
return result
```

## 7. Workspace execution boundary

`WorkspaceCommandExecutor` always starts child processes with the resolved workspace as their working directory.

The executor also rejects explicit shell-level escape patterns such as:

- directory changes outside the workspace (`cd`, `pushd`, `Set-Location`)
- Windows drive-absolute and UNC paths
- POSIX absolute paths
- parent traversal paths such as `..\\` and `../`

This is **defense in depth, not a full OS sandbox**.

A shell can invoke arbitrary programs, and those programs may themselves access the filesystem. Full arbitrary-command isolation requires an operating-system/container sandbox and is outside this V0 boundary.

The invariant for V0 is therefore:

> The ACP refuses explicit command forms whose path semantics clearly request execution or file access outside the authorized workspace.

## 8. Validation semantics

Validation is independent from execution success:

```text
RUNTIME COMPLETED
      ↓
PROJECT VALIDATOR
      ↓
PASS → continue
FAIL + turns remaining → CORRECTION → GPT
FAIL + no turns → RUN_FAILED
```

`OPTIONAL` validation records warnings without blocking.

`REQUIRED` validation can block completion.

`RUN_COMPLETED` must never be interpreted as `VALIDATION_PASSED`.

## 9. Discovery architecture

Discovery is a bounded, fail-soft subsystem.

Providers currently include filesystem and Git discovery. Discovery guarantees:

- bounded roots
- maximum depth/candidate limits
- cancellation/global timeout
- canonical workspace paths
- deterministic sorting
- deduplication by canonical workspace path
- separation of repository identity from workspace identity
- zero authorization side effects

The Discovery package must remain independent from Catalog and ProjectRegistry.

## 10. Control Room

Control Room is observability, not execution.

```text
ClosedLoopEngine
       ↓
    EventBus
       ↓
    RunStore
       ↓
       SSE
       ↓
 Control Room UI
```

The UI must consume execution state and telemetry. It does not become an alternate execution engine.

## 11. Legacy Antigravity material

The repository still contains Antigravity-oriented adapters, session stores, and historical tests.

These are retained for compatibility/history during the migration.

They are **not the active runtime**.

The active architecture must not depend on:

- Antigravity sessions
- Antigravity bridge execution
- Antigravity ACP-LAB
- copy/paste between GPT and another coding agent

A live Antigravity ACP-LAB endpoint is therefore not required for the GPT-only unit/contract/integration baseline.

## 12. Current proof boundary

The validated local baseline for the current branch is:

```text
Unit       141 PASS
Contract    25 PASS
Integration  9 PASS / 2 SKIP
E2E         1 PASS / 3 SKIP
Build       PASS
```

The integration/E2E skips are live-infrastructure checks for ACP-LAB/GPT endpoints and are not code failures.

## 13. Next hardening direction

The next security boundary after explicit command rejection is a true OS-level sandbox/container policy.

That future layer should enforce filesystem and process restrictions independently of GPT prompt compliance.

Until then, the ACP should treat GPT-provided shell commands as untrusted input and preserve fail-closed workspace authorization at every dispatch boundary.
