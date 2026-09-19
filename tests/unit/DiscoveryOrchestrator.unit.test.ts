import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DiscoveryOrchestrator,
  IDiscoveryProvider,
  DiscoveryScope,
  DiscoveryStatus,
  DiscoveryProviderStatus,
  DiscoveryProviderResult,
  IWorkspaceCanonicalizer,
  WorkspaceCanonicalizationResult,
  WorkspaceCanonicalizationError,
  ProjectCandidate,
} from '../../src/discovery/index.js';

// Fake Canonicalizer for deterministic test control
class MockCanonicalizer implements IWorkspaceCanonicalizer {
  private customHandlers: Map<string, WorkspaceCanonicalizationResult> = new Map();

  setResult(path: string, res: WorkspaceCanonicalizationResult) {
    this.customHandlers.set(path, res);
  }

  async canonicalize(path: string): Promise<WorkspaceCanonicalizationResult> {
    if (this.customHandlers.has(path)) {
      return this.customHandlers.get(path)!;
    }
    // Default simulated resolution: lower-case with leading slash normalized
    return {
      success: true,
      canonicalPath: path.toLowerCase().replace(/\\/g, '/'),
    };
  }
}

// Fake Discovery Provider helper
class FakeDiscoveryProvider implements IDiscoveryProvider {
  public readonly name: string;
  private readonly handler: (scope: DiscoveryScope, signal: AbortSignal) => Promise<DiscoveryProviderResult>;

  constructor(
    name: string,
    handler: (scope: DiscoveryScope, signal: AbortSignal) => Promise<DiscoveryProviderResult>
  ) {
    this.name = name;
    this.handler = handler;
  }

  discover(scope: DiscoveryScope, signal: AbortSignal): Promise<DiscoveryProviderResult> {
    return this.handler(scope, signal);
  }
}

function makeCandidate(id: string, path: string, overrides: Partial<ProjectCandidate> = {}): ProjectCandidate {
  return {
    candidateId: id,
    canonicalWorkspacePath: path,
    originalWorkspacePath: path,
    discoverySource: 'filesystem',
    providerName: 'FakeProvider',
    discoveredAt: '2026-09-17T00:00:00.000Z',
    ...overrides,
  };
}

test('DiscoveryOrchestrator - 1. UNAVAILABLE when no providers registered (zero providers)', async () => {
  const orchestrator = new DiscoveryOrchestrator([], new MockCanonicalizer());
  const res = await orchestrator.discover({ roots: ['/test'] });
  assert.strictEqual(res.status, DiscoveryStatus.UNAVAILABLE);
  assert.strictEqual(res.candidates.length, 0);
  assert.ok(res.diagnostics?.some((d) => d.includes('No discovery providers registered')));
  assert.ok(res.orchestratedAt);
});

test('DiscoveryOrchestrator - 2. SUCCESS_WITH_CANDIDATES when provider returns candidates', async () => {
  const mockCanon = new MockCanonicalizer();
  const provider = new FakeDiscoveryProvider('Prov1', async () => ({
    status: DiscoveryProviderStatus.SUCCESS,
    candidates: [
      makeCandidate('c1', 'C:/Workspace/Alpha'),
      makeCandidate('c2', 'C:/Workspace/Beta'),
    ],
    source: 'filesystem',
    providerName: 'Prov1',
    discoveredAt: '2026-09-17T00:00:00.000Z',
  }));

  const orchestrator = new DiscoveryOrchestrator([provider], mockCanon);
  const res = await orchestrator.discover({ roots: ['C:/Workspace'] });

  assert.strictEqual(res.status, DiscoveryStatus.SUCCESS_WITH_CANDIDATES);
  assert.strictEqual(res.candidates.length, 2);
  assert.strictEqual(res.candidates[0].canonicalWorkspacePath, 'c:/workspace/alpha');
  assert.strictEqual(res.candidates[1].canonicalWorkspacePath, 'c:/workspace/beta');
  // Provenance preserved
  assert.strictEqual(res.candidates[0].providerName, 'FakeProvider');
  assert.strictEqual(res.candidates[0].discoveredAt, '2026-09-17T00:00:00.000Z');
  assert.strictEqual(res.candidates[0].discoverySource, 'filesystem');
  assert.ok(res.orchestratedAt);
});

