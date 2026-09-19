import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

test('DISCOVERY ARCHITECTURAL INVARIANT - Discovery package must never import Catalog or ProjectRegistry', () => {
  const discoveryDir = join(process.cwd(), 'src', 'discovery');
  const files = readdirSync(discoveryDir).filter((f) => f.endsWith('.ts'));

  assert.ok(files.length > 0, 'Discovery directory should contain ts files');

  const forbiddenImports = [
    'src/catalog',
    'catalog/',
    'CatalogManager',
    'ProjectRegistry',
    'src/multiproject/ProjectRegistry',
    'SafetyGate',
    'createControlPlane',
  ];

  for (const file of files) {
    const filePath = join(discoveryDir, file);
    const content = readFileSync(filePath, 'utf-8');

    for (const forbidden of forbiddenImports) {
      assert.strictEqual(
        content.includes(forbidden),
        false,
        `File ${file} in src/discovery must NOT import or reference ${forbidden}`
      );
    }
  }
});
