import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { molstarContextMenuItems } from '../apps/desktop/src/components/molstar-context-menu.ts';

const window = new Window();
const document = window.document;
new Function('window', 'document', 'Event', 'XMLSerializer', 'crypto', readFileSync('PreviewExtension/Web/native-viewer-menus.js', 'utf8'))(window, document, window.Event, window.XMLSerializer, crypto);
const viewer = readFileSync('PreviewExtension/Web/viewer.js', 'utf8');
const source = name => {
  const start = viewer.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  return viewer.slice(start, viewer.indexOf('\n  }', start) + 4);
};
const controls = new Function('document', `
  ${['sceneTreeMenuItem', 'sceneTreeMenuSection', 'sceneTreeMenuSelect', 'sceneTreeMenuSlider', 'sceneTreeMenuThemePicker'].map(source).join('\n')}
  return { sceneTreeMenuItem, sceneTreeMenuSection, sceneTreeMenuSelect, sceneTreeMenuSlider, sceneTreeMenuThemePicker };
`)(document);
const events = [];
document.addEventListener('input', event => events.push(['input', event.target.value]));
document.addEventListener('change', event => events.push(['change', event.target.value]));
const fixture = () => {
  const menu = document.createElement('div');
  menu.id = 'buret-scene-tree-menu'; menu.dataset.ref = 'water-point';
  const focus = controls.sceneTreeMenuItem('Focus', 'focus');
  focus.onclick = () => events.push(['focus', focus.closest('[data-ref]').dataset.ref]);
  menu.append(focus);
  const disabled = controls.sceneTreeMenuItem('Unavailable', 'disabled'); disabled.disabled = true; menu.append(disabled);
  controls.sceneTreeMenuSelect(menu, 'Type', 'representation-type', [
    { name: 'point', label: 'Point' }, { name: 'ball-and-stick', label: 'Ball & Stick' },
  ], 'point');
  controls.sceneTreeMenuSlider(menu, 'Opacity', 'opacity', 50);
  controls.sceneTreeMenuThemePicker(menu, 'Theme', 'representation-color', [
    { name: 'uniform', label: 'Uniform' }, { name: 'element-symbol', label: 'Element Symbol' },
  ], 'uniform');
  menu.insertAdjacentHTML('beforeend', '<div class="buret-tree-swatches"><button data-scene-tree-color="16711680" aria-pressed="true">Red</button></div><details><summary>Advanced</summary><label><span>Quality</span><select><option value="auto">Auto</option><option value="high">High</option></select></label></details>');
  document.body.append(menu);
  const session = window.BuretteNativeViewerMenus.create(menu, {
    color: (control, value) => events.push(['color', control.closest('[data-ref]').dataset.ref, value]),
    finishControl: control => events.push(['commit', control.value]),
    close: () => menu.remove(),
  });
  const items = molstarContextMenuItems(session.items, (id, value) => session.handlers.get(id)?.(value));
  return { menu, session, items };
};
let { menu, session, items } = fixture();
assert.deepEqual(Array.from(items, item => item.kind), ['item', 'item', 'select', 'number', 'select', 'swatches', 'submenu']);
assert.equal(items[1].disabled, true);
assert.equal(items[2].value, 'point');
assert.deepEqual(items[2].optionLabels, { point: 'Point', 'ball-and-stick': 'Ball & Stick' });
assert.equal(items[6].items[0].label, 'Quality');
items[3].action(65); items[3].action(70);
items[5].action('#123456');
assert.deepEqual(events, [['input', '65'], ['input', '70'], ['color', 'water-point', 0x123456]]);
session.close();
assert.deepEqual(events.slice(-2), [['change', '70'], ['commit', '70']]);
assert.equal(menu.isConnected, false);

({ menu, session, items } = fixture());
items[2].action('ball-and-stick');
assert.equal(menu.querySelector('select').value, 'point', 'Commands wait for AppKit tracking to finish');
session.close();
assert.deepEqual(events.at(-1), ['change', 'ball-and-stick']);

