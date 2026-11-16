import assert from 'node:assert/strict';
import { plugin } from 'bun';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { molstarBuildPlugins } from '../scripts/molstar-build-plugins.mjs';
import { molstarPatchPlugin, readMolstarModule } from '../scripts/molstar-source.mjs';
import { patchMolstarCameraParams, patchMolstarCameraSettings } from '../scripts/molstar-camera-controls.mjs';

for (const adapter of molstarBuildPlugins) {
  plugin(adapter.name === 'molstar-live-camera-settings'
    ? molstarPatchPlugin('test-live-camera-settings', '@molstar/plugin-ui/viewport/simple-settings', source =>
      `${patchMolstarCameraSettings(source)}\nexport { SimpleSettingsMapping as testMapping };`)
    : adapter);
}
const browser = new Window();
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? browser : browser[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const { ParamDefinition: PD } = await import('@molstar/core/util/param-definition');
const { Canvas3DParams, Canvas3DContext } = await import('@molstar/graphics/canvas3d/canvas3d');
const { PluginCommandManager } = await import('@molstar/plugin/command');
const { PluginCommands } = await import('@molstar/plugin/commands');
const { NumberRangeControl } = await import('@molstar/plugin-ui/controls/parameters');
const { testMapping: mapping } = await import('@molstar/plugin-ui/viewport/simple-settings');
const canvas = PD.getDefaultValues(Canvas3DParams);
const calls = [], layouts = [], contexts = [];
const ctx = {
  commands: new PluginCommandManager(),
  canvas3d: { props: canvas, graphics: { capabilities: { backend: 'webgl2' } } },
  canvas3dContext: { props: PD.getDefaultValues(Canvas3DContext.Params), setProps: value => contexts.push(value) },
  spec: {}, config: { get: () => undefined }, graphicsBackends: [],
  layout: { state: { regionState: { top: 'full', bottom: 'full', left: 'full', right: 'full' } } },
  behaviors: { layout: { leftPanelTabName: { value: 'root' } } },
};
PluginCommands.Canvas3D.SetSettings.subscribe(ctx, ({ settings }) => {
  calls.push(structuredClone(settings));
  for (const [key, value] of Object.entries(settings)) {
    canvas[key] = typeof value === 'object' ? { ...canvas[key], ...value } : value;
  }
});
PluginCommands.Layout.Update.subscribe(ctx, value => layouts.push(value));
const values = () => mapping.getValues(mapping.getTarget(ctx), ctx);
const apply = async edit => {
  const next = structuredClone(values()); edit(next);
  await mapping.apply(mapping.update(next, ctx), ctx);
};
const params = mapping.params(ctx);
const cases = [
  ['fov', params.camera.params.fov, value => value.camera.fov, (next, value) => { next.camera.fov = value; }, 'camera'],
  ['intensity', params.lighting.params.fog.map('on').params.intensity, value => value.lighting.fog.params.intensity,
    (next, value) => { next.lighting.fog.params.intensity = value; }, 'cameraFog'],
  ['radius', params.clipping.params.radius, value => value.clipping.radius,
    (next, value) => { next.clipping.radius = value; }, 'cameraClipping'],
  ['minNear', params.clipping.params.minNear, value => value.clipping.minNear,
    (next, value) => { next.clipping.minNear = value; }, 'cameraClipping'],
];
const mount = document.createElement('div'); document.body.append(mount);
const root = createRoot(mount);
const mouse = (type, x) => {
  const event = new MouseEvent(type, { button: 0, clientX: x, bubbles: true });
  // happy-dom does not derive pageX from clientX; Mol* reads the page coordinate.
  Object.defineProperty(event, 'pageX', { value: x });
  return event;
};
try {
  for (const [name, param, read, edit, setting] of cases) {
    const control = new NumberRangeControl({ name, param, value: read(values()), onChange: e => {
      const next = structuredClone(values()); edit(next, e.value);
      void mapping.apply(mapping.update(next, ctx), ctx);
    } });
    await act(async () => root.render(React.cloneElement(control.renderControl(), { key: name })));
    const slider = mount.querySelector('.msp-slider-base');
    Object.defineProperty(slider, 'clientWidth', { value: 200 });
    slider.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 20 });
    const before = calls.length;
    await act(async () => slider.dispatchEvent(mouse('mousedown', 40)));
    for (const clientX of [70, 100, 150]) {
      await act(async () => document.dispatchEvent(mouse('mousemove', clientX)));
      assert.equal(read(values()), Number(mount.querySelector('input').value), `${name} applies before mouseup`);
      assert.deepEqual(Object.keys(calls.at(-1)), [setting], `${name} sends only its canvas group`);
    }
    assert.ok(calls.length >= before + 3, `${name} produces live intermediate values`);
    const final = read(values()), liveCalls = calls.length;
    await act(async () => document.dispatchEvent(mouse('mouseup', 150)));
    assert.equal(read(values()), final, `${name} retains the final value`);
    assert.equal(calls.length, liveCalls, 'the end event does not redraw an unchanged value');
    assert.equal(layouts.length, 0, 'camera drags do not update panel layout');
    assert.equal(contexts.length, 0, 'camera drags do not update graphics-context settings');
  }
  // A mixed edit must keep the original full mapping path, including layout.
  await apply(next => { next.camera.fov = 40; next.background.transparent = true; });
  assert.equal(canvas.camera.fov, 40);
  assert.equal(canvas.transparentBackground, true);
  assert.equal(layouts.length, 1);
  assert.equal(contexts.length, 1);
  assert.ok(Object.keys(calls.at(-1)).length > 4);
  await apply(next => { next.lighting.fog = { name: 'off', params: {} }; });
  assert.equal(canvas.cameraFog.name, 'off');
  assert.equal(layouts.length, 2, 'fog toggle preserves its original mapping');
  assert.equal(Canvas3DParams.sceneRadiusFactor.immediateUpdate, undefined, 'unrelated geometry controls remain commit-only');
  await act(async () => root.unmount());
  const closedCalls = calls.length;
  document.dispatchEvent(mouse('mousemove', 190));
  assert.equal(calls.length, closedCalls, 'completed sliders leave no delayed update after closing');
  for (const [specifier, patch] of [
    ['@molstar/graphics/canvas3d/canvas3d', patchMolstarCameraParams],
    ['@molstar/plugin-ui/viewport/simple-settings', patchMolstarCameraSettings],
  ]) {
    const source = await readMolstarModule(specifier);
    assert.throws(() => patch(patch(source)), /changed;/, 'upstream adaptation fails closed');
  }
  console.log('Camera controls: live pointer updates, narrow canvas settings, final value and full-setting fallback passed');
} finally {
  await act(async () => root.unmount());
  ctx.commands.dispose();
  await browser.happyDOM.close();
}
