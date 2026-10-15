import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';

let source = readFileSync('apps/desktop/src/components/grid-molecule-3d.tsx', 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/const assets = import\.meta\.glob[^\n]+/, 'const assets = {};')
  .replace('export default function', 'function');
const code = new Bun.Transpiler({ loader: 'tsx', tsconfig: { compilerOptions: { jsx: 'react' } } }).transformSync(source);
const refs = []; let cursor = 0;
let memo;
const useMemo = (fn, deps) => {
  if (!memo || deps.some((value, index) => !Object.is(value, memo.deps[index]))) memo = { deps, value: fn() };
  return memo.value;
};
const render = new Function('React', 'useRef', 'useMemo', 'useEffect', 'window', 'bootstrapUrl', `${code};return GridMolecule3D;`)(
  React, value => refs[cursor++] ??= { current: value }, useMemo, () => {}, { location: { href: 'https://burette.test/' } }, '/bootstrap.js',
);
const view = (molblock, theme = 'light') => { cursor = 0; return render({ molblock, theme, height: 400, onOpen() {} }).props.srcDoc; };
assert.equal(view(''), '<!doctype html><html></html>');
const molblock = 'Molecule\nheader\n\nM  END\n';
const html = view(molblock);
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
assert(scripts.length > 1);
for (const [, attrs, text] of scripts) assert(attrs.includes('type="application/json"') || attrs.includes('src=') && !text.trim(), 'strict CSP must not require executable inline scripts');
assert.equal(view('next molecule'), html, 'changing rows reuses the live iframe');
const data = JSON.parse(scripts.find(match => match[1].includes('application/json'))[2]);
assert.equal(Buffer.from(data.data, 'base64').toString(), molblock);
const darkHtml = view('next molecule', 'dark');
const darkData = JSON.parse(darkHtml.match(/id="burette-inspector-input">([^]*?)<\/script>/)[1]);
assert.notEqual(darkData.config.inspectorChannel, data.config.inspectorChannel, 'a replaced document has a fresh channel');
const window = { parent: { postMessage() {} }, addEventListener() {} };
runInNewContext(readFileSync('apps/desktop/src/preview-grid/molecule-preview-bootstrap.js', 'utf8'), {
  window, document: { getElementById: () => ({ textContent: JSON.stringify(data) }), addEventListener() {} },
}, { contextCodeGeneration: { strings: false, wasm: false } });
assert.deepEqual(JSON.parse(JSON.stringify(window.BuretteConfig)), data.config);
assert.equal(window.BuretteDataBase64, data.data);
console.log('Inspector bootstrap: strict CSP, delayed source and iframe reuse passed.');

const layout = readFileSync('apps/desktop/src/components/app-layout.tsx', 'utf8');
const begin = layout.indexOf('    if (!activeGridId) return;\n    const observer = new ResizeObserver');
const end = layout.indexOf('  }, [activeGridId, rightDockOpen, viewportWidth]);', begin);
assert(begin > 0 && end > begin);
const effect = new Bun.Transpiler({ loader: 'ts' }).transformSync(`function run() {${layout.slice(begin, end)}}`);
let resized; let frameRight = 1000; const covers = []; const observed = [];
const iframe = { contentWindow: {}, getBoundingClientRect: () => ({ right: frameRight }) };
const dock = { getBoundingClientRect: () => ({ left: 600 }) };
const env = {
  activeGridId: 'scene', rightDockOpen: true, rightDockElementRef: { current: dock }, workbenchGroupRef: { current: {} },
  ResizeObserver: class { constructor(callback) { resized = callback; } observe(target) { observed.push(target); } disconnect() {} },
  activeViewerIframeForDocument: () => iframe,
  postMessageToViewerSource: (_win, message) => covers.push(message.body.cover),
  window: { addEventListener() {}, removeEventListener() {}, setTimeout() {}, clearTimeout() {} },
};
const cleanup = new Function(...Object.keys(env), `${effect}; return run();`)(...Object.values(env));
assert(observed.includes(iframe), 'iframe resizing must invalidate the dock cover');
frameRight = 700; resized();
assert.deepEqual(covers, [400, 100]);
cleanup();
console.log('Grid layout: iframe resize recalculates available card width.');
