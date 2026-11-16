import { afterAll, expect, test } from 'bun:test';
import { plugin } from 'bun';
import { transformSync } from '@babel/core';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import type { ViewerDocument } from '../apps/desktop/src/types';
import type { ShellActions } from '../apps/desktop/src/components/types';
plugin({ name: 'geometry-react-compiler', setup(build) {
  build.onLoad({ filter: /(?:use-geometry-live-preview\.ts|constraint-toggle\.tsx)$/u }, ({ path }) => {
    let compiled = false;
    const result = transformSync(readFileSync(path, 'utf8'), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ['typescript', 'jsx'] }, plugins: [['babel-plugin-react-compiler', {
        logger: { logEvent: (_file: string, event: { kind: string }) => { if (event.kind === 'CompileSuccess') compiled = true; } },
      }]] });
    if (path.endsWith('use-geometry-live-preview.ts') && !compiled) throw new Error('Geometry hook did not compile.');
    return { contents: result!.code!, loader: 'tsx' };
  });
} });
const browser = new Window({ url: 'http://localhost/' });
const previous = new Map<string, PropertyDescriptor | undefined>(), frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, CSS: browser.CSS, Event: browser.Event,
  MutationObserver: browser.MutationObserver, CustomEvent: browser.CustomEvent, getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
  cancelAnimationFrame: (id: number) => { frames.delete(id); }, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} await browser.happyDOM.close(); });
const { createRoot } = await import('react-dom/client');
const { useGeometryLivePreview } = await import('../apps/desktop/src/hooks/use-geometry-live-preview');
const { ConstraintToggle } = await import('../apps/desktop/src/components/workbench/constraint-toggle');
const { geometryBase, geometryText, withInternalCoordinate } = await import('../apps/desktop/src/lib/geometry-editing');
const flush = async () => act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); });
const water = '3\nwater\nO 0 0 0\nH 0.957200000123 0 0\nH -0.24 0.927 0\n';
let identity = 0;
const doc = () => ({ id: `geometry-${++identity}`, path: `/g-${identity}.xyz`, title: 'g.xyz', extension: 'xyz', renderer: 'molstar' }) as ViewerDocument;
const { captureViewerActionTarget } = await import('../apps/desktop/src/lib/viewer-bridge');
const bindings = new WeakMap<ViewerDocument, import('../apps/desktop/src/lib/geometry-binding').GeometryBinding>();
function bindingFor(current: ViewerDocument) {
  let binding = bindings.get(current);
  if (!binding) {
    if (!document.querySelector(`.viewer-iframe[data-document-id="${current.id}"]`)) {
      const frame = document.createElement('iframe'); frame.className = 'viewer-iframe';
      frame.dataset.documentId = current.id; frame.dataset.renderer = 'molstar'; document.body.append(frame);
    }
    binding = { lease: `test-owner-${current.id}`, text: water, target: captureViewerActionTarget(current.id)! };
    bindings.set(current, binding);
  }
  return binding;
}
function transport() {
  const calls: { document: ViewerDocument; text: string; resolve: () => void; reject: (error: Error) => void }[] = [];
  const send: ShellActions['runStructureViewerAction'] = (document, action) => new Promise<void>((resolve, reject) => {
    if (action.type !== 'update_geometry') throw new Error('Unexpected viewer action');
    calls.push({ document, text: action.text, resolve, reject });
  });
  return { calls, send };
}
async function mount(documentValue: ViewerDocument, send: ShellActions['runStructureViewerAction']) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let api!: ReturnType<typeof useGeometryLivePreview>; const errors: unknown[] = [];
  function Probe({ current }: { current: ViewerDocument }) { api = useGeometryLivePreview(current, bindingFor(current), send, error => errors.push(error)); return null; }
  const render = async (current: ViewerDocument) => act(async () => root.render(<Probe current={current} />));
  await render(documentValue);
  return { api: () => api, errors, render, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const ack = async (call: ReturnType<typeof transport>['calls'][number]) => act(async () => call.resolve());

export { test, expect, React, act, createRoot, useGeometryLivePreview, ConstraintToggle,
  geometryBase, geometryText, withInternalCoordinate, flush, water, doc, transport, mount, ack, bindingFor, browser };
export type { ViewerDocument, ShellActions };
