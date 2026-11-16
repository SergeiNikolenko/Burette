import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act, useEffect, useMemo, useRef, useState } from 'react';
import { Window } from 'happy-dom';

const browser = new Window();
for (const key of ['CSS', 'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MutationObserver', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? browser : browser[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const { useAppMolstarActionSenders } = await import('../apps/desktop/src/hooks/use-app-molstar-action-senders.ts');
const { activeViewerIframeForDocument } = await import('../apps/desktop/src/lib/viewer-bridge.ts');
const source = readFileSync('apps/desktop/src/components/structure-info-panel.tsx', 'utf8');
const start = source.indexOf('  const displayedOpacity = useRef(');
const end = source.indexOf('  const applyColor = ', start);
assert.ok(start >= 0 && end > start);
const normalizeStart = source.indexOf('function normalizeSdfContextOpacity(');
const normalizeEnd = source.indexOf('\nfunction ', normalizeStart + 1);
const transpiler = new Bun.Transpiler({ loader: 'ts' });
// Run the production gesture code with real React lifecycle hooks. Only the
// frame clock and outbound action/storage boundaries are controlled here.
const useOpacity = new Function('useMemo', 'useEffect', 'useRef', 'opacity', 'window', 'document', 'actions', 'setOpacity',
  'writeSdfContextOpacityPreference', 'activeViewerIframeForDocument', `
  const SDF_CONTEXT_OPACITY_MIN = 0.04, SDF_CONTEXT_OPACITY_MAX = 1, SDF_CONTEXT_OPACITY_DEFAULT = 0.4;
  ${transpiler.transformSync(source.slice(normalizeStart, normalizeEnd))}
  ${transpiler.transformSync(source.slice(start, end))}
  return { input: applyOpacity, commit: opacityUpdates.commit };`);
const frames = new Map();
let frameId = 0;
const sent = [], stored = [], errors = [];
const pushStatus = (...args) => errors.push(args);
function addFrame(id) {
  const frame = browser.document.createElement('iframe');
  frame.className = 'viewer-iframe';
  frame.dataset.documentId = id;
  browser.document.body.append(frame);
  frame.contentWindow.postMessage = message => sent.push([id, message.body.action.opacity]);
  return frame;
}
let control, displayed, externalOpacity;
function Harness({ document }) {
  const [opacity, setOpacity] = useState(0.4);
  externalOpacity = setOpacity;
  const actions = useAppMolstarActionSenders({ activeDocument: document, documents: [document], activeViewerIframeForDocument, pushStatus });
  displayed = opacity;
  control = useOpacity(useMemo, useEffect, useRef, opacity, browser, document, actions, setOpacity,
    (owner, value) => stored.push([owner.id, value]), activeViewerIframeForDocument);
  return null;
}
const element = browser.document.createElement('div');
browser.document.body.append(element);
const root = createRoot(element);
try {
  const a = { id: 'a', renderer: 'molstar', title: 'A' }, b = { id: 'b', renderer: 'molstar', title: 'B' };
  const frameA = addFrame(a.id), frameB = addFrame(b.id);
  browser.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  browser.cancelAnimationFrame = id => frames.delete(id);
  await act(async () => root.render(React.createElement(Harness, { document: a })));
  for (let frame = 0; frame < 4; frame++) {
    const value = 0.2 + frame * 0.1;
    await act(async () => { control.input(value - 0.01); control.input(value); });
    assert.equal(displayed, value);
    assert.equal(frames.size, 1, 'one scheduled send regardless of input frequency');
    await act(async () => {
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(frame * 16);
    });
    assert.equal(sent.length, frame + 1, 'scene updates before the gesture ends');
    assert.deepEqual(sent.at(-1), ['a', value]);
    assert.equal(stored.length, 0, 'persistence waits for commit');
  }
  await act(async () => { control.input(0.9); control.commit(); });
  assert.deepEqual(sent.at(-1), ['a', 0.9]);
  assert.deepEqual(stored, [['a', 0.9]]);
  assert.equal(frames.size, 0);
  await act(async () => externalOpacity(0.5));
  const beforeExternalReturn = sent.length;
  await act(async () => { control.input(0.9); control.commit(); });
  assert.equal(sent.length, beforeExternalReturn + 1, 'external changes must not suppress a previously sent value');
  assert.deepEqual(sent.at(-1), ['a', 0.9]);
  await act(async () => control.input(0.7));
  await act(async () => root.render(React.createElement(Harness, { document: b })));
  assert.deepEqual(sent.at(-1), ['a', 0.7], 'document switch flushes to the old owner');
  assert.deepEqual(stored.at(-1), ['a', 0.7]);
  assert.equal(frames.size, 0, 'no stale callback can update the new document');
  await act(async () => control.input(0.6));
  frameB.remove();
  const sentBeforeClose = sent.length;
  await act(async () => root.unmount());
  assert.equal(sent.length, sentBeforeClose, 'removed iframe receives no cleanup action');
  assert.deepEqual(stored.at(-1), ['b', 0.6]);
  assert.deepEqual(errors, [], 'closing a viewer does not report an Open in main viewer error');
  assert.equal(frames.size, 0);
  frameA.remove();
  console.log('Inspector opacity: live frames, final commit, owner change and cleanup passed');
} finally {
  await act(async () => root.unmount());
  await browser.happyDOM.close();
}
