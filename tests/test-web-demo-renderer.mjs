#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// Exercise the same compile-time surface flags as the deployed static shell.
if (process.env.VITE_BURETTE_WEB_DEMO !== '1') {
  const result = spawnSync(process.execPath, [import.meta.path], {
    stdio: 'inherit',
    env: { ...process.env, VITE_BURETTE_WEB_DEMO: '1', VITE_BURETTE_WEB_ASSETS_BASE: '/burette-viewer/' },
  });
  process.exit(result.status ?? 1);
}
const { openBrowserDevDocuments } = await import('../apps/desktop/src/lib/browser-dev-documents.ts');
const fixtures = new Map(await Promise.all([
  'Crystals/silicon.cjson',
  'Structures/coronene_colors.cjson',
  'Structures/mnh.xyz',
].map(async path => [path, await readFile(new URL(`../apps/burette-public-plugin/public/demo-library/${path}`, import.meta.url), 'utf8')])));
const requests = [];
const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
globalThis.window = { location: new URL('https://demo.example/web-demo/index.html') };
globalThis.fetch = async (input, options) => {
  const url = new URL(input, window.location.href);
  if (url.pathname === '/api/xyzrender') {
    const payload = JSON.parse(options.body);
    const path = payload.path.replace('/BuretteDemo/', '');
    assert.equal(payload.inputExtension, 'cjson');
    assert.equal(Buffer.from(payload.inputDataBase64, 'base64').toString(), fixtures.get(path));
    requests.push(path);
    return Response.json({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>' });
  }
  const path = decodeURIComponent(url.pathname).replace('/demo-library/', '');
  assert.ok(fixtures.has(path), `Unexpected request: ${url}`);
  return new Response(fixtures.get(path));
};
try {
  for (const [path] of fixtures) {
    const result = await openBrowserDevDocuments([`/BuretteDemo/${path}`], { rendererMode: 'molstar', theme: 'light' });
    assert.deepEqual(result.errors, []);
    assert.equal(result.documents.length, 1);
    const document = result.documents[0];
    assert.equal(document.renderer, path.endsWith('.cjson') ? 'xyzrender-external' : 'molstar');
    const resourcePaths = [...document.runtimePath.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map(match => match[1]);
    assert.ok(resourcePaths.length > 10);
    for (const resource of resourcePaths) {
      assert.ok(resource.startsWith('/burette-viewer/'), `Resource must not depend on srcdoc preload base handling: ${resource}`);
    }
  }
  assert.deepEqual(requests, ['Crystals/silicon.cjson', 'Structures/coronene_colors.cjson']);
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}
console.log('Static demo CJSON payloads and viewer asset URLs passed.');
