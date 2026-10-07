#!/usr/bin/env node
// Regenerate apps/desktop/src/styles/codex-tokens.css from the Codex desktop
// stylesheet kept in the InterfaceAtlas snapshot.
//
//   node scripts/sync-codex-tokens.mjs --atlas ~/Documents/Projects/InterfaceAtlas
//
// The Codex theme layer declares its tokens on :root for several window types.
// This resolves that cascade for the Electron desktop window, once per theme,
// and re-scopes the result to Burette's .app-shell. Values keep their var()
// relations, so the base variables set by lib/codex-theme.ts drive everything.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const atlasArg = process.argv.indexOf('--atlas');
const atlas = (atlasArg > 0 ? process.argv[atlasArg + 1] : '~/Documents/Projects/InterfaceAtlas').replace(/^~/, homedir());
const assets = join(atlas, 'snapshot/assets');
const sheet = (await readdir(assets)).find((name) => /^app-shared-.*\.css$/.test(name));
if (!sheet) throw new Error(`No app-shared stylesheet under ${assets}`);
const css = await readFile(join(assets, sheet), 'utf8');

function parseRules(text) {
  const rules = [];
  const stack = [];
  let buffer = '';
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === '{' && depth === 0) { stack.push(buffer.trim()); buffer = ''; continue; }
    if (char === '}' && depth === 0) {
      if (buffer.trim()) rules.push({ path: [...stack], body: buffer });
      buffer = '';
      stack.pop();
      continue;
    }
    buffer += char;
  }
  return rules;
}

function declarations(body) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const char of `${body};`) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ';' && depth === 0) {
      const match = /^\s*(--[A-Za-z0-9_-]+)\s*:([\s\S]*)$/.exec(current);
      if (match && !match[1].startsWith('--tw-')) out.push([match[1], match[2].trim()]);
      current = '';
      continue;
    }
    current += char;
  }
  return out;
}

function splitSelectors(selector) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of selector) {
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += char;
  }
  parts.push(current.trim());
  return parts;
}

// Whether one selector matches the <html> element of the Electron window in the
// given theme, and with which specificity (0 inside :where, 1 otherwise).
function matchRoot(part, theme) {
  if (!/^(:root|:where\(|:is\(|\[data-theme|\[data-codex-window-type=electron\])/.test(part)) return null;
  if (/[ >+~]/.test(part.replace(/\([^()]*(\([^()]*\)[^()]*)*\)/g, ''))) return null;
  const positive = part.replace(/:not\([^()]*(\([^()]*\))?[^()]*\)/g, '');
  if (/window-type=(extension|browser|chrome-extension)/.test(positive)) return null;
  if (/:not\(\[data-theme\]\)/.test(part)) return null;
  const themed = /data-theme=(light|dark)/.exec(positive);
  if (themed && themed[1] !== theme) return null;
  if (/\.electron-opaque|:host/.test(positive) && !/:root/.test(positive)) return null;
  return /^(:where\(|:is\(:where\()/.test(part) ? 0 : 1;
}

const LAYER_RANK = { theme: 0, base: 1 };
const WRAPPERS = new Map();

function resolve(theme) {
  const candidates = [];
  parseRules(css).forEach((rule, order) => {
    const selector = rule.path.at(-1);
    const conditions = rule.path.slice(0, -1);
    const layer = conditions.find((item) => item.startsWith('@layer '));
    const layerRank = layer ? LAYER_RANK[layer.slice(7).trim()] : 2;
    if (layerRank === undefined) return;
    const wrapper = conditions.filter((item) => !item.startsWith('@layer ') && !/^@supports \(color:color-mix/.test(item));
    if (wrapper.some((item) => /prefers-color-scheme|pointer:coarse|not all|@container/.test(item))) return;
    const specificity = splitSelectors(selector).map((part) => matchRoot(part, theme)).filter((value) => value !== null);
    if (!specificity.length) return;
    const decls = declarations(rule.body);
    if (!decls.length) return;
    candidates.push({ rank: [layerRank, Math.max(...specificity), order], wrapper: wrapper.join(' '), decls });
  });
  candidates.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
  const base = new Map();
  for (const candidate of candidates) {
    if (candidate.wrapper) {
      const bucket = WRAPPERS.get(candidate.wrapper) ?? { light: new Map(), dark: new Map() };
      for (const [name, value] of candidate.decls) bucket[theme].set(name, value);
      WRAPPERS.set(candidate.wrapper, bucket);
      continue;
    }
    for (const [name, value] of candidate.decls) base.set(name, value);
  }
  return base;
}

const light = resolve('light');
const dark = resolve('dark');
const block = (selector, entries, indent = '') => entries.length
  ? `${indent}${selector} {\n${entries.map(([name, value]) => `${indent}  ${name}: ${value};`).join('\n')}\n${indent}}\n`
  : '';
const emit = (lightMap, darkMap, scope, indent = '') => {
  const names = [...new Set([...lightMap.keys(), ...darkMap.keys()])].sort();
  const shared = names.filter((name) => lightMap.get(name) === darkMap.get(name));
  const only = (map, other) => names.filter((name) => map.has(name) && map.get(name) !== other.get(name)).map((name) => [name, map.get(name)]);
  return block(scope, shared.map((name) => [name, lightMap.get(name)]), indent)
    + block(`${scope}[data-effective-theme="light"]`, only(light === lightMap ? light : lightMap, darkMap), indent)
    + block(`${scope}[data-effective-theme="dark"]`, only(darkMap, lightMap), indent);
};

let output = `/* Generated by scripts/sync-codex-tokens.mjs from ${sheet}. Do not edit by hand. */\n`
  + '.app-shell[data-effective-theme="light"] { --theme-variant: light; --lightningcss-light: initial; --lightningcss-dark: ; }\n'
  + '.app-shell[data-effective-theme="dark"] { --theme-variant: dark; --lightningcss-light: ; --lightningcss-dark: initial; }\n'
  + emit(light, dark, '.app-shell');
for (const [wrapper, bucket] of WRAPPERS) {
  const inner = emit(bucket.light, bucket.dark, '.app-shell', '  ');
  if (inner) output += `${wrapper} {\n${inner}}\n`;
}
await writeFile(new URL('apps/desktop/src/styles/codex-tokens.css', root), output);
console.log(`codex-tokens.css: ${light.size} light / ${dark.size} dark tokens`);
