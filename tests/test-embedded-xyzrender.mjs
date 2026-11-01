#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const environment = process.env.BURETTE_XYZRENDER_ENV;
if (process.platform !== 'darwin' || !environment) {
  console.log('SKIP embedded CJSON renderer: requires macOS and BURETTE_XYZRENDER_ENV.');
  process.exit(0);
}
const pythonHome = dirname(readFileSync(join(environment, 'pyvenv.cfg'), 'utf8').match(/^home = (.+)$/m)[1]);
const site = join(environment, 'lib/python3.13/site-packages');
assert.ok(existsSync(join(pythonHome, 'include/python3.13/Python.h')), 'Use the pinned CPython 3.13 runtime.');
const temporary = mkdtempSync(join(tmpdir(), 'burette-embedded-cjson-'));
const bundle = join(temporary, 'EmbeddedTest.appex');
mkdirSync(join(bundle, 'Contents/lib'), { recursive: true });
const libraryDirectory = join(bundle, 'Contents/lib');
symlinkSync(join(pythonHome, 'lib/libpython3.13.dylib'), join(libraryDirectory, 'libpython3.13.dylib'));
cpSync('samples/mini.cjson', join(temporary, 'source.cjson'));
writeFileSync(join(temporary, 'invalid.cjson'), '{ this is invalid Chemical JSON');
const binary = join(temporary, 'embedded-test');
writeFileSync(join(temporary, 'main.swift'), `
import Foundation
let bundle = URL(fileURLWithPath: CommandLine.arguments[1])
let home = CommandLine.arguments[2], site = CommandLine.arguments[3], directory = CommandLine.arguments[4]
let originalEnvironment = ProcessInfo.processInfo.environment
if CommandLine.arguments.count > 5 {
    for pythonHome in [directory + "/missing-python", home] {
        do {
            _ = try EmbeddedXyzrender.render(extensionBundle: bundle, pythonHome: pythonHome, sitePackages: site,
                sourceURL: URL(fileURLWithPath: directory + "/source.cjson"),
                arguments: [], logURL: URL(fileURLWithPath: directory + "/initialization.log"))
            preconditionFailure("Failed Python initialization must stay failed until the preview process restarts")
        } catch {
            precondition(error.localizedDescription.contains("initialization failed"))
        }
    }
    print("Failed embedded Python initialization stays failed without unloading or retrying partial interpreter state.")
    exit(0)
}
var firstSVG = ""
for index in 0..<4 {
    let invalid = index == 2
    let source = directory + (invalid ? "/invalid.cjson" : "/source.cjson")
    let output = directory + "/render-\\(index).svg"
    let log = URL(fileURLWithPath: directory + "/render-\\(index).log")
    let status = try EmbeddedXyzrender.render(extensionBundle: bundle, pythonHome: home, sitePackages: site,
        sourceURL: URL(fileURLWithPath: source),
        arguments: ["-o", output, "--config", "default", source], logURL: log)
    precondition((status == 0) == !invalid, "Unexpected renderer exit: \\(status)")
    let logData = try Data(contentsOf: log)
    precondition(logData.count <= 65536, "Render log exceeded its bound")
    if !invalid {
        let rendered = try String(contentsOfFile: output, encoding: .utf8)
        // xyzrender namespaces SVG definitions with a fresh UUID per render.
        let svg = rendered.replacingOccurrences(of: "x[0-9a-f]{32}", with: "render-id", options: .regularExpression)
        precondition(svg.contains("<svg"))
        if firstSVG.isEmpty { firstSVG = svg } else { precondition(svg == firstSVG, "Renderer state leaked across calls") }
    }
}
let changedEnvironment = ProcessInfo.processInfo.environment.filter { originalEnvironment[$0.key] != $0.value }
if !changedEnvironment.isEmpty { print("Environment changes: \\(changedEnvironment.keys.sorted())"); fflush(stdout) }
precondition(originalEnvironment == ProcessInfo.processInfo.environment, "Embedded Python mutated process environment")
print("Embedded CJSON renders repeatably without process-fork; invalid input recovers; environment and log bounds hold.")
`);
try {
  const compileC = spawnSync('xcrun', ['clang', '-dynamiclib', '-O2', '-fvisibility=hidden', '-mmacosx-version-min=12.0',
    '-I', join(pythonHome, 'include/python3.13'), 'PreviewExtension/EmbeddedXyzrender.c',
    '-o', join(libraryDirectory, 'burette-xyzrender-bridge.dylib')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(compileC.status, 0, compileC.stderr);
  const compileSwift = spawnSync('xcrun', ['swiftc', 'PreviewExtension/EmbeddedXyzrender.swift', join(temporary, 'main.swift'), '-o', binary],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(compileSwift.status, 0, compileSwift.stderr);
  // This matches the relevant Quick Look restriction without weakening its entitlements.
  const run = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)(deny process-fork)',
    binary, bundle, resolve(pythonHome), resolve(site), temporary],
    { encoding: 'utf8', timeout: 90000, env: { ...process.env, PYTHONHOME: '/nonexistent-ambient-python', PYTHONPATH: '/nonexistent-ambient-modules' } });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${run.signal || ''}`);
  console.log(run.stdout.trim());
  const failedInitialization = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)(deny process-fork)',
    binary, bundle, resolve(pythonHome), resolve(site), temporary, 'invalid-home'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(failedInitialization.status, 0, `${failedInitialization.stdout}\n${failedInitialization.stderr}`);
  console.log(failedInitialization.stdout.trim());
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
