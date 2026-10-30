import { afterAll, expect, test } from 'bun:test';
import { plugin } from 'bun';
import { transformSync } from '@babel/core';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import React, { act } from 'react';
plugin({ name: 'geometry-react-compiler', setup(build) {
  build.onLoad({ filter: /constraint-toggle\.tsx$/u }, ({ path }) => ({
    contents: transformSync(readFileSync(path, 'utf8'), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ['typescript', 'jsx'] }, plugins: [['babel-plugin-react-compiler', {}]] })!.code!, loader: 'tsx',
  }));
} });
const browser = new Window({ url: 'http://localhost/' });
const previous = new Map<string, PropertyDescriptor | undefined>(), frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, Event: browser.Event,
  MutationObserver: browser.MutationObserver, CustomEvent: browser.CustomEvent, getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
  cancelAnimationFrame: (id: number) => { frames.delete(id); }, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => { await browser.happyDOM.close(); for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
const { createRoot } = await import('react-dom/client');
const { ConstraintToggle } = await import('../apps/desktop/src/components/workbench/constraint-toggle');
const { geometryBase, geometryText, withInternalCoordinate } = await import('../apps/desktop/src/lib/geometry-editing');
const water = '3\nwater\nO 0 0 0\nH 0.957200000123 0 0\nH -0.24 0.927 0\n';
test('Cartesian edits retain unchanged source lines and near-linear transverse precision', () => {
  const base = geometryBase(water), edited = geometryText(base, withInternalCoordinate(base.rows, 1, 0, 1.234567890123));
  expect(edited.split('\n').slice(0, 3)).toEqual(water.split('\n').slice(0, 3));
  expect(geometryBase(edited).rows[1].values[0]).toBeCloseTo(1.234567890123, 11);
  const near = geometryText(base, withInternalCoordinate(base.rows, 2, 1, 179.999999));
  expect(geometryBase(near).rows[2].values[1]).toBeCloseTo(179.999999, 7);
  expect(geometryText(base, base.rows)).toBe(water);
});
test('constraint pin exposes pressed/disabled state and suppresses row click while toggling', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); let toggled = 0, row = 0;
  const render = async (active: boolean, unavailable?: string) => act(async () => root.render(<div onClick={() => row++}><ConstraintToggle label="Freeze atom" active={active} disabled={false} unavailable={unavailable} onToggle={() => toggled++} /></div>));
  try {
    await render(false); const button = host.querySelector('button')!; expect([button.getAttribute('aria-label'), button.getAttribute('aria-pressed')]).toEqual(['Freeze atom', 'false']);
    await act(async () => button.click()); expect([toggled, row]).toEqual([1, 0]);
    await render(true, 'Reference points cannot be frozen'); expect([host.querySelector('button')!.disabled, host.querySelector('button')!.getAttribute('aria-pressed')]).toEqual([true, 'true']);
    await act(async () => host.querySelector('button')!.click()); expect(toggled).toBe(1);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
