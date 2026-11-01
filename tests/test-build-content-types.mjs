#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Execute the packaging acceptance check with reordered and incomplete metadata.
const build = readFileSync(new URL('../scripts/build.sh', import.meta.url), 'utf8');
const marker = '/usr/bin/python3 - "$APP_METADATA_PLIST" "$LOCAL_APP/Contents/Info.plist" <<\'PY\'\n';
const check = build.split(marker)[1]?.split('\nPY')[0];
assert.ok(check, 'The build must verify all exported content types');
const directory = mkdtempSync(join(tmpdir(), 'burette-content-types-'));
try {
  const expected = join(directory, 'source.plist');
  const actual = join(directory, 'bundle.plist');
  for (const prefix of ['com.local.burette10.', 'com.local.burette10.dev.rendereroct27.']) {
    for (const missing of [false, true]) {
      const fixture = spawnSync('/usr/bin/python3', ['-c', `
import plistlib, sys
source, target, prefix, missing = sys.argv[1:]
entries = [{"UTTypeIdentifier": prefix + name} for name in ["cjson", "pdb", "xyz"]]
with open(source, "wb") as handle:
    plistlib.dump({"UTExportedTypeDeclarations": entries}, handle)
with open(target, "wb") as handle:
    plistlib.dump({"UTExportedTypeDeclarations": list(reversed(entries[1:] if missing == "true" else entries))}, handle)
`, expected, actual, prefix, String(missing)], { encoding: 'utf8' });
      assert.equal(fixture.status, 0, fixture.stderr);
      const result = spawnSync('/usr/bin/python3', ['-', expected, actual], { input: check, encoding: 'utf8' });
      assert.equal(result.status, missing ? 1 : 0, result.stderr);
      if (missing) assert.match(result.stderr, new RegExp(`${prefix.replaceAll('.', '\\.')}cjson`));
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log('Build exported content type acceptance tests passed');
