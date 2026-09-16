import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryProjectContextStore } from '../../src/context/MemoryProjectContextStore.js';
import { FileProjectContextStore } from '../../src/context/FileProjectContextStore.js';
import { ProjectContextError } from '../../src/context/errors.js';

test('ProjectContextStore - MemoryStore lifecycle: uninitialized, creation, version, updates, OCC, missing', async () => {
  const store = new MemoryProjectContextStore();

  // 1. Inexistente retorna null
  const initial = await store.getContext('proj-alpha');
  assert.equal(initial, null);

  // 2. Criação inicial com version = 1 e status ACTIVE
  const created = await store.createInitialContext('proj-alpha');
  assert.equal(created.projectId, 'proj-alpha');
  assert.equal(created.status, 'ACTIVE');
  assert.equal(created.contextVersion, 1);
  assert.deepEqual(created.constraints, []);
  assert.ok(created.createdAt);
  assert.ok(created.updatedAt);

  // 3. Leitura subsequente
  const fetched = await store.getContext('proj-alpha');
  assert.ok(fetched);
  assert.equal(fetched.projectId, 'proj-alpha');
  assert.equal(fetched.contextVersion, 1);

  // 4. Update correto incrementa versão
  const updated = await store.updateContext(
    'proj-alpha',
    curr => ({
      activeObjective: 'Construir módulo X',
      status: 'PAUSED'
    }),
    1
  );
  assert.equal(updated.contextVersion, 2);
  assert.equal(updated.activeObjective, 'Construir módulo X');
  assert.equal(updated.status, 'PAUSED');

  // 5. PAUSED blocks further updates
  await assert.rejects(
    async () => {
      await store.updateContext(
        'proj-alpha',
        curr => ({ activeObjective: 'Tentativa de mutar projeto pausado' }),
        2
      );
    },
    (err: any) => {
      assert.ok(err instanceof ProjectContextError);
      assert.equal(err.code, 'PROJECT_CONTEXT_PAUSED');
      return true;
    }
  );

  // Provar que nada foi alterado e versão continua 2
  const stillPaused = await store.getContext('proj-alpha');
  assert.equal(stillPaused?.contextVersion, 2);
  assert.equal(stillPaused?.activeObjective, 'Construir módulo X');

  // 6. OCC Conflict: tentar atualizar com expectedVersion desatualizada falha
  await assert.rejects(
    async () => {
      await store.updateContext(
        'proj-alpha',
        curr => ({ activeObjective: 'Conflito' }),
        1 // Esperado 2, passando 1
      );
    },
    (err: any) => {
      assert.ok(err instanceof ProjectContextError);
      assert.equal(err.code, 'PROJECT_CONTEXT_VERSION_CONFLICT');
      return true;
    }
  );

  // 7. Missing: se contexto foi inicializado e desaparece, falha com PROJECT_CONTEXT_MISSING (fail-closed)
  store._simulateMissingContext('proj-alpha');
  await assert.rejects(
    async () => {
      await store.getContext('proj-alpha');
    },
    (err: any) => {
      assert.ok(err instanceof ProjectContextError);
      assert.equal(err.code, 'PROJECT_CONTEXT_MISSING');
      return true;
    }
  );
});

test('ProjectContextStore - Path traversal and invalid project ID rejection', async () => {
  const store = new MemoryProjectContextStore();

  const dangerousIds = ['../escape', '..\\escape', 'foo/bar', 'foo\\bar', 'proj:test', 'proj*wild', ''];
  for (const badId of dangerousIds) {
    await assert.rejects(
      async () => {
        await store.createInitialContext(badId);
      },
      (err: any) => {
        assert.ok(err instanceof ProjectContextError);
        assert.equal(err.code, 'PROJECT_CONTEXT_INVALID_PATH');
        return true;
      }
    );
  }
});

test('ProjectContextStore - FileStore persistence, atomic writes, corruption detection, and schema validation', async () => {
  const testBaseDir = mkdtempSync(join(tmpdir(), 'acp-context-test-'));

  try {
    const fileStore = new FileProjectContextStore({ baseDataDir: testBaseDir });

    // 1. Inicializa projeto no disco
    const created = await fileStore.createInitialContext('file-proj');
    assert.equal(created.contextVersion, 1);
    assert.equal(created.status, 'ACTIVE');

    // 2. Verifica se arquivo existe no diretório correto
    const filePath = join(fileStore.getProjectsDir(), 'file-proj', 'context.json');
    assert.ok(fileStore.hasContext('file-proj'));

    // 3. Update atômico incrementa versão
    const updated = await fileStore.updateContext(
      'file-proj',
      curr => ({
        activeObjective: 'Persistência verificada',
        constraints: [{ id: 'c1', description: 'Regra estrita', enforcedSince: '2026-09-16' }]
      }),
      1
    );
    assert.equal(updated.contextVersion, 2);
    assert.equal(updated.constraints.length, 1);

    // 4. Nova instância do FileStore lê exatamente os dados persistidos do disco
    const freshStore = new FileProjectContextStore({ baseDataDir: testBaseDir });
    const loaded = await freshStore.getContext('file-proj');
    assert.ok(loaded);
    assert.equal(loaded.contextVersion, 2);
    assert.equal(loaded.activeObjective, 'Persistência verificada');

    // 5. Detecção de JSON corrompido falha closed
    writeFileSync(filePath, '{ invalid json content !!!', 'utf8');
    await assert.rejects(
      async () => {
        await freshStore.getContext('file-proj');
      },
      (err: any) => {
        assert.ok(err instanceof ProjectContextError);
        assert.equal(err.code, 'PROJECT_CONTEXT_CORRUPTED');
        return true;
      }
    );

    // 6. Detecção de projectId mismatch no conteúdo do arquivo
    writeFileSync(
      filePath,
      JSON.stringify({
        projectId: 'different-id',
        status: 'ACTIVE',
        constraints: [],
        contextVersion: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      'utf8'
    );
    await assert.rejects(
      async () => {
        await freshStore.getContext('file-proj');
      },
      (err: any) => {
        assert.ok(err instanceof ProjectContextError);
        assert.equal(err.code, 'PROJECT_CONTEXT_PROJECT_ID_MISMATCH');
        return true;
      }
    );
  } finally {
    try { rmSync(testBaseDir, { recursive: true, force: true }); } catch {}
  }
});
