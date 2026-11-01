#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openBrowserDevDocuments, writeBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } from '../apps/desktop/src/lib/browser-dev-documents.ts';
import { isPreferredTextPath, structureExtensions } from '../apps/desktop/src/lib/file-routing.ts';

const fixture = await readFile(new URL('../samples/mini.cjson', import.meta.url), 'utf8');
const path = '/virtual/water.cjson';
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const requests = [];
globalThis.window = { location: new URL('http://localhost:5173/') };
globalThis.fetch = async (url, options) => {
  assert.equal(new URL(url).pathname, '/__burette/xyzrender');
  requests.push(JSON.parse(options.body));
  return Response.json({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>' });
};
writeBrowserDevVirtualTextDocument(path, fixture);
try {
  for (const rendererMode of ['auto', 'molstar', 'xyzrender-external']) {
    const result = await openBrowserDevDocuments([path], { rendererMode, theme: 'light' });
    assert.deepEqual(result.errors, []);
    assert.equal(result.documents.length, 1);
    const document = result.documents[0];
    assert.equal(document.renderer, 'xyzrender-external');
    assert.equal(document.extension, 'cjson');
    assert.match(document.runtimePath, /"molstarAvailable":false/);
    const request = requests.at(-1);
    assert.equal(request.inputExtension, 'cjson');
    assert.equal(Buffer.from(request.inputDataBase64, 'base64').toString('utf8'), fixture,
      'Pass the original Chemical JSON, retaining bonds, colors, cell and camera metadata');
  }
  assert.equal(structureExtensions.has('cjson'), true);
  assert.equal(isPreferredTextPath('/virtual/config.json'), true);
  assert.equal(isPreferredTextPath(path), false);
} finally {
  deleteBrowserDevVirtualTextDocument(path);
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}
console.log('Chemical JSON browser preview routing tests passed');
