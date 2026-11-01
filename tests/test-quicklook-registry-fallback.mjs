#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') {
  console.log('SKIP Quick Look registry fallback: requires macOS Swift runtime.');
  process.exit(0);
}
const temporary = mkdtempSync(join(tmpdir(), 'burette-registry-fallback-'));
const contents = join(temporary, 'RegistryFallback.app/Contents');
mkdirSync(join(contents, 'MacOS'), { recursive: true });
mkdirSync(join(contents, 'Resources'));
cpSync('config/preview-formats.json', join(contents, 'Resources/preview-formats.json'));
const harness = join(temporary, 'main.swift');
writeFileSync(harness, `
import Foundation
final class PreviewViewController: NSObject {}
for ext in ["cjson", "mrc", "map", "ccp4"] {
    precondition(BuretteCoreBridge.previewPlan(fileExtension: ext, requestedMode: "auto") == nil,
        "This harness deliberately has no subprocess bridge")
    let format = BuretteCoreBridge.format(fileExtension: ext)!
    precondition(format.molstarFormat == (ext == "cjson" ? "cjson" : "ccp4"))
    precondition(format.isBinary == (ext != "cjson"))
    precondition(format.isExternalXyzrenderOnly == (ext == "cjson"))
    for requested in ["auto", "molstar", "xyzrender-external"] {
        let policy = BuretteRendererPolicy.resolve(format: format, requestedMode: requested, fileExtension: ext)
        precondition(policy.renderer == (ext == "cjson" ? "xyzrender-external" : "molstar"))
        precondition(policy.molstarAvailable == (ext != "cjson"))
    }
}
precondition(BuretteCoreBridge.format(fileExtension: "not-a-structure") == nil)
precondition(BundledFormatRegistry.supportedExtension("CJSON") == true)
print("Quick Look registry fallback routing passed without subprocess bridge")
`);
try {
  const binary = join(contents, 'MacOS/registry-fallback');
  const compile = spawnSync('xcrun', ['swiftc', 'PreviewExtension/RendererPolicy.swift', harness, '-o', binary],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(compile.status, 0, compile.stderr);
  const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 15000 });
  assert.equal(run.status, 0, run.stderr);
  console.log(run.stdout.trim());
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
