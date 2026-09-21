import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { installWorkspaceTooltipLayout } from '../plugins/burette-agent/ui/native-workspace-tooltip-layout.mjs';

test('preview labels avoid the host control, suppress on hover/open and release observers', () => {
  const values = new Map(), attributes = new Set(), listeners = new Map();
  let onResize, onMutation, expanded = false, present = false, removed = false, disconnected = 0;
  let rect = { left: 640, right: 724, top: 280, bottom: 308, width: 84, height: 28 };
  const control = { matches: () => false, getBoundingClientRect: () => rect,
    querySelector: () => expanded ? {} : null, closest: () => control };
  const root = { style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) },
    toggleAttribute: (name, active) => active ? attributes.add(name) : attributes.delete(name), removeAttribute: name => attributes.delete(name) };
  const target = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
  const host = { ...target, document: { ...target, body: {}, querySelector: () => present ? control : null } };
  const style = { remove: () => { removed = true; } };
  const dispose = runInNewContext(`(${installWorkspaceTooltipLayout.toString()})()`, {
    window: { parent: host, innerWidth: 736, frameElement: { getBoundingClientRect: () => ({ left: 0, right: 736, top: 56, bottom: 320 }) } },
    document: { documentElement: root, body: {}, createElement: () => style, head: { appendChild() {} },
      querySelector: () => ({ getBoundingClientRect: () => ({ left: 688, width: 36, height: 160 }) }) },
    ResizeObserver: class { constructor(callback) { onResize = callback; } observe() {} unobserve() {} disconnect() { disconnected++; } },
    MutationObserver: class { constructor(callback) { onMutation = callback; } observe() {} disconnect() { disconnected++; } },
  });
  const state = () => [values.get('--burette-host-control-clearance'), attributes.has('data-burette-host-control-active')];
  assert.deepEqual(state(), ['0px', false]);
  present = true; onMutation();
  assert.deepEqual(state(), ['48px', false], 'late-mounted control reserves a gap above its top');
  assert.equal(values.get('--burette-tooltip-right'), '56px', 'raised label also clears the viewer rail');
  listeners.get('pointerover')({ type: 'pointerover', target: control });
  assert.deepEqual(state(), ['48px', true]);
  expanded = true;
  listeners.get('pointerout')({ type: 'pointerout', relatedTarget: null });
  assert.deepEqual(state(), ['48px', true], 'open menu remains suppressed after pointer leaves trigger');
  expanded = false; onMutation();
  assert.deepEqual(state(), ['48px', false]);
  rect = { ...rect, top: 250, bottom: 278 }; onResize();
  assert.deepEqual(state(), ['78px', false]);
  rect = { ...rect, left: 760, right: 844 }; onResize();
  assert.deepEqual(state(), ['0px', false], 'another dock is not displaced by a non-overlapping control');
  assert.match(style.textContent, /overflow-wrap: anywhere/);
  dispose();
  assert.deepEqual([values.size, attributes.size, listeners.size, disconnected, removed], [0, 0, 0, 3, true]);
});