test('DiscoveryOrchestrator - 3. SUCCESS_EMPTY when providers return EMPTY or 0 candidates', async () => {
  const provider = new FakeDiscoveryProvider('ProvEmpty', async () => ({
    status: DiscoveryProviderStatus.EMPTY,
    candidates: [],
    source: 'git',
    providerName: 'ProvEmpty',
    discoveredAt: '2026-09-17T00:00:00.000Z',
  }));

  const orchestrator = new DiscoveryOrchestrator([provider], new MockCanonicalizer());
  const res = await orchestrator.discover({ roots: ['C:/Workspace'] });

  assert.strictEqual(res.status, DiscoveryStatus.SUCCESS_EMPTY);
  assert.strictEqual(res.candidates.length, 0);
});

test('DiscoveryOrchestrator - 4. UNAVAILABLE when all providers fail or are unavailable', async () => {
  const providerFail = new FakeDiscoveryProvider('ProvFail', async () => ({
    status: DiscoveryProviderStatus.FAILURE,
    candidates: [],
    diagnostics: ['Disk error'],
    source: 'filesystem',
    providerName: 'ProvFail',
    discoveredAt: '2026-09-17T00:00:00.000Z',
  }));

  const providerUnavail = new FakeDiscoveryProvider('ProvUnavail', async () => ({
    status: DiscoveryProviderStatus.UNAVAILABLE,
    candidates: [],
    diagnostics: ['CLI not installed'],
    source: 'antigravity',
    providerName: 'ProvUnavail',
    discoveredAt: '2026-09-17T00:00:00.000Z',
  }));

  const orchestrator = new DiscoveryOrchestrator([providerFail, providerUnavail], new MockCanonicalizer());
  const res = await orchestrator.discover({ roots: ['C:/Workspace'] });

  assert.strictEqual(res.status, DiscoveryStatus.UNAVAILABLE);
  assert.strictEqual(res.candidates.length, 0);
  assert.ok(res.diagnostics?.some((d) => d.includes('Disk error')));
  assert.ok(res.diagnostics?.some((d) => d.includes('CLI not installed')));
});

test('DiscoveryOrchestrator - 5. PARTIAL_FAILURE when one provider succeeds and another fails', async () => {
  const providerOk = new FakeDiscoveryProvider('ProvOk', async () => ({
    status: DiscoveryProviderStatus.SUCCESS,
    candidates: [makeCandidate('c1', 'C:/Workspace/Alpha')],
    source: 'filesystem',
    providerName: 'ProvOk',
    discoveredAt: '2026-09-17T00:00:00.000Z',
  }));

  const providerFail = new FakeDiscoveryProvider('ProvFail', async () => ({
    status: DiscoveryProviderStatus.FAILURE,
    candidates: [],
    diagnostics: ['Network down'],
    source: 'git',
    providerName: 'ProvFail',
    discoveredAt: '2026-09-17T00:00:00.000Z',
  }));

  const orchestrator = new DiscoveryOrchestrator([providerOk, providerFail], new MockCanonicalizer());
  const res = await orchestrator.discover({ roots: ['C:/Workspace'] });

  assert.strictEqual(res.status, DiscoveryStatus.PARTIAL_FAILURE);
  assert.strictEqual(res.candidates.length, 1);
  assert.ok(res.diagnostics?.some((d) => d.includes('Network down')));
});

test('DiscoveryOrchestrator - 6. PARTIAL_FAILURE when provider is empty and another fails', async () => {
  const providerEmpty = new FakeDiscoveryProvider('ProvEmpty', async () => ({
    status: DiscoveryProviderStatus.EMPTY,
    candidates: [],
    source: 'cwd',
    providerName: 'ProvEmpty',
    discoveredAt: '2026-09-17T00:00:00.000Z',
  }));

  const providerFail = new FakeDiscoveryProvider('ProvFail', async () => ({
    status: DiscoveryProviderStatus.FAILURE,
    candidates: [],
    diagnostics: ['Permission error'],
    source: 'filesystem',
    providerName: 'ProvFail',
    discoveredAt: '2026-09-17T00:00:00.000Z',
  }));

  const orchestrator = new DiscoveryOrchestrator([providerEmpty, providerFail], new MockCanonicalizer());
  const res = await orchestrator.discover({ roots: ['C:/Workspace'] });

  assert.strictEqual(res.status, DiscoveryStatus.PARTIAL_FAILURE);
  assert.strictEqual(res.candidates.length, 0);
  assert.ok(res.diagnostics?.some((d) => d.includes('Permission error')));
});

