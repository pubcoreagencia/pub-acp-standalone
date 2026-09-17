import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AntigravitySessionStore,
  normalizeWorkspacePathToUri,
  canonicalizeWorkspacePath
} from '../../src/antigravity/AntigravitySessionStore.js';

test('AntigravitySessionStore - Unit Suite', async (t) => {
  let tempDir: string;
  let tempDbPath: string;

  t.beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ag-session-store-test-'));
    tempDbPath = join(tempDir, 'test_summaries.db');

    // Create fixture SQLite DB simulating Antigravity's internal schema
    const db = new DatabaseSync(tempDbPath);
    db.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT "",
        preview TEXT NOT NULL DEFAULT "",
        step_count INTEGER NOT NULL DEFAULT 0,
        last_modified_time DATETIME NOT NULL,
        workspace_uris TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT ""
      );
    `);

    // Insert deterministic test conversations
    const insert = db.prepare(`
      INSERT INTO conversation_summaries 
        (conversation_id, title, preview, step_count, last_modified_time, workspace_uris, status)
      VALUES 
        (?, ?, ?, ?, ?, ?, ?)
    `);

    // Project A: 2 conversations
    insert.run(
      'conv-project-a-1',
      'Feature Auth',
      'Implementing auth token validation',
      42,
      '2026-09-16 10:00:00.000+00:00',
      JSON.stringify(['file:///c%3A/projects/project-a']),
      'CASCADE_RUN_STATUS_IDLE'
    );
    insert.run(
      'conv-project-a-2',
      'Bugfix Auth Headers',
      'Fixing auth header encoding',
      15,
      '2026-09-16 12:30:00.000+00:00',
      JSON.stringify(['file:///c%3A/projects/project-a']),
      'CASCADE_RUN_STATUS_RUNNING'
    );

    // Project B: 1 conversation
    insert.run(
      'conv-project-b-1',
      'Project B Setup',
      'Initial setup for project B',
      10,
      '2026-09-15 18:00:00.000+00:00',
      JSON.stringify(['file:///c%3A/projects/project-b']),
      'CASCADE_RUN_STATUS_IDLE'
    );

    db.close();
  });

  t.afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('1. Normalization: converts Windows paths to Antigravity URI format', () => {
    const uri = normalizeWorkspacePathToUri('C:\\projects\\project-a');
    assert.equal(uri, 'file:///c%3A/projects/project-a');
  });

  await t.test('2. Normalization: strips trailing slashes', () => {
    const uriWithSlash = normalizeWorkspacePathToUri('C:\\projects\\project-a\\');
    assert.equal(uriWithSlash, 'file:///c%3A/projects/project-a');
  });

  await t.test('3. listConversationsForWorkspace: lists and sorts by lastModifiedTime DESC', async () => {
    const store = new AntigravitySessionStore({ dbPath: tempDbPath });
    const convs = await store.listConversationsForWorkspace('C:\\projects\\project-a');

    assert.equal(convs.length, 2);
    // Most recent first: conv-project-a-2 (12:30) then conv-project-a-1 (10:00)
    assert.equal(convs[0].conversationId, 'conv-project-a-2');
    assert.equal(convs[0].title, 'Bugfix Auth Headers');
    assert.equal(convs[0].status, 'CASCADE_RUN_STATUS_RUNNING');
    assert.equal(convs[0].stepCount, 15);

    assert.equal(convs[1].conversationId, 'conv-project-a-1');
    assert.equal(convs[1].title, 'Feature Auth');
  });

  await t.test('4. listConversationsForWorkspace: returns empty array for workspace with no conversations', async () => {
    const store = new AntigravitySessionStore({ dbPath: tempDbPath });
    const convs = await store.listConversationsForWorkspace('C:\\projects\\unknown-project');
    assert.deepEqual(convs, []);
  });

  await t.test('5. getConversation: returns full summary for existing conversation ID', async () => {
    const store = new AntigravitySessionStore({ dbPath: tempDbPath });
    const conv = await store.getConversation('conv-project-b-1');

    assert.ok(conv);
    assert.equal(conv?.conversationId, 'conv-project-b-1');
    assert.equal(conv?.title, 'Project B Setup');
    assert.equal(conv?.stepCount, 10);
  });

  await t.test('6. getConversation: returns null for nonexistent conversation ID', async () => {
    const store = new AntigravitySessionStore({ dbPath: tempDbPath });
    const conv = await store.getConversation('non-existent-id');
    assert.equal(conv, null);
  });

  await t.test('7. belongsToWorkspace: returns true when conversation belongs to workspace', async () => {
    const store = new AntigravitySessionStore({ dbPath: tempDbPath });
    const belongs = await store.belongsToWorkspace('conv-project-a-1', 'C:\\projects\\project-a');
    assert.equal(belongs, true);
  });

  await t.test('8. belongsToWorkspace: returns false when conversation belongs to a different workspace', async () => {
    const store = new AntigravitySessionStore({ dbPath: tempDbPath });
    const belongs = await store.belongsToWorkspace('conv-project-a-1', 'C:\\projects\\project-b');
    assert.equal(belongs, false);
  });

  await t.test('9. belongsToWorkspace: returns false for nonexistent conversation or invalid path', async () => {
    const store = new AntigravitySessionStore({ dbPath: tempDbPath });
    assert.equal(await store.belongsToWorkspace('non-existent', 'C:\\projects\\project-a'), false);
    assert.equal(await store.belongsToWorkspace('conv-project-a-1', ''), false);
  });

  await t.test('10. Error handling: throws explicit error when database file does not exist', async () => {
    const store = new AntigravitySessionStore({ dbPath: join(tempDir, 'non_existent.db') });
    await assert.rejects(
      async () => {
        await store.listConversationsForWorkspace('C:\\projects\\project-a');
      },
      /Antigravity conversation database not found/
    );
  });

  // -------------------------------------------------------------
  // REQUIRED TEST A: CLI conversation valid (exists only in CLI DB)
  // -------------------------------------------------------------
  await t.test('Required A - CLI conversation valid (exists only in CLI DB)', async () => {
    const cliDbPath = join(tempDir, 'cli_summaries.db');
    const ideDbPath = join(tempDir, 'ide_summaries.db');

    const cliDb = new DatabaseSync(cliDbPath);
    cliDb.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT "",
        preview TEXT NOT NULL DEFAULT "",
        step_count INTEGER NOT NULL DEFAULT 0,
        last_modified_time DATETIME NOT NULL,
        workspace_uris TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT ""
      );
    `);
    cliDb.prepare(`
      INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'conv-cli-only-1',
      'CLI Status Check',
      'Preview check',
      5,
      '2026-09-17 01:00:00.000+00:00',
      JSON.stringify(['file:///C:/Users/Matheus%20Paes/Documents/ChatGPT/pub-acp-standalone']),
      'CASCADE_RUN_STATUS_IDLE'
    );
    cliDb.close();

    // IDE DB does NOT have this conversation
    const ideDb = new DatabaseSync(ideDbPath);
    ideDb.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT "",
        preview TEXT NOT NULL DEFAULT "",
        step_count INTEGER NOT NULL DEFAULT 0,
        last_modified_time DATETIME NOT NULL,
        workspace_uris TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT ""
      );
    `);
    ideDb.close();

    const store = new AntigravitySessionStore({ dbPaths: [cliDbPath, ideDbPath] });
    const conv = await store.getConversation('conv-cli-only-1');
    assert.ok(conv);
    assert.equal(conv?.conversationId, 'conv-cli-only-1');
    assert.equal(conv?.title, 'CLI Status Check');

    const belongs = await store.belongsToWorkspace(
      'conv-cli-only-1',
      'C:\\Users\\Matheus Paes\\Documents\\ChatGPT\\pub-acp-standalone'
    );
    assert.equal(belongs, true);
  });

  // -------------------------------------------------------------
  // REQUIRED TEST B: IDE conversation valid (exists only in IDE DB)
  // -------------------------------------------------------------
  await t.test('Required B - IDE conversation valid (exists only in IDE DB)', async () => {
    const cliDbPath = join(tempDir, 'cli_empty.db');
    const ideDbPath = join(tempDir, 'ide_only.db');

    const cliDb = new DatabaseSync(cliDbPath);
    cliDb.exec(`CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, preview TEXT, step_count INT, last_modified_time DATETIME, workspace_uris TEXT, status TEXT)`);
    cliDb.close();

    const ideDb = new DatabaseSync(ideDbPath);
    ideDb.exec(`CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, preview TEXT, step_count INT, last_modified_time DATETIME, workspace_uris TEXT, status TEXT)`);
    ideDb.prepare(`INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'conv-ide-only-1',
      'IDE Composer Session',
      'Preview IDE',
      12,
      '2026-09-17 01:00:00.000+00:00',
      JSON.stringify(['file:///c%3A/Users/Matheus%20Paes/Documents/ChatGPT/pub-acp-standalone']),
      'CASCADE_RUN_STATUS_IDLE'
    );
    ideDb.close();

    const store = new AntigravitySessionStore({ dbPaths: [cliDbPath, ideDbPath] });
    const conv = await store.getConversation('conv-ide-only-1');
    assert.ok(conv);
    assert.equal(conv?.conversationId, 'conv-ide-only-1');

    const belongs = await store.belongsToWorkspace(
      'conv-ide-only-1',
      'C:\\Users\\Matheus Paes\\Documents\\ChatGPT\\pub-acp-standalone'
    );
    assert.equal(belongs, true);
  });

  // -------------------------------------------------------------
  // REQUIRED TEST C: Incorrect workspace (belongsToWorkspace -> false)
  // -------------------------------------------------------------
  await t.test('Required C - Workspace incorrect returns false without calling AG', async () => {
    const store = new AntigravitySessionStore({ dbPath: tempDbPath });
    // conv-project-a-1 belongs to project-a, caller checks project-b
    const belongs = await store.belongsToWorkspace('conv-project-a-1', 'C:\\projects\\project-b');
    assert.equal(belongs, false);
  });

  // -------------------------------------------------------------
  // REQUIRED TEST D: Nonexistent conversation (null & false)
  // -------------------------------------------------------------
  await t.test('Required D - Nonexistent conversation returns null and false', async () => {
    const store = new AntigravitySessionStore({ dbPath: tempDbPath });
    assert.equal(await store.getConversation('uuid-never-seen'), null);
    assert.equal(await store.belongsToWorkspace('uuid-never-seen', 'C:\\projects\\project-a'), false);
  });

  // -------------------------------------------------------------
  // REQUIRED TEST E: URI encoding resilience (%3A, C:, %20, slash)
  // -------------------------------------------------------------
  await t.test('Required E - URI encoding resilience (%3A vs C:, %20, slashes)', async () => {
    const testDbPath = join(tempDir, 'encoding_test.db');
    const db = new DatabaseSync(testDbPath);
    db.exec(`CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, preview TEXT, step_count INT, last_modified_time DATETIME, workspace_uris TEXT, status TEXT)`);
    db.prepare(`INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'conv-enc-1',
      'Enc Test',
      '',
      1,
      '2026-09-17 01:00:00.000+00:00',
      JSON.stringify(['file:///c%3A/My%20Workspace/nested-dir']),
      'CASCADE_RUN_STATUS_IDLE'
    );
    db.prepare(`INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'conv-enc-2',
      'Enc Test 2',
      '',
      1,
      '2026-09-17 01:00:00.000+00:00',
      JSON.stringify(['file:///C:/My%20Workspace/nested-dir']),
      'CASCADE_RUN_STATUS_IDLE'
    );
    db.close();

    const store = new AntigravitySessionStore({ dbPath: testDbPath });

    // Test with Windows backslashes, mixed case drive, spaces
    assert.equal(await store.belongsToWorkspace('conv-enc-1', 'C:\\My Workspace\\nested-dir'), true);
    assert.equal(await store.belongsToWorkspace('conv-enc-1', 'c:\\my workspace\\nested-dir\\'), true);
    assert.equal(await store.belongsToWorkspace('conv-enc-2', 'C:\\My Workspace\\nested-dir'), true);
    assert.equal(await store.belongsToWorkspace('conv-enc-2', 'c:\\my workspace\\nested-dir'), true);
  });

  // -------------------------------------------------------------
  // REQUIRED TEST F: Same ID in both databases (no duplicates, deterministic)
  // -------------------------------------------------------------
  await t.test('Required F - Same ID in both databases produces deduplicated deterministic result', async () => {
    const cliDbPath = join(tempDir, 'cli_shared.db');
    const ideDbPath = join(tempDir, 'ide_shared.db');

    const cliDb = new DatabaseSync(cliDbPath);
    cliDb.exec(`CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, preview TEXT, step_count INT, last_modified_time DATETIME, workspace_uris TEXT, status TEXT)`);
    cliDb.prepare(`INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'shared-conv-id',
      'CLI Version',
      'CLI preview',
      5,
      '2026-09-17 02:00:00.000+00:00',
      JSON.stringify(['file:///C:/projects/shared']),
      'CASCADE_RUN_STATUS_IDLE'
    );
    cliDb.close();

    const ideDb = new DatabaseSync(ideDbPath);
    ideDb.exec(`CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, preview TEXT, step_count INT, last_modified_time DATETIME, workspace_uris TEXT, status TEXT)`);
    ideDb.prepare(`INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'shared-conv-id',
      'IDE Version',
      'IDE preview',
      3,
      '2026-09-17 01:00:00.000+00:00',
      JSON.stringify(['file:///c%3A/projects/shared']),
      'CASCADE_RUN_STATUS_IDLE'
    );
    ideDb.close();

    const store = new AntigravitySessionStore({ dbPaths: [cliDbPath, ideDbPath] });
    const list = await store.listConversationsForWorkspace('C:\\projects\\shared');
    assert.equal(list.length, 1, 'Must deduplicate same conversationId across databases');
    assert.equal(list[0].title, 'CLI Version', 'Priority 1 (CLI) title should prevail');

    const single = await store.getConversation('shared-conv-id');
    assert.ok(single);
    assert.equal(single?.title, 'CLI Version');
  });

  // -------------------------------------------------------------
  // REQUIRED TEST G: Error handling fail-closed (all databases unavailable)
  // -------------------------------------------------------------
  await t.test('Required G - All configured databases missing throws fail-closed error', async () => {
    const store = new AntigravitySessionStore({
      dbPaths: [join(tempDir, 'missing_1.db'), join(tempDir, 'missing_2.db')]
    });
    await assert.rejects(
      async () => {
        await store.listConversationsForWorkspace('C:\\projects\\any');
      },
      /Antigravity conversation database not found/
    );
    await assert.rejects(
      async () => {
        await store.getConversation('any-id');
      },
      /Antigravity conversation database not found/
    );
    // belongsToWorkspace fails closed to false
    assert.equal(await store.belongsToWorkspace('any-id', 'C:\\projects\\any'), false);
  });

  // -------------------------------------------------------------
  // SECURITY & PATH TRAVERSAL TESTS: Prefix mismatch & sibling isolation
  // -------------------------------------------------------------
  await t.test('Security - Strict canonical equality prevents prefix and sibling path traversal', async () => {
    const testDbPath = join(tempDir, 'traversal_sec.db');
    const db = new DatabaseSync(testDbPath);
    db.exec(`CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, preview TEXT, step_count INT, last_modified_time DATETIME, workspace_uris TEXT, status TEXT)`);
    db.prepare(`INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'conv-target',
      'Target Project',
      '',
      1,
      '2026-09-17 01:00:00.000+00:00',
      JSON.stringify(['file:///C:/projects/workspace-alpha']),
      'CASCADE_RUN_STATUS_IDLE'
    );
    db.close();

    const store = new AntigravitySessionStore({ dbPath: testDbPath });

    // 1. Sibling path with same prefix: workspace-alpha-evil must NOT match workspace-alpha
    assert.equal(await store.belongsToWorkspace('conv-target', 'C:\\projects\\workspace-alpha-evil'), false);

    // 2. Traversal attempt via relative segments
    assert.equal(await store.belongsToWorkspace('conv-target', 'C:\\projects\\workspace-alpha\\..\\other'), false);

    // 3. Parent directory must NOT match child workspace
    assert.equal(await store.belongsToWorkspace('conv-target', 'C:\\projects'), false);

    // 4. Subdirectory must NOT match parent workspace
    assert.equal(await store.belongsToWorkspace('conv-target', 'C:\\projects\\workspace-alpha\\subfolder'), false);

    // 5. Exact canonical path MUST match
    assert.equal(await store.belongsToWorkspace('conv-target', 'C:\\projects\\workspace-alpha'), true);
  });
});