({ menu, session, items } = fixture());
menu.querySelector('[data-scene-tree-picker]').onclick = () => events.push(['theme-open']);
menu.querySelector('[data-scene-tree-picker-value="element-symbol"]').onclick = () => events.push(['theme-chosen']);
items[4].action('element-symbol'); session.close();
assert.deepEqual(events.slice(-2), [['theme-open'], ['theme-chosen']]);

({ menu, session, items } = fixture());
items[0].action(); session.close();
assert.deepEqual(events.at(-1), ['focus', 'water-point']);
({ menu, session } = fixture());
menu.style.visibility = 'hidden'; menu.setAttribute('aria-hidden', 'true');
session.fallback();
assert.equal(menu.style.visibility, ''); assert.equal(menu.hasAttribute('aria-hidden'), false);
menu.remove();

// A Composition object picker is attached after openSceneTreeMenu returns.
// Defer native presentation to include it and route changes to the exact object.
assert.match(source('openSceneTreeMenu'), /queueMicrotask\(\(\) => showNativeViewerMenu/);
assert.doesNotMatch(source('openViewportMenu'), /showNativeViewerMenu/, 'toolbar popovers stay in the viewer, not NSMenu');
assert.doesNotMatch(source('showMolstarPresetMenu'), /showNativeViewerMenu/, 'toolbar popovers stay in the viewer, not NSMenu');
assert.doesNotMatch(source('showGenerate3DMenu'), /showNativeViewerMenu/, 'toolbar popovers stay in the viewer, not NSMenu');
console.log('Native scene/rail adapter: scoped actions, disabled rows, types, themes, live sliders, colour, undo and fallback passed');

// Toolbar popovers use their original DOM actions even in a native-capable host.
{
  const dom = new Window();
  dom.document.body.innerHTML = `<div id="buret-toolbar">
    <button data-buret-action="generate-3d-conformer"></button>
    <button data-buret-molstar-preset-trigger></button></div>
    <div data-buret-generate-3d-menu class="hidden"><button role="menuitem">Generate</button></div>
    <div data-buret-molstar-preset-menu class="hidden"><button aria-checked="true">Auto</button></div>
    <div id="buret-viewport-rail"><button aria-expanded="false">Camera</button></div>`;
  const noOp = () => {};
  const bindings = { document: dom.document, window: dom, activeConfig: {},
    positionGenerate3DMenu: noOp, positionMolstarPresetMenu: noOp, positionOpenViewportMenu: noOp,
    populateMolstarPresetMenu: noOp, updateMolstarPresetControl: noOp, hideMolstarPresetPreview: noOp,
    configuredMolstarPreset: () => 'automatic', focusMolstarPresetControl: noOp,
    setMolstarPresetMenuRovingItem: (_menu, item) => item,
    showNativeViewerMenu: () => { throw Error('toolbar must not enter NSMenu'); } };
  const names = ['showGenerate3DMenu', 'hideGenerate3DMenu', 'showMolstarPresetMenu', 'hideMolstarPresetMenu', 'openViewportMenu', 'closeViewportMenu'];
  const menus = new Function(...Object.keys(bindings), names.map(source).join('\n') + `;return {${names.join(',')}}`)(...Object.values(bindings));
  const generate = dom.document.querySelector('[data-buret-action]');
  const preset = dom.document.querySelector('[data-buret-molstar-preset-trigger]');
  const camera = dom.document.querySelector('#buret-viewport-rail button');
  menus.showGenerate3DMenu(null);
  assert.ok(dom.document.querySelector('[data-buret-generate-3d-menu]').classList.contains('hidden'));
  menus.showGenerate3DMenu(generate);
  assert.equal(generate.getAttribute('aria-expanded'), 'true');
  menus.showMolstarPresetMenu(preset);
  assert.equal(generate.getAttribute('aria-expanded'), 'false');
  assert.equal(preset.getAttribute('aria-expanded'), 'true');
  menus.openViewportMenu(camera, 'Camera', menu => { menu.textContent = 'Reset view'; });
  assert.equal(preset.getAttribute('aria-expanded'), 'false');
  assert.equal(camera.getAttribute('aria-expanded'), 'true');
  assert.equal(dom.document.querySelector('#buret-viewport-menu').textContent, 'Reset view');
  menus.showGenerate3DMenu(generate);
  assert.equal(camera.getAttribute('aria-expanded'), 'false');
  assert.equal(dom.document.querySelector('#buret-viewport-menu'), null);
  await dom.happyDOM.abort();
}
console.log('in-viewer toolbar menus preserve DOM behavior and mutual exclusion');

// The real postMessage route releases its listener on cancellation/fallback,
// ignores another frame, and runs commands only after the native popup closes.
({ menu } = fixture());
let payload;
window.BuretteNativeViewerMenus.show(menu, {
  x: 12, y: 30, post: body => { payload = body; return true; }, close: () => menu.remove(),
});
const reply = (event, source = window.parent) => window.dispatchEvent(new window.MessageEvent('message', {
  source, data: { source: 'burette-host', body: { type: 'molstarContextMenuResult', requestId: payload.requestId, ...event } },
}));
const before = events.length;
reply({ event: 'select', id: payload.items[0].id }, null);
reply({ event: 'closed' }, null);
assert.equal(events.length, before);
reply({ event: 'select', id: payload.items[0].id });
assert.equal(events.length, before);
reply({ event: 'closed' });
assert.deepEqual(events.at(-1), ['focus', 'water-point']);
assert.equal(menu.isConnected, false);
reply({ event: 'select', id: payload.items[0].id });
assert.equal(events.length, before + 1);
console.log('Native menu postMessage lifecycle and source isolation passed');

// Render the actual React Grid Actions menu, including mixed button/select
// rows, then pass its native description through the host parser.
const frame = document.createElement('iframe'); document.body.append(frame);
const gridWindow = frame.contentWindow;
gridWindow.BuretteConfig = { appViewer: true };
gridWindow.eval(readFileSync('PreviewExtension/Web/grid-ui.js', 'utf8'));
let gridSession;
gridWindow.BuretteNativeViewerMenus = {
  show(menu) {
    gridSession = window.BuretteNativeViewerMenus.create(menu, { close: () => {} });
    return true;
  },
};
const gridRoot = gridWindow.document.createElement('div'); gridWindow.document.body.append(gridRoot);
const gridActions = [];
const props = new Proxy({ format: 'sdf', selectedCount: 1, selectableCount: 2,
  viewMode: 'cards', cardRenderer: 'rdkit', sortOptions: [{ value: 'index', label: 'File order' }],
  xyzrenderPresetOptions: [], clusterEnabled: true, clusterCutoff: 0.7,
  exportEnabled: true, selectionEnabled: true, semiempiricalMethod: 'RM1',
  conformerVariant: 'ETKDGv3', mmffVariant: 'MMFF94', exportScopeLabel: 'all',
}, { get(target, key) { return key in target ? target[key] : String(key).startsWith('on') ? value => gridActions.push([key, value]) : false; } });
for (const [, key] of readFileSync('apps/desktop/src/preview-grid/grid-ui.tsx', 'utf8').matchAll(/props\.(on\w+)/g)) {
  if (key !== 'onRun') props[key] = value => gridActions.push([key, value]);
}
gridWindow.BuretteGridUI.mountGridControls(gridRoot, props);
const trigger = [...gridRoot.querySelectorAll('button')].find(button => button.textContent === 'Actions');
trigger.click(); await window.happyDOM.whenAsyncComplete();
assert.ok(gridSession, 'Grid Actions requested native presentation');
const gridItems = molstarContextMenuItems(gridSession.items, (id, value) => gridSession.handlers.get(id)?.(value));
assert.ok(gridItems.some(item => item.kind === 'item' && item.text.endsWith('.smi')));
assert.ok(gridItems.some(item => item.kind === 'item' && item.text.endsWith('.csv')));
assert.ok(gridItems.some(item => item.kind === 'item' && /Cluster/.test(item.text)), 'Mixed row retains its command');
const cutoff = gridItems.find(item => item.kind === 'select' && item.label === 'Tanimoto similarity cutoff');
assert.ok(cutoff, 'Mixed row retains its choice');
cutoff.action('0.80'); gridSession.close();
assert.ok(gridActions.some(([key, value]) => key === 'onClusterCutoffChange' && value === 0.8));
await window.happyDOM.abort(); frame.remove();
console.log('React Grid Actions native dispatch preserves commands and controlled selects');