test('DiscoveryOrchestrator - 7. Deduplication: deduplicates by canonical workspace path', async () => {
  const p1 = new FakeDiscoveryProvider('P1', async () => ({
    status: DiscoveryProviderStatus.SUCCESS,
    candidates: [
      makeCandidate('c1', 'C:/Workspace/Alpha'),
      makeCandidate('c2', 'C:/workspace/alpha'), // Same physical canonical workspace
    ],
    source: 'filesystem',
    providerName: 'P1',
    discoveredAt: '2026-09-17T00:00:00.000Z',
  }));

  const orchestrator = new DiscoveryOrchestrator([p1], new MockCanonicalizer());
  const res = await orchestrator.discover({ roots: ['C:/Workspace'] });

  assert.strictEqual(res.candidates.length, 1);
  assert.strictEqual(res.candidates[0].canonicalWorkspacePath, 'c:/workspace/alpha');
});

test('DiscoveryOrchestrator - 8. Preserves distinct workspaces sharing identical repository identity', async () => {
  const p1 = new FakeDiscoveryProvider('P1', async () => ({
    status: DiscoveryProviderStatus.SUCCESS,
    candidates: [
      makeCandidate('c1', 'C:/Workspace/MainWorktree', {
        repositoryIdentity: { remoteUrl: 'https://github.com/org/repo.git', repoUuid: 'uuid-123' },
      }),
      makeCandidate('c2', 'C:/Workspace/FeatureWorktree', {
        repositoryIdentity: { remoteUrl: 'https://github.com/org/repo.git', repoUuid: 'uuid-123' },
      }),
    ],
    source: 'git',
    providerName: 'P1',
    discoveredAt: '2026-09-17T00:00:00.000Z',
  }));

  const orchestrator = new DiscoveryOrchestrator([p1], new MockCanonicalizer());
  const res = await orchestrator.discover({ roots: ['C:/Workspace'] });

  assert.strictEqual(res.candidates.length, 2);
  assert.strictEqual(res.candidates[0].canonicalWorkspacePath, 'c:/workspace/featureworktree');
  assert.strictEqual(res.candidates[1].canonicalWorkspacePath, 'c:/workspace/mainworktree');
  assert.strictEqual(res.candidates[0].repositoryIdentity?.repoUuid, 'uuid-123');
  assert.strictEqual(res.candidates[1].repositoryIdentity?.repoUuid, 'uuid-123');
});

test('DiscoveryOrchestrator - 9. Deterministic sorting and maxCandidates application', async () => {
  const p1 = new FakeDiscoveryProvider('P1', async () => ({
    status: DiscoveryProviderStatus.SUCCESS,
    candidates: [
      makeCandidate('c-z', 'C:/Workspace/Zeta'),
      makeCandidate('c-a', 'C:/Workspace/Alpha'),
      makeCandidate('c-m', 'C:/Workspace/Mu'),
    ],
    source: 'filesystem',
    providerName: 'P1',
    discoveredAt: '2026-09-17T00:00:00.000Z',
  }));

  const orchestrator = new DiscoveryOrchestrator([p1], new MockCanonicalizer());
  // Limit to 2 candidates
  const res = await orchestrator.discover({ roots: ['C:/Workspace'], maxCandidates: 2 });

  assert.strictEqual(res.candidates.length, 2);
  // Sorted alphabetically first: Alpha, Mu (Zeta dropped due to maxCandidates)
  assert.strictEqual(res.candidates[0].canonicalWorkspacePath, 'c:/workspace/alpha');
  assert.strictEqual(res.candidates[1].canonicalWorkspacePath, 'c:/workspace/mu');
});

test('DiscoveryOrchestrator - 10. Canonicalization failure discards candidate and records diagnostic', async () => {
  const mockCanon = new MockCanonicalizer();
  const errorsToTest = [
    { path: 'C:/Workspace/NotFound', err: WorkspaceCanonicalizationError.PathNotFound, msg: 'Missing dir' },
    { path: 'C:/Workspace/Denied', err: WorkspaceCanonicalizationError.PermissionDenied, msg: 'No access' },
    { path: 'C:/Workspace/Invalid', err: WorkspaceCanonicalizationError.InvalidPath, msg: 'Bad chars' },
    { path: 'C:/Workspace/Loop', err: WorkspaceCanonicalizationError.SymlinkLoop, msg: 'Loop' },
    { path: 'C:/Workspace/Failed', err: WorkspaceCanonicalizationError.RealpathFailed, msg: 'Failed' },
  ];

  for (const item of errorsToTest) {
    mockCanon.setResult(item.path, {
      success: false,
      error: item.err,
      message: item.msg,
    });
  }

  const p1 = new FakeDiscoveryProvider('P1', async () => ({
    status: DiscoveryProviderStatus.SUCCESS,
    candidates: [
      makeCandidate('c-valid', 'C:/Workspace/Valid'),
      ...errorsToTest.map((e, idx) => makeCandidate(`c-err-${idx}`, e.path)),
    ],
    source: 'filesystem',
    providerName: 'P1',
    discoveredAt: '2026-09-17T00:00:00.000Z',
  }));

  const orchestrator = new DiscoveryOrchestrator([p1], mockCanon);
  const res = await orchestrator.discover({ roots: ['C:/Workspace'] });

  // Only the valid candidate should survive
  assert.strictEqual(res.candidates.length, 1);
  assert.strictEqual(res.candidates[0].candidateId, 'c-valid');

  // Diagnostics must contain records for each error type
  assert.ok(res.diagnostics?.some((d) => d.includes('PathNotFound')));
  assert.ok(res.diagnostics?.some((d) => d.includes('PermissionDenied')));
  assert.ok(res.diagnostics?.some((d) => d.includes('InvalidPath')));
  assert.ok(res.diagnostics?.some((d) => d.includes('SymlinkLoop')));
  assert.ok(res.diagnostics?.some((d) => d.includes('RealpathFailed')));
});

