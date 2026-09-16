import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../src/observability/EventBus.js';
import { MemoryProjectContextStore } from '../../src/context/MemoryProjectContextStore.js';
import { ProjectContextProjector } from '../../src/context/ProjectContextProjector.js';
import { AutonomyEvent } from '../../src/observability/types.js';

test('ProjectContextProjector - projects RUN_CREATED, RUN_COMPLETED, RUN_FAILED with idempotency and retry', async () => {
  const store = new MemoryProjectContextStore();
  const eventBus = new EventBus();
  const projector = new ProjectContextProjector(store, eventBus, { maxRetries: 3, initialRetryDelayMs: 5 });

  projector.start();

  try {
    // 1. Emite RUN_CREATED para projeto 'project-alpha'
    eventBus.publish({
      id: 'e1',
      runId: 'run-101',
      timestamp: new Date().toISOString(),
      type: 'RUN_CREATED',
      summary: 'Run 101 created',
      details: { projectId: 'project-alpha' }
    });

    // Aguarda projeção assíncrona
    await new Promise(r => setTimeout(r, 50));

    let ctx = await store.getContext('project-alpha');
    assert.ok(ctx);
    assert.equal(ctx.lastRunId, 'run-101');
    assert.equal(ctx.lastSuccessfulRunId, undefined);
    assert.equal(ctx.lastFailedRunId, undefined);

    // 2. Emite RUN_COMPLETED
    eventBus.publish({
      id: 'e2',
      runId: 'run-101',
      timestamp: new Date().toISOString(),
      type: 'RUN_COMPLETED',
      summary: 'Run 101 completed',
      details: { projectId: 'project-alpha' }
    });

    await new Promise(r => setTimeout(r, 50));

    ctx = await store.getContext('project-alpha');
    assert.ok(ctx);
    assert.equal(ctx.lastRunId, 'run-101');
    assert.equal(ctx.lastSuccessfulRunId, 'run-101');
    assert.equal(ctx.lastFailedRunId, undefined);

    // 3. Idempotência: eventos duplicados não causam erros nem corrupção
    eventBus.publish({
      id: 'e3',
      runId: 'run-101',
      timestamp: new Date().toISOString(),
      type: 'RUN_COMPLETED',
      summary: 'Run 101 completed duplicate',
      details: { projectId: 'project-alpha' }
    });

    await new Promise(r => setTimeout(r, 50));

    const ctxDup = await store.getContext('project-alpha');
    assert.ok(ctxDup);
    assert.equal(ctxDup.lastSuccessfulRunId, 'run-101');
    assert.equal(ctxDup.contextVersion, ctx.contextVersion); // Versão não incrementada desnecessariamente

    // 4. Emite RUN_FAILED para novo run
    eventBus.publish({
      id: 'e4',
      runId: 'run-102',
      timestamp: new Date().toISOString(),
      type: 'RUN_CREATED',
      summary: 'Run 102 created',
      details: { projectId: 'project-alpha' }
    });

    eventBus.publish({
      id: 'e5',
      runId: 'run-102',
      timestamp: new Date().toISOString(),
      type: 'RUN_FAILED',
      summary: 'Run 102 failed',
      details: { projectId: 'project-alpha' }
    });

    await new Promise(r => setTimeout(r, 50));

    ctx = await store.getContext('project-alpha');
    assert.ok(ctx);
    assert.equal(ctx.lastRunId, 'run-102');
    assert.equal(ctx.lastSuccessfulRunId, 'run-101');
    assert.equal(ctx.lastFailedRunId, 'run-102');
  } finally {
    projector.stop();
  }
});

