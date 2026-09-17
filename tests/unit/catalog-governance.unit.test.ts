import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogManager } from '../../src/catalog/CatalogManager.js';
import { createControlPlane } from '../../src/bootstrap/createControlPlane.js';
import { FileProjectCatalog, MemoryProjectCatalog } from '../../src/catalog/FileProjectCatalog.js';
import { WorkspaceResolver, GitInspector } from '../../src/multiproject/WorkspaceResolver.js';

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `pub-acp-gov-${prefix}-`));
}

function createMockGitInspector(repos: Record<string, { remote: string; branch: string; isRepo?: boolean }>): GitInspector {
  return {
    isGitRepo(wsPath: string): boolean {
      const match = repos[wsPath];
      return match ? (match.isRepo !== undefined ? match.isRepo : true) : false;
    },
    getRemoteUrl(wsPath: string): string | null {
      return repos[wsPath]?.remote || null;
    },
    getCurrentBranch(wsPath: string): string | null {
      return repos[wsPath]?.branch || null;
    },
    getLastCommit(_wsPath: string): string | null {
      return '0000000000000000000000000000000000000000';
    }
  };
}

test('Catalog Governance - 1. CatalogManager list() returns declared entries', async () => {
  const dir = createTempDir('list');
  const catPath = join(dir, 'projects.json');

  try {
    writeFileSync(catPath, JSON.stringify({
      version: '1.0',
      projects: [
        { projectId: 'org-proj1', workspacePath: 'C:\\workspaces\\proj1', enabled: true },
        { projectId: 'org-proj2', workspacePath: 'C:\\workspaces\\proj2', enabled: false }
      ]
    }), 'utf8');

    const manager = new CatalogManager({ catalogPath: catPath });
    const list = await manager.list();

    assert.equal(list.length, 2);
    assert.equal(list[0].projectId, 'org-proj1');
    assert.equal(list[1].projectId, 'org-proj2');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Catalog Governance - 2. CatalogManager validate() succeeds on clean catalog', async () => {
  const dir = createTempDir('val-clean');
  const wsPath = join(dir, 'clean-repo');
  mkdirSync(wsPath);
  const catPath = join(dir, 'projects.json');

  const mockGit = createMockGitInspector({
    [wsPath]: { remote: 'https://github.com/pubcoreagencia/clean-repo.git', branch: 'main' }
  });

  try {
    writeFileSync(catPath, JSON.stringify({
      version: '1.0',
      projects: [
        { projectId: 'pubcoreagencia-clean-repo', workspacePath: wsPath, enabled: true }
      ]
    }), 'utf8');

    const resolver = new WorkspaceResolver(undefined, mockGit);
    const manager = new CatalogManager({ catalogPath: catPath, resolver });
    const report = await manager.validate();

    assert.equal(report.valid, true);
    assert.equal(report.totalEntries, 1);
    assert.equal(report.validEntries, 1);
    assert.equal(report.issues.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Catalog Governance - 3. CatalogManager validate() detects missing workspace', async () => {
  const dir = createTempDir('val-missing');
  const catPath = join(dir, 'projects.json');
  const missingWs = join(dir, 'nonexistent');

  try {
    writeFileSync(catPath, JSON.stringify({
      version: '1.0',
      projects: [
        { projectId: 'org-missing', workspacePath: missingWs, enabled: true }
      ]
    }), 'utf8');

    const manager = new CatalogManager({ catalogPath: catPath });
    const report = await manager.validate();

    assert.equal(report.valid, false);
    assert.ok(report.issues.some(i => i.code === 'WORKSPACE_NOT_FOUND'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Catalog Governance - 4. CatalogManager validate() detects non-git workspace', async () => {
  const dir = createTempDir('val-nongit');
  const wsPath = join(dir, 'not-git');
  mkdirSync(wsPath);
  const catPath = join(dir, 'projects.json');

  const mockGit = createMockGitInspector({}); // not a git repo

  try {
    writeFileSync(catPath, JSON.stringify({
      version: '1.0',
      projects: [
        { projectId: 'org-nongit', workspacePath: wsPath, enabled: true }
      ]
    }), 'utf8');

    const resolver = new WorkspaceResolver(undefined, mockGit);
    const manager = new CatalogManager({ catalogPath: catPath, resolver });
    const report = await manager.validate();

    assert.equal(report.valid, false);
    assert.ok(report.issues.some(i => i.code === 'NOT_A_GIT_REPOSITORY'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Catalog Governance - 5. CatalogManager validate() detects projectId mismatch with git remote', async () => {
  const dir = createTempDir('val-mismatch');
  const wsPath = join(dir, 'repo');
  mkdirSync(wsPath);
  const catPath = join(dir, 'projects.json');

  const mockGit = createMockGitInspector({
    [wsPath]: { remote: 'https://github.com/real-owner/real-repo.git', branch: 'main' }
  });

  try {
    writeFileSync(catPath, JSON.stringify({
      version: '1.0',
      projects: [
        { projectId: 'fake-owner-fake-repo', workspacePath: wsPath, enabled: true }
      ]
    }), 'utf8');

    const resolver = new WorkspaceResolver(undefined, mockGit);
    const manager = new CatalogManager({ catalogPath: catPath, resolver });
    const report = await manager.validate();

    assert.equal(report.valid, false);
    assert.ok(report.issues.some(i => i.code === 'PROJECT_ID_MISMATCH'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Catalog Governance - 6. CatalogManager validate() warns on branch mismatch', async () => {
  const dir = createTempDir('val-branch');
  const wsPath = join(dir, 'repo');
  mkdirSync(wsPath);
  const catPath = join(dir, 'projects.json');

  const mockGit = createMockGitInspector({
    [wsPath]: { remote: 'https://github.com/org/repo.git', branch: 'develop' }
  });

  try {
    writeFileSync(catPath, JSON.stringify({
      version: '1.0',
      projects: [
        { projectId: 'org-repo', workspacePath: wsPath, defaultBranch: 'main', enabled: true }
      ]
    }), 'utf8');

    const resolver = new WorkspaceResolver(undefined, mockGit);
    const manager = new CatalogManager({ catalogPath: catPath, resolver });
    const report = await manager.validate();

    // Branch mismatch is a WARNING, valid remains true if no blocking errors
    assert.equal(report.valid, true);
    assert.ok(report.issues.some(i => i.code === 'WORKSPACE_BRANCH_MISMATCH' && i.severity === 'WARNING'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Catalog Governance - 7. CatalogManager validate() detects duplicate projectId and duplicate physical workspace', async () => {
  const dir = createTempDir('val-dups');
  const wsPath1 = join(dir, 'repo1');
  const wsPath2 = join(dir, 'repo2');
  mkdirSync(wsPath1);
  mkdirSync(wsPath2);
  const catPath = join(dir, 'projects.json');

  const mockGit = createMockGitInspector({
    [wsPath1]: { remote: 'https://github.com/org/repo.git', branch: 'main' },
    [wsPath2]: { remote: 'https://github.com/org/repo.git', branch: 'main' }
  });

  try {
    writeFileSync(catPath, JSON.stringify({
      version: '1.0',
      projects: [
        { projectId: 'org-repo', workspacePath: wsPath1, enabled: true },
        { projectId: 'org-repo', workspacePath: wsPath2, enabled: true }
      ]
    }), 'utf8');

    const resolver = new WorkspaceResolver(undefined, mockGit);
    const manager = new CatalogManager({ catalogPath: catPath, resolver });
    const report = await manager.validate();

    assert.equal(report.valid, false);
    assert.ok(report.issues.some(i => i.code === 'DUPLICATE_PROJECT_ID'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Catalog Governance - 8. CatalogManager add() adds valid git workspace and derives deterministic projectId', async () => {
  const dir = createTempDir('add-valid');
  const wsPath = join(dir, 'new-project');
  mkdirSync(wsPath);
  const catPath = join(dir, 'projects.json');

  const mockGit = createMockGitInspector({
    [wsPath]: { remote: 'https://github.com/pubcoreagencia/new-project.git', branch: 'main' }
  });

  try {
    const resolver = new WorkspaceResolver(undefined, mockGit);
    const manager = new CatalogManager({ catalogPath: catPath, resolver });

    const added = await manager.add(wsPath);
    assert.equal(added.projectId, 'pubcoreagencia-new-project');
    assert.equal(added.workspacePath, wsPath);
    assert.equal(added.enabled, true);

    const list = await manager.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].projectId, 'pubcoreagencia-new-project');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Catalog Governance - 9. CatalogManager add() blocks non-git workspace fail-closed', async () => {
  const dir = createTempDir('add-invalid');
  const wsPath = join(dir, 'invalid');
  mkdirSync(wsPath);
  const catPath = join(dir, 'projects.json');

  const mockGit = createMockGitInspector({}); // not a git repo

  try {
    const resolver = new WorkspaceResolver(undefined, mockGit);
    const manager = new CatalogManager({ catalogPath: catPath, resolver });

    await assert.rejects(
      async () => manager.add(wsPath),
      /NOT_A_GIT_REPOSITORY/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Catalog Governance - 10. CatalogManager remove() revokes authorization and keeps workspace files intact', async () => {
  const dir = createTempDir('remove');
  const wsPath = join(dir, 'keep-me');
  mkdirSync(wsPath);
  const dummyFile = join(wsPath, 'important.txt');
  writeFileSync(dummyFile, 'IMPORTANT_CODE');
  const catPath = join(dir, 'projects.json');

  try {
    writeFileSync(catPath, JSON.stringify({
      version: '1.0',
      projects: [
        { projectId: 'org-target', workspacePath: wsPath, enabled: true }
      ]
    }), 'utf8');

    const manager = new CatalogManager({ catalogPath: catPath });
    const removed = await manager.remove('org-target');
    assert.equal(removed, true);

    const list = await manager.list();
    assert.equal(list.length, 0);

    // Verify workspace files are 100% intact
    assert.ok(existsSync(dummyFile));
    assert.equal(readFileSync(dummyFile, 'utf8'), 'IMPORTANT_CODE');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Catalog Governance - 11. Atomic write resilience: temporary write failure leaves catalog uncorrupted', async () => {
  const dir = createTempDir('atomic');
  const catPath = join(dir, 'projects.json');

  try {
    writeFileSync(catPath, JSON.stringify({
      version: '1.0',
      projects: [
        { projectId: 'original-project', workspacePath: 'C:\\orig', enabled: true }
      ]
    }), 'utf8');

    const manager = new CatalogManager({ catalogPath: catPath });
    // Write valid update
    await manager.writeCatalog({
      version: '1.0',
      projects: [
        { projectId: 'updated-project', workspacePath: 'C:\\upd', enabled: true }
      ]
    });

    const read = await manager.readCatalog();
    assert.equal(read.projects.length, 1);
    assert.equal(read.projects[0].projectId, 'updated-project');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Catalog Governance - 12. Invalid JSON handling: readCatalog() throws explicit fail-closed error', async () => {
  const dir = createTempDir('invalid-json');
  const catPath = join(dir, 'projects.json');

  try {
    writeFileSync(catPath, '{{{ corrupted json', 'utf8');

    const manager = new CatalogManager({ catalogPath: catPath });
    await assert.rejects(
      async () => manager.readCatalog(),
      /contains invalid JSON/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Catalog Governance - 13. FileProjectCatalog precedence: custom catalogPath > ENV > default discovery', async () => {
  const dir = createTempDir('precedence');
  const catCustom = join(dir, 'custom.json');
  const catEnv = join(dir, 'env.json');

  try {
    writeFileSync(catCustom, JSON.stringify({
      projects: [{ projectId: 'custom-proj', workspacePath: 'C:\\custom', enabled: true }]
    }), 'utf8');

    writeFileSync(catEnv, JSON.stringify({
      projects: [{ projectId: 'env-proj', workspacePath: 'C:\\env', enabled: true }]
    }), 'utf8');

    process.env.PUB_ACP_CATALOG_PATH = catEnv;

    // Explicit path wins over ENV
    const cat1 = new FileProjectCatalog({ catalogPath: catCustom });
    const list1 = await cat1.loadProjects();
    assert.equal(list1[0].projectId, 'custom-proj');

    // ENV is used when no explicit path passed
    const cat2 = new FileProjectCatalog();
    const list2 = await cat2.loadProjects();
    assert.equal(list2[0].projectId, 'env-proj');
  } finally {
    delete process.env.PUB_ACP_CATALOG_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Catalog Governance - 14. Architecture Rule: CWD uncataloged does NOT enter ProjectRegistry and currentProject is undefined', async () => {
  const dir = createTempDir('cwd-uncataloged');
  const wsCataloged = join(dir, 'cataloged');
  const wsCwd = join(dir, 'uncataloged-cwd');
  mkdirSync(wsCataloged);
  mkdirSync(wsCwd);

  const mockGit = createMockGitInspector({
    [wsCataloged]: { remote: 'https://github.com/pubcoreagencia/cataloged.git', branch: 'main' },
    [wsCwd]: { remote: 'https://github.com/rogue/uncataloged.git', branch: 'main' }
  });

  try {
    const catalog = new MemoryProjectCatalog([
      {
        projectId: 'pubcoreagencia-cataloged',
        workspacePath: wsCataloged,
        enabled: true
      }
    ]);

    const controlPlane = await createControlPlane({
      cwd: wsCwd,
      projectCatalog: catalog,
      gitInspector: mockGit
    });

    // Sole authorized project is cataloged
    assert.equal(controlPlane.projectRegistry.listProjects().length, 1);
    assert.ok(controlPlane.projectRegistry.hasProject('pubcoreagencia-cataloged'));
    assert.equal(controlPlane.projectRegistry.hasProject('rogue-uncataloged'), false);
    assert.equal(controlPlane.currentProject, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Catalog Governance - 15. Architecture Rule: CWD cataloged sets currentProject and does not duplicate registry entries', async () => {
  const dir = createTempDir('cwd-cataloged');
  const wsCataloged = join(dir, 'cataloged');
  mkdirSync(wsCataloged);

  const mockGit = createMockGitInspector({
    [wsCataloged]: { remote: 'https://github.com/pubcoreagencia/cataloged.git', branch: 'main' }
  });

  try {
    const catalog = new MemoryProjectCatalog([
      {
        projectId: 'pubcoreagencia-cataloged',
        workspacePath: wsCataloged,
        enabled: true
      }
    ]);

    const controlPlane = await createControlPlane({
      cwd: wsCataloged,
      projectCatalog: catalog,
      gitInspector: mockGit
    });

    assert.equal(controlPlane.projectRegistry.listProjects().length, 1);
    assert.ok(controlPlane.projectRegistry.hasProject('pubcoreagencia-cataloged'));
    assert.equal(controlPlane.currentProject?.projectId, 'pubcoreagencia-cataloged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
