import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { molstarContextMenuItems } from '../apps/desktop/src/components/molstar-context-menu.ts';
import { buildCodexThemeVariables } from '../apps/desktop/src/lib/codex-theme.ts';

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
// Style keeps the viewer's real radio model while consuming the shared menu
// surface, checked icon and theme engine. Styling must not reset focus/selection.
{
  const bindings = { document,
    APP_ICON_DATA: { Check: [] }, sceneTreeIconElement: () => document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    MOLSTAR_APPEARANCE_OPTIONS: [{ value: 'standard', label: 'Standard' }, { value: 'illustrative', label: 'Illustrative' }],
    MOLSTAR_PRESET_OPTIONS: [{ value: 'automatic', label: 'Auto' }, { value: 'spacefill', label: 'Spacefill', group: 'Atoms' }],
    normalizeMolstarAppearance: value => value,
  };
  const names = ['appendMolstarPresetMenuSeparator', 'appendMolstarAppearanceMenu', 'populateMolstarPresetMenu', 'updateMolstarAppearanceControl', 'setMolstarPresetMenuRovingItem'];
  const api = new Function(...Object.keys(bindings), names.map(source).join('\n') + `;return {${names.join(',')}}`)(...Object.values(bindings));
  const menu = document.createElement('div'); document.body.append(menu);
  api.populateMolstarPresetMenu(menu);
  api.populateMolstarPresetMenu(menu);
  const rows = [...menu.querySelectorAll('[role="menuitemradio"]')];
  assert.deepEqual(rows.map(row => [row.textContent, row.className, row.querySelector('svg')?.classList.contains('atlas-menu-check')]), [
    ['Standard', 'atlas-menu-item', true], ['Illustrative', 'atlas-menu-item', true],
    ['Auto', 'atlas-menu-item', true], ['Spacefill', 'atlas-menu-item', true],
  ]);
  api.updateMolstarAppearanceControl(menu, 'illustrative');
  api.setMolstarPresetMenuRovingItem(menu, rows[1]).focus();
  const custom = { accent: '#339cff', background: '#203040', foreground: '#fafafa', contrast: 72 };
  window.BuretteNativeViewerMenus.styleMenu(menu, { dark: custom }, 'dark');
  const expected = buildCodexThemeVariables({ accent: custom.accent, surface: custom.background, ink: custom.foreground, contrast: custom.contrast }, 'dark');
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map(key => [key, menu.style.getPropertyValue(key)])), expected);
  window.BuretteNativeViewerMenus.styleMenu(menu, undefined, 'light');
  assert.equal(menu.dataset.effectiveTheme, 'light');
  assert.equal(document.querySelectorAll('#buret-atlas-menu-styles').length, 1);
  assert.equal(document.activeElement, rows[1]);
  assert.deepEqual(rows.map(row => [row.tabIndex, row.getAttribute('aria-checked')]), [[-1, 'false'], [0, 'true'], [-1, 'false'], [-1, 'false']]);
  const shared = readFileSync('apps/desktop/src/components/ui/dropdown-menu.css', 'utf8').replace('@layer components {', '').replace(/}\s*$/, '');
  assert.ok(document.getElementById('buret-atlas-menu-styles').textContent.endsWith(shared));
  assert.ok(document.getElementById('buret-atlas-menu-styles').textContent.startsWith(
    readFileSync('apps/desktop/src/styles/codex-tokens.css', 'utf8').replaceAll('.app-shell', '.buret-atlas-surface')));
  const popoverSurface = readFileSync('apps/desktop/src/components/ui/popover-surface.css', 'utf8').replace('@layer components {', '').replace(/}\s*$/, '');
  assert.ok(document.getElementById('buret-atlas-menu-styles').textContent.includes(popoverSurface));
  menu.dataset.buretMolstarPresetMenu = '1';
  const preview = document.createElement('div');
  preview.className = 'ready'; preview.tabIndex = 0; document.body.append(preview);
  preview.focus();
  window.BuretteNativeViewerMenus.stylePopover(preview, { dark: custom }, 'dark');
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map(key => [key, preview.style.getPropertyValue(key)])), expected);
  assert.equal(preview.classList.contains('atlas-popover-surface'), true);
  assert.equal(preview.classList.contains('atlas-menu-content'), false);
  window.BuretteNativeViewerMenus.stylePopover(preview, undefined, 'light');
  assert.equal(preview.dataset.effectiveTheme, 'light');
  assert.equal(preview.classList.contains('ready'), true);
  assert.equal(document.activeElement, preview, 'theme updates preserve keyboard preview activation');
  rows[1].focus();
  const placementWindow = { innerWidth: 400, innerHeight: 600,
    BuretteMolstarPresetPreviewController: { computePreviewPlacement: () => ({ placement: 'stacked', left: 12, top: 360, scale: 0.75 }) } };
  const positionMenu = new Function('window', 'document', source('positionMolstarPresetMenu') + '; return positionMolstarPresetMenu;')(placementWindow, document);
  Object.defineProperties(menu, { offsetWidth: { value: 264 }, scrollHeight: { value: 700 } });
  positionMenu({ getBoundingClientRect: () => ({ left: 100, top: 30, bottom: 60 }) });
  const anchoredStyle = menu.style.cssText;
  assert.equal(menu.style.top, '66px');
  assert.ok(parseFloat(menu.style.maxHeight) < 400, 'space reserved before pointer enters menu');
  const position = new Function('window', 'document', 'molstarPresetPreviewElements', source('positionMolstarPresetPreview') + '; return positionMolstarPresetPreview;')(
    placementWindow, document, () => ({ preview }));
  const scrolls = [];
  rows[1].scrollIntoView = options => scrolls.push([menu.style.top, menu.style.maxHeight, options]);
  position(rows[1]);
  rows[1].blur(); position(rows[1]);
  assert.equal(menu.style.cssText, anchoredStyle, 'preview never moves or resizes keyboard/pointer targets');
  assert.deepEqual(scrolls, [], 'preview never scrolls a row away from the pointer');
  assert.equal(preview.style.transform, 'scale(0.75)');
  positionMenu({ getBoundingClientRect: () => ({ left: 100, top: 30, bottom: 60 }) });
  assert.equal(menu.style.cssText, anchoredStyle, 'hiding a preview preserves the same reserved layout');
  menu.remove();
  preview.remove();
}
// Carry the actual scene command's danger state, not a guess based on its label.
{
  const menu = document.createElement('div');
  const remove = controls.sceneTreeMenuItem('Remove', 'remove', { destructive: true });
  const neutral = controls.sceneTreeMenuItem('Remove selection object', 'remove');
  menu.append(remove, neutral);
  let removed = 0;
  remove.onclick = () => removed++;
  const session = window.BuretteNativeViewerMenus.create(menu, { close: () => {} });
  const items = molstarContextMenuItems(session.items, (id, value) => session.handlers.get(id)?.(value));
  assert.deepEqual(items.map(({ text, variant }) => ({ text, variant })), [
    { text: 'Remove', variant: 'destructive' }, { text: 'Remove selection object', variant: undefined },
  ]);
  items[0].action();
  assert.equal(removed, 0, 'native tracking still completes before commands run');
  session.close();
  assert.equal(removed, 1);
}
// Growing the representation submenu near the bottom must re-anchor it, not
// leave the colour list and subsequent controls below the viewport.
{
  const panel = document.createElement('div');
  panel.className = 'buret-molecule-context-submenu';
  panel.dataset.buretRepresentationMenu = '1';
  controls.sceneTreeMenuThemePicker(panel, 'Theme', 'representation-color', [
    { name: 'uniform', label: 'Uniform' },
  ], 'uniform');
  document.body.append(panel);
  const anchor = document.createElement('button');
  anchor.getBoundingClientRect = () => ({ left: 400, right: 600, top: 600 });
  panel._buretTrigger = anchor;
  const list = panel.querySelector('[role="listbox"]');
  panel.getBoundingClientRect = () => ({ width: 224, height: list.hidden ? 251 : 437 });
  const click = new Function('window', 'document', `
    const sceneTreePickerUndoSnapshots = new Map();
    ${['moleculeMenuPositionSubmenu', 'closeSceneTreePicker', 'onSceneTreeClick'].map(source).join('\n')}
    return onSceneTreeClick;
  `)(window, document);
  const trigger = panel.querySelector('[data-scene-tree-picker]');
  click({ target: trigger });
  assert.deepEqual([list.hidden, trigger.getAttribute('aria-expanded'), Number.parseFloat(panel.style.top) + 437],
    [false, 'true', window.innerHeight - 8]);
  click({ target: trigger });
  assert.deepEqual([list.hidden, trigger.getAttribute('aria-expanded'), Number.parseFloat(panel.style.top) + 251],
    [true, 'false', window.innerHeight - 8]);
  panel.remove();
}
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