test('DiscoveryOrchestrator - 11. Effective cancellation and global timeout triggering TIMEOUT', async () => {
  let providerObservedAbort = false;

  const pSlow = new FakeDiscoveryProvider('CooperatingSlowProvider', async (scope, signal) => {
    return new Promise((resolve) => {
      // Long operation that listens strictly to signal.abort
      const timer = setTimeout(() => {
        resolve({
          status: DiscoveryProviderStatus.SUCCESS,
          candidates: [makeCandidate('c-late', 'C:/Late')],
          source: 'filesystem',
          providerName: 'CooperatingSlowProvider',
          discoveredAt: '2026-09-17T00:00:00.000Z',
        });
      }, 1000);

      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        providerObservedAbort = signal.aborted;
        resolve({
          status: DiscoveryProviderStatus.TIMEOUT,
          candidates: [],
          diagnostics: [`CooperatingSlowProvider observed signal.aborted=${signal.aborted} and aborted cleanly`],
          source: 'filesystem',
          providerName: 'CooperatingSlowProvider',
          discoveredAt: '2026-09-17T00:00:00.000Z',
        });
      });
    });
  });

  const orchestrator = new DiscoveryOrchestrator([pSlow], new MockCanonicalizer());
  const res = await orchestrator.discover({ roots: ['C:/Workspace'], timeoutMs: 50 });

  assert.strictEqual(providerObservedAbort, true, 'Provider must have observed signal.aborted === true');
  assert.strictEqual(res.status, DiscoveryStatus.TIMEOUT);
  assert.strictEqual(res.candidates.length, 0);
  assert.ok(res.diagnostics?.some((d) => d.includes('signal.aborted=true')));
});

test('DiscoveryOrchestrator - 12. Global timeout triggers PARTIAL_FAILURE if one provider completed with SUCCESS', async () => {
  const pFast = new FakeDiscoveryProvider('FastProvider', async () => ({
    status: DiscoveryProviderStatus.SUCCESS,
    candidates: [makeCandidate('c1', 'C:/Workspace/Fast')],
    source: 'filesystem',
    providerName: 'FastProvider',
    discoveredAt: '2026-09-17T00:00:00.000Z',
  }));

  const pSlow = new FakeDiscoveryProvider('SlowProvider', async (scope, signal) => {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          status: DiscoveryProviderStatus.SUCCESS,
          candidates: [],
          source: 'git',
          providerName: 'SlowProvider',
          discoveredAt: '2026-09-17T00:00:00.000Z',
        });
      }, 1000);

      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve({
          status: DiscoveryProviderStatus.TIMEOUT,
          candidates: [],
          diagnostics: ['Timeout reached on slow provider'],
          source: 'git',
          providerName: 'SlowProvider',
          discoveredAt: '2026-09-17T00:00:00.000Z',
        });
      });
    });
  });

  const orchestrator = new DiscoveryOrchestrator([pFast, pSlow], new MockCanonicalizer());
  const res = await orchestrator.discover({ roots: ['C:/Workspace'], timeoutMs: 50 });

  assert.strictEqual(res.status, DiscoveryStatus.PARTIAL_FAILURE);
  assert.strictEqual(res.candidates.length, 1);
  assert.strictEqual(res.candidates[0].canonicalWorkspacePath, 'c:/workspace/fast');
  assert.ok(res.diagnostics?.some((d) => d.includes('Timeout reached on slow provider')));
});
