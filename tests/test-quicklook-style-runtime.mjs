import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') {
  console.log('SKIP Quick Look style runtime: requires Swift on macOS.');
  process.exit(0);
}
const source = readFileSync(new URL('../PreviewExtension/Platform/PreviewViewController.swift', import.meta.url), 'utf8');
const property = source.match(/    var resolvedMolstarStyle: String \{[\s\S]*?\n    \}/u)?.[0];
assert.ok(property);
const result = spawnSync('xcrun', ['swift', '-'], {
  input: `struct Preferences {
let molstarStyle: String
${property}
}

for style in ["default", "illustrative", "illustrative-surface", "polymer-ligand", "cartoon", "ball-and-stick", "spacefill", "line", "molecular-surface", "blob-surface"] {
    precondition(Preferences(molstarStyle: style).resolvedMolstarStyle == style)
}
precondition(Preferences(molstarStyle: "unsupported").resolvedMolstarStyle == "illustrative")
precondition(Preferences(molstarStyle: "").resolvedMolstarStyle == "illustrative")
print("Quick Look retains saved representations and rejects unsupported styles")
`,
  encoding: 'utf8', timeout: 60000,
});
assert.equal(result.status, 0, result.error?.message || result.stderr);
console.log(result.stdout.trim());