window.BuretteConfig = { appViewer: true, tauriViewer: false };
({ menu, session, items } = fixture());
items[2].action('ball-and-stick');
assert.equal(menu.querySelector('select').value, 'ball-and-stick', 'browser choices apply before the menu closes');
assert.deepEqual(events.at(-1), ['change', 'ball-and-stick']);
assert.equal(menu.isConnected, true);
items[3].action(40);
const liveEventCount = events.length;
session.close();
assert.deepEqual(events.slice(liveEventCount), [['change', '40'], ['commit', '40']], 'closing only commits the live numeric edit');
delete window.BuretteConfig;

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
trigger.dispatchEvent(new gridWindow.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));
await window.happyDOM.whenAsyncComplete();
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

{
  // Browser surfaces open viewer selects as an in-page list; native hosts keep the system picker.
  const browser = new Window();
  const page = browser.document;
  browser.HTMLElement.prototype.showPopover = function () { this.dataset.open = ''; };
  browser.HTMLElement.prototype.hidePopover = function () { delete this.dataset.open; };
  new Function('window', 'document', 'Event', 'XMLSerializer', 'crypto', readFileSync('PreviewExtension/Web/native-viewer-menus.js', 'utf8'))(browser, page, browser.Event, browser.XMLSerializer, crypto);
  browser.BuretteViewerSelectMenus.install({ checkIcon: () => page.createElement('i') });
  page.body.innerHTML = '<div id="buret-scene-tree-menu"><div class="buret-tree-menu-field"><span>Type</span><select class="buret-select"><option value="point">Point</option><option value="line">Line</option></select></div></div>';
  const menu = page.getElementById('buret-scene-tree-menu');
  const select = page.querySelector('select');
  const changes = [];
  select.addEventListener('change', () => changes.push(select.value));
  page.addEventListener('click', event => { if (!menu.contains(event.target)) changes.push('outside click'); });
  const press = () => {
    const event = new browser.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    select.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(press(), true, 'Browser blocks the system picker');
  const list = menu.querySelector('[role="listbox"]');
  assert.deepEqual([list.getAttribute('aria-label'), select.getAttribute('aria-expanded'),
    ...Array.from(list.querySelectorAll('[role="option"]'), option => [option.textContent, option.getAttribute('aria-selected')])],
  ['Type', 'true', ['Point', 'true'], ['Line', 'false']]);
  list.querySelector('[data-value="line"]').click();
  assert.deepEqual([changes, page.querySelector('[role="listbox"]'), select.hasAttribute('aria-expanded')], [['line'], null, false]);
  browser.BuretteConfig = { tauriViewer: true };
  assert.deepEqual([press(), page.querySelector('[role="listbox"]')], [false, null], 'Native hosts keep the system picker');
  await browser.happyDOM.abort();
  console.log('Browser viewer selects open an in-page list; native hosts keep the system picker');
}
