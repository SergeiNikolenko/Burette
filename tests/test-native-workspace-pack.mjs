import test from 'node:test';
import assert from 'node:assert/strict';
import { packNativeWorkspace, rewriteWorkspaceModule } from '../scripts/pack-native-workspace.mjs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

test('SDK CSS references the packaged KaTeX font without requiring network access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'burette-font-pack-'));
  try {
    const shellRoot = join(root, 'shell'), runtimeRoot = join(root, 'runtime'), outputRoot = join(root, 'out');
    await Promise.all([mkdir(join(shellRoot, 'assets'), { recursive: true }), mkdir(join(runtimeRoot, 'rdkit'), { recursive: true }), mkdir(join(runtimeRoot, 'openchemlib'), { recursive: true })]);
    await writeFile(join(shellRoot, 'index.html'), '<script type="module" src="./index.js"></script><link rel="stylesheet" href="./assets/style.css">');
    await writeFile(join(shellRoot, 'index.js'), 'export const ready = true;');
    await writeFile(join(shellRoot, 'assets/KaTeX_Main-Regular-fixture.woff2'), 'font fixture');
    await writeFile(join(shellRoot, 'assets/style.css'), '@font-face{src:url("https://cdn.openai.com/common/fonts/katex/KaTeX_Main-Regular.woff2")}');
    for (const name of ['molstar.css', 'viewer-runtime.css', 'viewer-shell.js', 'viewer-bootstrap.js', 'sequence-panel.js', 'molecule-preview-interactions.js', 'renderer-view-state.js', 'color-picker.js', 'scene-file-actions.js', 'viewer.js', 'burette-agent.js', 'trajectory-smoothing.js', 'molstar-preset-preview-controller.js', 'superposition-panel.js', 'grid-viewer.js', 'grid-ui.js', 'grid.css', 'rdkit/RDKit_minimal.wasm', 'openchemlib/openchemlib.js']) {
      await writeFile(join(runtimeRoot, name), 'fixture');
    }
    await writeFile(join(runtimeRoot, 'rdkit/RDKit_minimal.js'), 'function craftInvokerFunction(){new Function()}var __embind_register_class_constructor;');
    const manifest = await packNativeWorkspace({ shellRoot, runtimeRoot, outputRoot, molstar: 'fixture' });
    const entry = manifest.assets['shell/assets/style.css'];
    const css = gunzipSync(await readFile(join(outputRoot, `${entry.sha256}.gz`))).toString();
    assert.equal(css, '@font-face{src:url("./KaTeX_Main-Regular-fixture.woff2")}');
    assert.ok(manifest.assets['shell/assets/KaTeX_Main-Regular-fixture.woff2']);
    await rm(join(shellRoot, 'assets/KaTeX_Main-Regular-fixture.woff2'));
    await assert.rejects(packNativeWorkspace({ shellRoot, runtimeRoot, outputRoot, molstar: 'fixture' }), /Expected one packaged SDK font/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('native modules keep static graphs and lazy imports without relative blob imports', () => {
  const result = rewriteWorkspaceModule('import { a } from "./a.js"; export { b } from "../b.js"; const later = () => import("./heavy.js"); const url = import.meta.url;', 'shell/assets/app.js');
  assert.deepEqual(result, {
    dependencies: ['shell/assets/a.js', 'shell/b.js'],
    resources: [],
    code: 'import { a } from "burette:shell/assets/a.js"; export { b } from "burette:shell/b.js"; const later = () => window.BuretteMcpWorkspace.importModule("shell/assets/heavy.js"); const url = window.BuretteMcpWorkspace.moduleBase("shell/assets/app.js");',
  });
  assert.throws(() => rewriteWorkspaceModule('import("https://example.com/x.js")', 'shell/app.js'), /Unbundled/);
  assert.equal(rewriteWorkspaceModule('import(path)', 'shell/app.js').code, 'window.BuretteMcpWorkspace.importModuleAt("shell/app.js",path)');
  assert.throws(() => rewriteWorkspaceModule('import "../../escape.js"', 'shell/app.js'), /escapes/);
});

test('worker and WASM URLs become integrity-checked packaged dependencies', () => {
  assert.deepEqual(rewriteWorkspaceModule('new Worker(new URL("./worker.js", import.meta.url));new URL("./engine.wasm", self.location.href)', 'shell/assets/app.js'), {
    dependencies: [], resources: ['shell/assets/worker.js', 'shell/assets/engine.wasm'],
    code: 'new Worker(new URL("burette-packaged:shell/assets/worker.js"));new URL("burette-packaged:shell/assets/engine.wasm")',
  });
});
