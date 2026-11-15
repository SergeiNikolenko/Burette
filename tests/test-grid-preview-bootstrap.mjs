import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { Window } from 'happy-dom';

let source = readFileSync('apps/desktop/src/components/grid-molecule-3d.tsx', 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/const assets = import\.meta\.glob[^\n]+/, 'const assets = new Proxy({}, { get: (_target, key) => `/assets/${String(key).split("/").pop().replace(/\\.(css|js)$/, "-testhash.$1")}` });')
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
const view = (molblock, theme = 'light', hydrogenDisplay = 'none') => { cursor = 0; return render({ molblock, hydrogenDisplay, theme, height: 400, onOpen() {} }).props.srcDoc; };
assert.equal(view(''), '<!doctype html><html></html>');
const molblock = 'Molecule\nheader\n\nM  END\n';
const html = view(molblock);
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
assert(scripts.length > 1);
for (const [, attrs, text] of scripts) assert(attrs.includes('type="application/json"') || attrs.includes('src=') && !text.trim(), 'strict CSP must not require executable inline scripts');
assert.equal(view(molblock, 'light', 'all'), html, 'H changes must not replace the iframe');
assert.equal(view('next molecule'), html, 'changing rows reuses the live iframe');
const data = JSON.parse(scripts.find(match => match[1].includes('application/json'))[2]);
assert.equal(Buffer.from(data.data, 'base64').toString(), molblock);
const darkHtml = view('next molecule', 'dark');
const darkData = JSON.parse(darkHtml.match(/id="burette-inspector-input">([^]*?)<\/script>/)[1]);
assert.equal(darkHtml, html, 'theme changes reuse the live iframe and its scene');
assert.equal(darkData.config.inspectorChannel, data.config.inspectorChannel);
const window = { parent: { postMessage() {} }, addEventListener() {} };
runInNewContext(readFileSync('apps/desktop/src/preview-grid/molecule-preview-bootstrap.js', 'utf8'), {
  window, document: { getElementById: () => ({ textContent: JSON.stringify(data) }), addEventListener() {} },
}, { contextCodeGeneration: { strings: false, wasm: false } });
assert.deepEqual(JSON.parse(JSON.stringify(window.BuretteConfig)), data.config);
assert.equal(window.BuretteDataBase64, data.data);
console.log('Inspector bootstrap: strict CSP, delayed source and iframe reuse passed.');

const runtimeSource = readFileSync('PreviewExtension/Web/viewer.js', 'utf8');
const stylesheetStart = runtimeSource.indexOf('  function ensureMolstarStylesheet() {');
const stylesheetEnd = runtimeSource.indexOf('\n  function ', stylesheetStart + 1);
const stylesheetCode = runtimeSource.slice(stylesheetStart, stylesheetEnd);
for (const markup of [html, darkHtml, '<link rel="stylesheet" href="./molstar.css">', '<link rel="stylesheet" href="./molstar.css?v=native">', '']) {
  const browser = new Window({ url: 'https://burette.test/', settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
  try {
    browser.document.write(markup);
    const before = Array.from(browser.document.querySelectorAll('link[rel="stylesheet"]'), link => link.href);
    const ensure = new Function('document', 'runtimeURL', `${stylesheetCode};return ensureMolstarStylesheet;`)(browser.document, (_key, fallback) => fallback);
    ensure(); ensure();
    const after = Array.from(browser.document.querySelectorAll('link[rel="stylesheet"]'), link => link.href);
    assert.deepEqual(after, before.length ? before : ['https://burette.test/molstar.css'], 'the existing Molstar stylesheet is reused; missing native stylesheet is inserted only once');
  } finally { await browser.happyDOM.close(); }
}
console.log('Inspector stylesheet: hashed light/dark CSS and plain native CSS reuse; missing CSS inserted once.');

