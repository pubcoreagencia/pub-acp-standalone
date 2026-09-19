# VERIFIED GPT-ONLY ACP RUNTIME — 2026-09-19

**Repository:** pubcoreagencia/pub-acp-standalone
**Branch:** fix/gpt-runtime-correction-loop
**Runtime mode:** GPT-only
**Status:** VALIDATED
**Confidence:** HIGH

## 1. Canonical validated path

```text
ChatGPT Free
    ↓
Chrome / CDP :9555
    ↓
PUB-ACP-POC local transport :5127
    ↓
pub-acp-standalone
    ↓
GptRuntimeAdapter
    ↓
ClosedLoopEngine
    ↓
authorized workspace
```

Antigravity is not part of the active execution path represented by this checkpoint. Historical compatibility code may remain in the repository but is not an active runtime dependency for this proof.

## 2. Runtime proof

Two isolated real transport requests were verified:

```text
TESTE_ACP_1 → TESTE_ACP_1
TESTE_ACP_2 → TESTE_ACP_2
```

The responses were distinct and the sessions returned by those independent requests were distinct.

The physical correction-loop proof then demonstrated:

```text
TURN 1 → shell failure
TURN 2 → shell failure
       ↓
    CORRECTION
       ↓
TURN 4 → successful execution
TURN 5 → [[ACP_COMPLETE]]
```

This validates that a runtime execution failure can return diagnostics to GPT and continue within the configured turn budget.

## 3. Residual transport concurrency incident

An earlier E2E execution was blocked by:

```text
Transport is currently processing another request
(standalone-e2e-session-...)
```

The local transport reported residual pending sessions. A clean restart of the resident transport cleared the state.

After restart, the isolated tests returned their expected distinct responses and the same concurrency block did not recur during the successful physical E2E run.

Important interpretation: this checkpoint does not establish a deterministic stale-response defect in GptTransport. The observed blocking condition was residual concurrent transport state.

## 4. Runtime security contract

Shell execution remains fail-closed for:

```text
absolute filesystem paths
UNC paths
Windows drive paths
POSIX absolute paths
parent traversal
cd / chdir / pushd / Set-Location
git -C
--work-tree
```

The GPT planning contract was updated to emit workspace-relative commands only. The security barrier itself was not relaxed.

## 5. Correction-loop behavior

ClosedLoopEngine no longer treats every runtime execution failure as immediately terminal when turns remain.

Current behavior:

```text
runtime failure
    ↓
record diagnostics
    ↓
emit CORRECTION
    ↓
next GPT turn receives failure context
    ↓
corrected action
```

Unit tests cover both the workspace-relative contract and runtime-failure recovery.

## 6. Verification checkpoint

At the validated checkpoint:

- `npm test`: 148 pass / 0 fail in the unit suite; contract suite 25 pass.
- integration and live E2E tests that require a live transport are skipped when the transport is offline rather than treated as ordinary code failures.
- `npm run build`: PASS.
- branch: `fix/gpt-runtime-correction-loop`.

## 7. Completion semantics

An agent completion signal is not sufficient evidence of project completion.

```text
GPT says complete
       ≠
task proven complete
```

Completion should be corroborated by repository state, required tests, build and task-specific acceptance criteria. This principle was demonstrated by the PUB MACHINE experiment, where an early completion signal occurred before the target workspace had been materially changed.

## 8. Source-of-truth boundaries

```text
pub-acp-standalone
    = ACP orchestration / execution contract

PUB-ACP-POC
    = local GPT Free browser transport implementation

target project workspace
    = authority for project implementation

PUB Neural
    = institutional memory / consolidated knowledge
```

## 9. Promotion status

This runtime proof is validated project evidence.

It should not be interpreted as proof of a production SaaS transport, nor as authorization to bypass the project's governed workspace and security boundaries.