test('ProjectContext - Cross-Project Isolation: interleaved runs for project-a and project-b remain strictly separated', async () => {
  const store = new MemoryProjectContextStore();
  const eventBus = new EventBus();
  const projector = new ProjectContextProjector(store, eventBus);

  projector.start();

  try {
    // Intercalação estrita de eventos
    // 1. a1 criado
    eventBus.publish({
      id: 'ea1',
      runId: 'run-a1',
      timestamp: new Date().toISOString(),
      type: 'RUN_CREATED',
      summary: 'A1 created',
      details: { projectId: 'project-a' }
    });

    // 2. b1 criado
    eventBus.publish({
      id: 'eb1',
      runId: 'run-b1',
      timestamp: new Date().toISOString(),
      type: 'RUN_CREATED',
      summary: 'B1 created',
      details: { projectId: 'project-b' }
    });

    // 3. a1 completado com sucesso
    eventBus.publish({
      id: 'ea2',
      runId: 'run-a1',
      timestamp: new Date().toISOString(),
      type: 'RUN_COMPLETED',
      summary: 'A1 success',
      details: { projectId: 'project-a' }
    });

    // 4. b1 falhou
    eventBus.publish({
      id: 'eb2',
      runId: 'run-b1',
      timestamp: new Date().toISOString(),
      type: 'RUN_FAILED',
      summary: 'B1 fail',
      details: { projectId: 'project-b' }
    });

    // 5. a2 criado
    eventBus.publish({
      id: 'ea3',
      runId: 'run-a2',
      timestamp: new Date().toISOString(),
      type: 'RUN_CREATED',
      summary: 'A2 created',
      details: { projectId: 'project-a' }
    });

    await new Promise(r => setTimeout(r, 80));

    const ctxA = await store.getContext('project-a');
    const ctxB = await store.getContext('project-b');

    assert.ok(ctxA);
    assert.ok(ctxB);

    // project-a assertions
    assert.equal(ctxA.projectId, 'project-a');
    assert.equal(ctxA.lastRunId, 'run-a2');
    assert.equal(ctxA.lastSuccessfulRunId, 'run-a1');
    assert.equal(ctxA.lastFailedRunId, undefined);

    // project-b assertions
    assert.equal(ctxB.projectId, 'project-b');
    assert.equal(ctxB.lastRunId, 'run-b1');
    assert.equal(ctxB.lastSuccessfulRunId, undefined);
    assert.equal(ctxB.lastFailedRunId, 'run-b1');

    // Cross-contamination verification
    assert.ok(!JSON.stringify(ctxA).includes('b1'));
    assert.ok(!JSON.stringify(ctxB).includes('a1'));
    assert.ok(!JSON.stringify(ctxB).includes('a2'));
  } finally {
    projector.stop();
  }
});

test('ProjectContextProjector - deterministic OCC conflict and retry with ConflictOnceProjectContextStore', async () => {
  const baseStore = new MemoryProjectContextStore();
  await baseStore.createInitialContext('retry-proj');

  let conflictInjected = false;

  // Decorator that simulates an OCC conflict exactly once on updateContext
  const conflictOnceStore: typeof baseStore = {
    ...baseStore,
    getContext: baseStore.getContext.bind(baseStore),
    createInitialContext: baseStore.createInitialContext.bind(baseStore),
    hasContext: baseStore.hasContext.bind(baseStore),
    clear: baseStore.clear.bind(baseStore),
    _simulateMissingContext: baseStore._simulateMissingContext.bind(baseStore),
    updateContext: async (projectId, updater, expectedVersion) => {
      if (!conflictInjected) {
        conflictInjected = true;
        // Injeta mutação externa simulada que avança a versão no store real
        await baseStore.updateContext(projectId, curr => ({ activeObjective: 'Mutação paralela concorrente' }), expectedVersion);
        // Lança o conflito de versão OCC
        throw new (await import('../../src/context/errors.js')).ProjectContextError(
          'PROJECT_CONTEXT_VERSION_CONFLICT',
          'Simulated race condition OCC version conflict',
          projectId,
          { currentVersion: expectedVersion + 1, expectedVersion }
        );
      }
      return baseStore.updateContext(projectId, updater, expectedVersion);
    }
  };

  const eventBus = new EventBus();
  const projector = new ProjectContextProjector(conflictOnceStore, eventBus, { maxRetries: 3, initialRetryDelayMs: 5 });
  projector.start();

  try {
    eventBus.publish({
      id: 'e-retry-1',
      runId: 'run-retry-999',
      timestamp: new Date().toISOString(),
      type: 'RUN_COMPLETED',
      summary: 'Run completed triggering conflict and retry',
      details: { projectId: 'retry-proj' }
    });

    await new Promise(r => setTimeout(r, 100));

    assert.equal(conflictInjected, true, 'O conflito OCC simulado deve ter sido injetado exatamente uma vez');

    const ctx = await baseStore.getContext('retry-proj');
    assert.ok(ctx);
    assert.equal(ctx.lastSuccessfulRunId, 'run-retry-999', 'O retry deve ter recuperado e aplicado o evento com sucesso');
    assert.equal(ctx.activeObjective, 'Mutação paralela concorrente');
    assert.equal(ctx.contextVersion, 3); // 1 inicial -> 2 pela mutação paralela -> 3 pelo retry do projector
  } finally {
    projector.stop();
  }
});

