import { spawnSync } from 'node:child_process';

// Each UI suite owns its Happy DOM globals and compiler plugin. A fresh Bun
// process gives each cached fixture a complete setup/teardown lifetime.
for (const file of [
  'tests/test-geometry-foundation.test.tsx',
  'tests/test-geometry-preview-lifetime.test.tsx',
  'tests/test-geometry-reader-independent.test.tsx',
  'tests/test-geometry-compiled-document-independent.test.tsx',
]) {
  const result = spawnSync(process.execPath, ['test', file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
