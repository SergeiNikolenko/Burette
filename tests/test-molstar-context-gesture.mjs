import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DefaultFocusLociBindings } = require('molstar/lib/commonjs/mol-plugin/behavior/dynamic/camera.js');
const { Binding } = require('molstar/lib/commonjs/mol-util/binding.js');
const { ButtonsType, ModifiersKeys } = require('molstar/lib/commonjs/mol-util/input/input-observer.js');
const cameraFocus = { params: { bindings: DefaultFocusLociBindings } };

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const install = source.match(/\n  function installMolstarContextMenu\(viewer\) \{[\s\S]*?\n  \}/)[0];
const listeners = new Map();
let opened = 0;
let visible = false;
const canvas = {};
const context = vm.createContext({
  Element: class {},
  viewer: { plugin: { state: { behaviors: { cells: new Map([['focus', {
    transform: { transformer: { id: 'camera-focus-loci' } }, obj: { data: cameraFocus }
  }]]) } } } },
  document: {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, fn); },
    removeEventListener() {},
    querySelector: () => visible ? {} : null,
  },
  window: { addEventListener() {}, removeEventListener() {}, requestAnimationFrame() {} },
  molstarContextMenuCleanup: null, molstarSelectionPreviewCleanup: null,
  molstarPreviewRevealStart: null, molstarContextMenuMode: 'residue',
  MOLSTAR_CONTEXT_MENU_DRAG_THRESHOLD_PX: 4,
  activeViewer: null,
  beginMolstarSelectionPreserve() {}, finishMolstarSelectionPreserve() {},
  isMolstarContextMenuTarget: target => target === canvas,
  molstarContextPickFromEvent: () => ({ loci: {} }),
  captureMolstarCameraSnapshot: () => null,
  hideMolstarContextMenu: () => { visible = false; },
  showMolstarContextMenu: () => { opened++; visible = true; },
  hideMolstarMoleculePreview() {},
  clearMolstarPersistentMoleculePreview() {},
});
vm.runInContext(`${install}; installMolstarContextMenu(viewer);`, context);
for (const binding of Object.values(cameraFocus.params.bindings)) {
  assert.equal(Binding.match(binding, ButtonsType.Flag.Secondary, ModifiersKeys.create()), false,
    'secondary clicks must not start camera focus or reset');
}
assert.equal(Binding.match(cameraFocus.params.bindings.clickCenterFocus,
  ButtonsType.Flag.Primary, ModifiersKeys.create()), true, 'primary focus remains available');
const emit = (type, overrides = {}) => {
  const event = { type, button: 2, buttons: 2, pointerId: 1, target: canvas,
    clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {}, ...overrides };
  listeners.get(type)(event);
};

// Press-time contextmenu must retain the pending gesture until release.
emit('pointerdown');
emit('contextmenu');
assert.equal(opened, 0);
emit('pointerup', { buttons: 0 });
assert.equal(opened, 1);
emit('contextmenu', { buttons: 0 });
assert.equal(opened, 1, 'release-time contextmenu must not duplicate the menu');

for (const contextOnPress of [false, true]) {
  emit('pointerdown');
  if (contextOnPress) emit('contextmenu');
  emit('pointermove', { clientX: 120 });
  emit('pointerup', { clientX: 120, buttons: 0 });
  emit('contextmenu', { clientX: 120, buttons: 0 });
  assert.equal(opened, 1, 'a drag must never open a menu');
  assert.equal(visible, false);
}
emit('pointerdown');
emit('pointercancel');
emit('contextmenu', { buttons: 0 });
assert.equal(opened, 1);
emit('contextmenu', { button: 0, buttons: 0 });
assert.equal(opened, 2, 'keyboard context menu remains available');
context.molstarContextMenuCleanup();
assert.equal(cameraFocus.params.bindings, DefaultFocusLociBindings, 'cleanup restores original bindings');
console.log('Context gesture: hold, release, drag, cancellation and keyboard passed.');
