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
const constant = name => {
  const start = viewer.indexOf(`  const ${name} = `);
  assert.ok(start >= 0, name);
  return viewer.slice(start, viewer.indexOf(';\n', start) + 2);
};
const cameraViewsSource = constant('VIEWPORT_AXIS_VIEWS');
const controls = new Function('document', `
  ${['sceneTreeMenuItem', 'sceneTreeMenuSection', 'sceneTreeMenuSelect', 'sceneTreeMenuSlider', 'sceneTreeMenuThemePicker'].map(source).join('\n')}
  return { sceneTreeMenuItem, sceneTreeMenuSection, sceneTreeMenuSelect, sceneTreeMenuSlider, sceneTreeMenuThemePicker };
`)(document);
const events = [];
// Screenshot settings remain live Mol* parameters, not an independent form.
// Exercise the real builders and action handlers together with the shared menu.
{
  const helper = {
    values: { resolution: { name: 'viewport' }, format: { name: 'png' }, transparent: false, axes: { name: 'off' } },
    cropParams: { auto: true },
    params: { format: { map: () => ({ defaultValue: { quality: .9 } }) }, axes: { map: () => ({ defaultValue: { scale: 1 } }) } },
    resetCrop() { this.cropReset = true; }, download() { this.saved = true; }, copyToClipboard() { this.copied = true; },
  };
  helper.behaviors = { values: { next: value => { helper.values = value; } }, cropParams: { next: value => { helper.cropParams = value; } } };
  const menu = document.createElement('div'); menu.className = 'buret-tree-menu'; document.body.append(menu);
  const bindings = { window: { BuretteNativeViewerMenus: window.BuretteNativeViewerMenus, isSecureContext: true },
    document, navigator: { clipboard: {} }, activeConfig: {}, resolveViewerTheme: () => 'dark',
    viewportScreenshotHelper: () => helper, setStatus: () => {}, positionOpenViewportMenu: () => {},
    canUseDownloadExportBridge: () => false, cameraAxesParams: () => ({ showPlanes: false }),
    sceneTreeIconElement: () => document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    APP_ICON_DATA: { Check: [], ChevronDown: [] }, VIEWPORT_ICON: { download: [], clipboard: [] },
    VIEWPORT_SCREENSHOT_RESOLUTIONS: [['viewport', 'Viewport'], ['hd', 'HD']],
    VIEWPORT_SCREENSHOT_FORMATS: [['png', 'PNG'], ['jpeg', 'JPEG']],
  };
  const code = ['viewportMenuItem', 'sceneTreeMenuSection', 'viewportScreenshotChoice', 'viewportScreenshotGroup',
    'viewportScreenshotToggle', 'viewportScreenshotMenu', 'viewportMappedDefaults', 'runViewportScreenshotAction'].map(source).join('\n');
  const actions = new Function(...Object.keys(bindings), code + '; return { build: viewportScreenshotMenu, run: runViewportScreenshotAction };')(...Object.values(bindings));
  actions.build(menu);
  assert.equal(menu.classList.contains('buret-tree-menu'), false);
  assert.equal(menu.querySelectorAll('.atlas-menu-check').length, 7);
  const summaries = [...menu.querySelectorAll('summary')];
  const press = key => window.BuretteNativeViewerMenus.moveMenuFocus(menu, new window.KeyboardEvent('keydown', { key, cancelable: true }));
  summaries[0].focus(); press('ArrowDown');
  assert.equal(document.activeElement, summaries[1], 'closed choices are skipped');
  press('ArrowRight');
  const format = summaries[1].parentElement;
  assert.equal(format.open, true);
  assert.equal(document.activeElement.textContent, 'PNG');
  press('ArrowDown');
  const jpeg = document.activeElement;
  assert.equal(jpeg.textContent, 'JPEG');
  assert.equal(actions.run('format', jpeg), true);
  assert.deepEqual([helper.values.format, [...format.querySelectorAll('[role="menuitemradio"]')].map(item => item.getAttribute('aria-checked')),
    format.querySelector('.buret-screenshot-group-value').textContent], [{ name: 'jpeg', params: { quality: .9 } }, ['false', 'true'], 'JPEG']);
  press('ArrowLeft');
  assert.equal(document.activeElement, summaries[1]);
  assert.equal(format.open, false);
  for (const action of ['transparent', 'axes', 'crop']) {
    assert.equal(actions.run(action, menu.querySelector(`[data-buret-viewport-menu="screenshot-${action}"]`)), true);
  }
  assert.deepEqual([helper.values.transparent, helper.values.axes, helper.cropParams, helper.cropReset],
    [true, { name: 'on', params: { scale: 1, showPlanes: false } }, { auto: false }, true]);
  press('End'); assert.equal(document.activeElement.textContent, 'Crop to content');
  assert.equal(actions.run('save'), false); assert.equal(helper.saved, true);
  assert.equal(actions.run('copy'), false); assert.equal(helper.copied, true);
  const exports = [];
  helper.getImageDataUri = async () => 'data:image/png;base64,aW1hZ2U=';
  helper.extension = 'png'; helper.getFilename = extension => `structure.${extension}`;
  const hosted = { ...bindings, canUseDownloadExportBridge: () => true,
    safeDownloadFileName: name => name, postHostMessage: payload => exports.push(payload) };
  const saveHosted = new Function(...Object.keys(hosted), source('runViewportScreenshotAction') + '; return runViewportScreenshotAction;')(...Object.values(hosted));
  assert.equal(saveHosted('save'), false);
  await Promise.resolve();
  assert.deepEqual(exports, [{ type: 'exportData', name: 'structure.png', mimeType: 'image/png', base64: 'aW1hZ2U=' }]);
  menu.remove();
}
// The live compute trigger keeps its label and busy state while consuming the
// same Button/LoadingIndicator source as the shell, including theme changes.
{
  const shell = readFileSync('PreviewExtension/Web/viewer-shell.js', 'utf8');
  const button = document.createElement('div');
  button.innerHTML = shell.match(/<button id="buret-compute-menu-trigger"[\s\S]*?<\/button>/)[0];
  const trigger = button.firstElementChild;
  document.body.append(trigger);
  const bindings = { window, activeConfig: { renderer: 'molstar' }, normalizeRenderer: value => value,
    canGenerate3DConformerFromConfig: () => true, resolveViewerTheme: () => 'dark' };
  const apply = new Function(...Object.keys(bindings), 'generate3dPending', 'generate3dPendingMode', 'button',
    source('applyGenerate3DPendingState') + '; applyGenerate3DPendingState(button);');
  for (const [pending, mode, text] of [[true, 'ensemble', 'Generating set...'], [true, 'single', 'Generating 3D...'], [false, 'single', 'Compute']]) {
    apply(...Object.values(bindings), pending, mode, trigger);
    assert.deepEqual([trigger.disabled, trigger.hasAttribute('data-disabled'), trigger.getAttribute('aria-busy'), trigger.querySelector('[data-buret-generate-3d-label]').textContent],
      [pending, pending, String(pending), text]);
    assert.ok(trigger.classList.contains('atlas-button'));
    assert.equal(trigger.querySelector('.atlas-loading-indicator').getAttribute('aria-hidden'), 'true');
  }
  window.BuretteNativeViewerMenus.styleButton(trigger, undefined, 'light');
  assert.equal(trigger.dataset.effectiveTheme, 'light');
  assert.equal(trigger.querySelector('[data-buret-generate-3d-label]').textContent, 'Compute');
  trigger.remove();
}
// Camera keeps real command descriptors/icons; the shared DOM menu adapter
// supplies keyboard traversal without changing click dispatch.
{
  const menu = document.createElement('div');
  menu.id = 'buret-viewport-menu'; menu.className = 'buret-tree-menu buret-viewport-menu';
  document.body.append(menu);
  const bindings = { window, document, activeConfig: {}, resolveViewerTheme: () => 'dark',
    sceneTreeIconElement: () => document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    viewportPlugin: () => ({ canvas3d: { camera: { state: { mode: 'orthographic' } } } }),
    APP_ICON_DATA: { Check: [] }, SCENE_TREE_ICON: { focus: [], restore: [] }, VIEWPORT_ICON: { layFlat: [] } };
  new Function(...Object.keys(bindings), cameraViewsSource + ['viewportMenuItem', 'appendMolstarPresetMenuSeparator', 'viewportScreenshotChoice', 'viewportCameraMenu'].map(source).join('\n')
    + '; viewportCameraMenu(document.getElementById("buret-viewport-menu"));')(...Object.values(bindings));
  const rows = [...menu.querySelectorAll('button')];
  assert.equal(menu.classList.contains('buret-tree-menu'), false);
  assert.equal(menu.classList.contains('atlas-menu-content'), true);
  assert.deepEqual(rows.map(row => [row.textContent, row.dataset.buretViewportMenu, row.getAttribute('role'), row.getAttribute('aria-checked')]), [
    ['Reset zoom', 'camera-reset', 'menuitem', null], ['Lay flat', 'camera-orient', 'menuitem', null], ['Reset axes', 'camera-axes', 'menuitem', null],
    // The projection rows show the live camera mode.
    ['Perspective', 'camera-projection', 'menuitemradio', 'false'], ['Orthographic', 'camera-projection', 'menuitemradio', 'true'],
    ...['+X', '−X', '+Y', '−Y', '+Z', '−Z'].map(axis => [`View from ${axis}`, 'camera-view-axis', 'menuitem', null]),
  ]);
  assert.equal(menu.querySelectorAll('[role="separator"]').length, 2);
  rows[1].disabled = true;
  rows[0].focus();
  const last = rows.at(-1);
  for (const [key, expected] of [['ArrowDown', rows[2]], ['ArrowUp', rows[0]], ['ArrowUp', last], ['ArrowDown', rows[0]], ['Home', rows[0]], ['End', last]]) {
    const event = new window.KeyboardEvent('keydown', { key, cancelable: true });
    window.BuretteNativeViewerMenus.moveMenuFocus(menu, event);
    assert.equal(document.activeElement, expected);
    assert.equal(event.defaultPrevented, true);
  }
  let action;
  menu.addEventListener('click', event => { action = event.target.dataset.buretViewportMenu; });
  rows[2].click(); assert.equal(action, 'camera-axes');
  const rail = document.createElement('div'); rail.id = 'buret-viewport-rail';
  const trigger = document.createElement('button'); trigger.setAttribute('aria-expanded', 'true');
  rail.append(trigger); document.body.append(rail);
  new Function('document', 'window', 'let viewportMenuControls = null;' + ['floatingMenuMotion', 'floatingMenuFrames', 'dismissFloatingMenu', 'closeViewportMenu'].map(source).join('\n')
    + '; closeViewportMenu({ restoreFocus: true });')(document, window);
  assert.equal(document.getElementById('buret-viewport-menu'), null);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, trigger);
  rail.remove();
}
// Camera actions reach Mol*: projection through the canvas props, axis views and
// later framing through one focus request that keeps the chosen projection.
{
  const { Vec3, Mat4 } = await import('molstar/lib/mol-math/linear-algebra.js');
  const resets = [], props = [];
  const state = { mode: 'orthographic', target: [1, 2, 3], radius: 5 };
  const camera = { state, target: state.target, getFocus: (target, radius, up, direction) => ({ target, radius, up, direction }) };
  const viewer = { plugin: { canvas3d: { camera, boundingSphere: { center: [1, 2, 3], radius: 4 }, setProps: value => props.push(value),
    requestCameraReset: value => resets.push(value), requestDraw() {} } } };
  const bindings = { document, debug: () => {}, viewportPlugin: () => viewer.plugin, activeMolstarViewer: () => viewer,
    fittedMolstarStructureFocus: () => { throw new Error('perspective fit used for an orthographic camera'); } };
  const api = new Function(...Object.keys(bindings), cameraViewsSource + ['requestMolstarStructureFocus', 'runViewportMenuAction'].map(source).join('\n')
    + '; return { requestMolstarStructureFocus, runViewportMenuAction, VIEWPORT_AXIS_VIEWS };')(...Object.values(bindings));
  const control = value => ({ dataset: { viewportValue: value } });
  api.runViewportMenuAction('camera-projection', control('perspective'));
  assert.deepEqual(props, [{ camera: { mode: 'perspective' } }]);
  api.requestMolstarStructureFocus(viewer);
  assert.equal(resets.at(-1).snapshot.mode, 'orthographic');
  // "View from +X" puts the camera on the +X side looking back along −X, with an
  // up direction square to the view; the six views are the six axis directions.
  const directions = api.VIEWPORT_AXIS_VIEWS.map(([label], index) => {
    api.runViewportMenuAction('camera-view-axis', control(String(index)));
    const { direction, up, mode } = resets.at(-1).snapshot;
    const axis = 'XYZ'.indexOf(label[1]);
    assert.deepEqual([...direction].map(Math.abs), [0, 1, 2].map(i => Number(i === axis)), label);
    assert.equal(Math.sign(direction[axis]), label[0] === '+' ? -1 : 1, label);
    assert.equal(Vec3.dot(direction, up), 0, label);
    assert.equal(mode, 'orthographic', label);
    return direction.join();
  });
  assert.equal(new Set(directions).size, 6);

  // Keyboard steps on a focused 3D view, with Mol*'s own math.
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  const view = { position: [0, 0, 10], target: [0, 0, 0], up: [0, 1, 0] };
  const keyCamera = { getSnapshot: () => structuredClone(view), setState: next => Object.assign(view, structuredClone(next)) };
  const plugin = { canvas3dContext: { canvas }, canvas3d: { camera: keyCamera, requestDraw() {} } };
  const keys = new Function('window', constant('VIEWPORT_KEY_CAMERA') + ['rotateViewportCamera', 'stepViewportCamera', 'installViewportKeyboardCamera'].map(source).join('\n')
    + '; return installViewportKeyboardCamera;')({ molstar: { lib: { math: { LinearAlgebra: { Vec3, Mat4 } } } } });
  keys(plugin);
  assert.deepEqual([canvas.tabIndex, canvas.getAttribute('role'), canvas.getAttribute('aria-label')], [0, 'application', '3D view']);
  const press = (code, init = {}) => {
    const event = new window.KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true, ...init });
    canvas.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const close = (a, b) => a.every((value, axis) => Math.abs(value - b[axis]) < 1e-9);
  // Plain arrows stay with pose stepping; Shift+arrows turn the camera.
  assert.equal(press('ArrowRight'), false);
  assert.ok(close(view.position, [0, 0, 10]));
  assert.equal(press('ArrowRight', { shiftKey: true }), true);
  assert.ok(Math.abs(Vec3.magnitude(view.position) - 10) < 1e-9 && view.position[0] !== 0 && close(view.up, [0, 1, 0]));
  for (let step = 1; step < 72; step += 1) press('ArrowRight', { shiftKey: true });
  assert.ok(close(view.position, [0, 0, 10]), 'a full turn returns to the start');
  press('ArrowUp', { shiftKey: true });
  assert.ok(Math.abs(Vec3.dot(Vec3.sub(Vec3(), view.position, view.target), view.up)) < 1e-9, 'pitch keeps up square to the view');
  press('ArrowDown', { shiftKey: true });
  press('KeyE');
  assert.ok(close(view.position, [0, 0, 10]) && !close(view.up, [0, 1, 0]));
  press('KeyQ');
  assert.ok(close(view.up, [0, 1, 0]));
  press('KeyW');
  assert.ok(Math.abs(Vec3.magnitude(view.position) - 9) < 1e-9);
  press('KeyS');
  assert.ok(Math.abs(Vec3.magnitude(view.position) - 10) < 1e-9);
  press('KeyA');
  assert.ok(close(Vec3.sub(Vec3(), view.position, view.target), [0, 0, 10]) && view.target[0] > 0 && Math.abs(view.target[1]) < 1e-9, 'A moves the camera right, so the structure moves left');
  press('KeyD');
  assert.ok(close(view.target, [0, 0, 0]));
  // While the pointer is over the canvas Mol* owns these keys.
  canvas.dispatchEvent(new window.PointerEvent('pointerenter'));
  assert.equal(press('KeyW'), false);
  assert.ok(Math.abs(Vec3.magnitude(view.position) - 10) < 1e-9);
  canvas.remove();
}
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
  assert.ok(document.getElementById('buret-atlas-menu-styles').textContent.includes(shared));
  for (const name of ['button.atlas.css', 'loading-indicator.atlas.css']) {
    const css = readFileSync(`apps/desktop/src/components/ui/${name}`, 'utf8')
      .replace('@layer theme, base, components, utilities;', '')
      .replace('@layer components {', '').replace(/}\s*$/, '');
    assert.ok(document.getElementById('buret-atlas-menu-styles').textContent.includes(css));
  }
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
  const bindings = { document: dom.document, window: dom, activeConfig: {}, viewportMenuControls: null,
    positionGenerate3DMenu: noOp, positionMolstarPresetMenu: noOp, positionOpenViewportMenu: noOp,
    populateMolstarPresetMenu: noOp, updateMolstarPresetControl: noOp, hideMolstarPresetPreview: noOp,
    configuredMolstarPreset: () => 'automatic', focusMolstarPresetControl: noOp,
    setMolstarPresetMenuRovingItem: (_menu, item) => item,
    showNativeViewerMenu: () => { throw Error('toolbar must not enter NSMenu'); } };
  const names = ['showGenerate3DMenu', 'hideGenerate3DMenu', 'showMolstarPresetMenu', 'hideMolstarPresetMenu', 'openViewportMenu', 'closeViewportMenu'];
  const motion = "const FLOATING_MENU_EASE = 'ease-out';\n" + ['floatingMenuMotion', 'floatingMenuFrames', 'revealFloatingMenu', 'dismissFloatingMenu'].map(source).join('\n');
  const menus = new Function(...Object.keys(bindings), motion + names.map(source).join('\n') + `;return {${names.join(',')}}`)(...Object.values(bindings));
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
  select.setAttribute('data-native-selectcontrol', '');
  menu.dataset.effectiveTheme = 'dark';
  assert.equal(press(), true);
  const atlasList = menu.querySelector('[role="listbox"]');
  assert.equal(atlasList.classList.contains('atlas-menu-content'), true);
  assert.equal(atlasList.dataset.effectiveTheme, 'dark');
  assert.equal(atlasList.querySelectorAll('.atlas-menu-item').length, 2);
  const point = atlasList.querySelector('[data-value="point"]');
  point.focus();
  point.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.deepEqual([select.value, changes, page.querySelector('[role="listbox"]')], ['point', ['line', 'point'], null]);
  press();
  browser.BuretteViewerSelectMenus.closeWithin(page.createElement('div'));
  assert.ok(page.querySelector('[role="listbox"]'), 'Unrelated owner must not close the picker');
  browser.BuretteViewerSelectMenus.closeWithin(menu);
  assert.equal(page.querySelector('[role="listbox"]'), null, 'Hiding the toolbar also closes its top-layer picker');
  browser.BuretteConfig = { tauriViewer: true };
  assert.deepEqual([press(), page.querySelector('[role="listbox"]')], [false, null], 'Native hosts keep the system picker');
  await browser.happyDOM.abort();
  console.log('Browser viewer selects open an in-page list; native hosts keep the system picker');
}