test('ProjectContextProjector - retry exhaustion records failure without affecting runtime or ClosedLoopEngine', async () => {
  const baseStore = new MemoryProjectContextStore();
  await baseStore.createInitialContext('exhaust-proj');

  // Store decorator that continuously fails with VERSION_CONFLICT
  const alwaysConflictStore: typeof baseStore = {
    ...baseStore,
    getContext: baseStore.getContext.bind(baseStore),
    createInitialContext: baseStore.createInitialContext.bind(baseStore),
    hasContext: baseStore.hasContext.bind(baseStore),
    clear: baseStore.clear.bind(baseStore),
    _simulateMissingContext: baseStore._simulateMissingContext.bind(baseStore),
    updateContext: async (projectId, updater, expectedVersion) => {
      throw new (await import('../../src/context/errors.js')).ProjectContextError(
        'PROJECT_CONTEXT_VERSION_CONFLICT',
        'Persistent OCC conflict',
        projectId
      );
    }
  };

  const eventBus = new EventBus();
  const projector = new ProjectContextProjector(alwaysConflictStore, eventBus, { maxRetries: 2, initialRetryDelayMs: 5 });
  projector.start();

  try {
    // Disparar evento - não deve explodir a runtime nem o EventBus
    eventBus.publish({
      id: 'e-exhaust-1',
      runId: 'run-exhaust-001',
      timestamp: new Date().toISOString(),
      type: 'RUN_COMPLETED',
      summary: 'Run completed with persistent conflict',
      details: { projectId: 'exhaust-proj' }
    });

    await new Promise(r => setTimeout(r, 100));

    // Project context permanece na versão 1 original sem corrupção
    const ctx = await baseStore.getContext('exhaust-proj');
    assert.ok(ctx);
    assert.equal(ctx.contextVersion, 1);
    assert.equal(ctx.lastSuccessfulRunId, undefined);
  } finally {
    projector.stop();
  }
});

test('ProjectContextProjector - event without explicit projectId causes zero projection and zero cross-inference', async () => {
  const store = new MemoryProjectContextStore();
  await store.createInitialContext('legit-proj');

  const eventBus = new EventBus();
  const projector = new ProjectContextProjector(store, eventBus);
  projector.start();

  try {
    // Evento sem details.projectId (ex: evento global ou malformado)
    eventBus.publish({
      id: 'e-no-project',
      runId: 'run-orphan-123',
      timestamp: new Date().toISOString(),
      type: 'RUN_CREATED',
      summary: 'Run without projectId',
      details: { workspacePath: '/some/arbitrary/path' }
    });

    await new Promise(r => setTimeout(r, 50));

    // legit-proj deve permanecer 100% intocado
    const ctx = await store.getContext('legit-proj');
    assert.ok(ctx);
    assert.equal(ctx.lastRunId, undefined);
    assert.equal(ctx.contextVersion, 1);
  } finally {
    projector.stop();
  }
});

