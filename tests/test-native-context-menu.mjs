import { withMenuIcons } from "../apps/desktop/src/components/menu-icons.ts";
import { Edit } from "../apps/desktop/src/components/ui/app-icon-data.ts";
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

// Exercise the actual adapter against the Tauri menu boundary without AppKit.
const source = readFileSync(new URL('../apps/desktop/src/components/native-context-menu.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace('export async function', 'async function')
  .replace(/import\(/g, 'load(');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
let native = true;
let webCalls = 0;
let popup;
let invoked = 0;
const types = {};
for (const kind of ['Menu', 'MenuItem', 'IconMenuItem', 'CheckMenuItem', 'PredefinedMenuItem', 'Submenu']) {
  types[kind] = { new: async options => ({ kind, ...options, popup: async at => { popup = { options, at }; } }) };
}
types.LogicalPosition = class { constructor(x, y) { this.x = x; this.y = y; } };
const show = new Function('withMenuIcons', 'isTauriRuntime', 'showRadixContextMenu', 'load', `${js}\nreturn showNativeContextMenu;`)(
  withMenuIcons, () => native, () => { webCalls++; }, async path => path === "./mac-context-menu" ? { showMacContextMenu: async () => false } : types,
);
const spec = [
  { kind: 'item', id: 'open', text: 'Open', nativeIcon: 'QuickLook', action: () => invoked++, accelerator: 'CmdOrCtrl+O' },
  { kind: 'separator' },
  { kind: 'submenu', id: 'as', text: 'Open As', nativeIcon: 'ListView', items: [
    { kind: 'item', id: 'text', text: 'Text', action: () => invoked++, accelerator: 'CmdOrCtrl+T' },
    { kind: 'item', id: 'disabled', text: 'Unavailable', disabled: true, nativeIcon: 'Path', action: () => invoked++ },
  ] },
];
assert.equal(await show(spec, { x: 30, y: 60 }), true);
assert.equal(webCalls, 0);
assert.deepEqual([popup.at.x, popup.at.y], [30, 60]);
assert.deepEqual(popup.options.items.map(({ kind, id, icon, enabled }) => ({ kind, id, icon, enabled })), [
  { kind: 'IconMenuItem', id: 'open', icon: 'QuickLook', enabled: true },
  { kind: 'PredefinedMenuItem', id: undefined, icon: undefined, enabled: undefined },
  { kind: 'Submenu', id: 'as', icon: 'ListView', enabled: true },
]);
const [open, , submenu] = popup.options.items;
assert.equal(open.accelerator, 'CmdOrCtrl+O');
assert.equal(submenu.items[0].accelerator, 'CmdOrCtrl+T');
assert.equal(submenu.items[1].enabled, false);
assert.equal(submenu.items[1].action, undefined);
open.action(); submenu.items[0].action();
assert.equal(invoked, 2);
native = false;
await show(spec);
assert.equal(webCalls, 1);
native = true;
await show(spec, undefined, { forceWeb: true });
assert.equal(webCalls, 2);
// Without the AppKit popup, live controls stay in the web menu rather than being dropped.
await show([{ kind: 'swatches', id: 'tint', colors: ['#0a84ff'] }]);
assert.equal(webCalls, 3);
console.log('Native menu icons, submenus, accelerators, callbacks and runtime routing passed');

const macSource = readFileSync(new URL('../apps/desktop/src/components/mac-context-menu.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export async function', 'async function');
const macJs = ts.transpileModule(macSource, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
let result = { kind: 'shown', selection: 'open' };
let wire;
let liveHandler;
let liveEvents = [];
const listen = async (event, handler) => {
  assert.equal(event, 'native-context-menu-value');
  liveHandler = handler;
  return () => { liveHandler = undefined; };
};
const macShow = new Function('nativeMenuImage', 'invoke', 'listen', `${macJs}\nreturn showMacContextMenu;`)(async url => { assert.match(decodeURIComponent(url), /<svg/); return 'sdk-png'; }, async (command, args) => {
  assert.equal(command, 'popup_macos_context_menu');
  wire = args;
  // AppKit reports slider and swatch changes while the menu is still open.
  for (const [id, value] of liveEvents) liveHandler({ payload: { session: args.session, id, value } });
  liveHandler?.({ payload: { session: 'another-menu', id: 'opacity', value: 0 } });
  return result;
}, listen);
assert.equal(await macShow(spec, { x: 12, y: 24 }), true);
assert.equal(invoked, 3);
assert.deepEqual(wire.at, { x: 12, y: 24 });
// Right-click menus take the context-menu path that carries the system "Ask Siri" row.
assert.equal(wire.presentation, 'context');
assert.deepEqual(wire.items[2].items, [
  { kind: 'item', id: 'text', text: 'Text', enabled: true, accelerator: 'CmdOrCtrl+T' },
  { kind: 'item', id: 'disabled', text: 'Unavailable', enabled: false },
]);
result = { kind: 'shown', selection: 'disabled' };
await macShow(spec, { x: 12, y: 24 }, 'dropdown');
assert.equal(wire.presentation, 'dropdown');
assert.equal(invoked, 3);
result = { kind: 'shown', selection: null };
await macShow(spec);
assert.equal(invoked, 3);
let checked;
result = { kind: 'shown', selection: 'pin-tab' };
await macShow([{ kind: 'checkbox', id: 'pin-tab', text: 'Pin', checked: false, action: value => checked = value }]);
assert.equal(checked, true);
assert.deepEqual(wire.items, [{ kind: 'item', id: 'pin-tab', text: 'Pin', enabled: true, symbol: 'pin', checked: false }]);
result = { kind: 'unsupported' };
assert.equal(await macShow(spec), false);
console.log('AppKit menu wire format, SF Symbols, cancellation and selection callbacks passed');

// Live controls: sliders and swatches apply during tracking, a select becomes a
// checkmarked submenu, and a detail line becomes the native subtitle.
const applied = [];
liveEvents = [['opacity', 0.4], ['tint', '#123456']];
result = { kind: 'shown', selection: 'motion:spin' };
await macShow([
  { kind: 'item', id: 'copy', text: 'Copy', detail: 'As SMILES', action() {} },
  { kind: 'swatches', id: 'tint', colors: ['#0a84ff', 'red'], activeColor: '#0a84ff', action: value => applied.push(['tint', value]) },
  { kind: 'number', id: 'opacity', label: 'Opacity', value: 1, min: 0, max: 1, step: 0.05, action: value => applied.push(['opacity', value]) },
  { kind: 'select', id: 'motion', label: 'Motion', value: 'off', options: ['off', 'spin'], optionLabels: { off: 'Off', spin: 'Spin' }, action: value => applied.push(['motion', value]) },
]);
assert.deepEqual(applied, [['opacity', 0.4], ['tint', '#123456'], ['motion', 'spin']]);
assert.equal(liveHandler, undefined, 'the live listener is removed when the menu closes');
assert.deepEqual(wire.items, [
  { kind: 'item', id: 'copy', text: 'Copy', enabled: true, subtitle: 'As SMILES' },
  { kind: 'colours', id: 'tint', colors: ['#0a84ff'], active: '#0a84ff' },
  { kind: 'slider', id: 'opacity', text: 'Opacity', value: 1, min: 0, max: 1, step: 0.05 },
  { kind: 'submenu', id: 'motion', text: 'Motion', enabled: true, items: [
    { kind: 'item', id: 'motion:off', text: 'Off', enabled: true, checked: true },
    { kind: 'item', id: 'motion:spin', text: 'Spin', enabled: true, checked: false },
  ] },
]);
liveEvents = [];
console.log('AppKit live sliders, colour carousel, select submenus and subtitles passed');

// The same SDK vector is shown by Radix and passed as an image to AppKit,
// including submenu parents. Explicit SDK images override legacy SF Symbols.
result = { kind: 'shown', selection: 'copy-paths' };
let copied = false;
const sdkMenu = withMenuIcons([{ kind: 'submenu', id: 'file-copy', text: 'Copy', nativeSymbol: 'doc', items: [
  { kind: 'item', id: 'copy-paths', text: 'Path', action: () => { copied = true; } },
] }]);
await macShow(sdkMenu);
assert.equal(copied, true);
assert.deepEqual(wire.items, [{ kind: 'submenu', id: 'file-copy', text: 'Copy', enabled: true, image: 'sdk-png', items: [
  { kind: 'item', id: 'copy-paths', text: 'Path', enabled: true, image: 'sdk-png' },
] }]);
console.log('OpenAI SDK icons reach AppKit on both commands and submenu parents');

const [editMenu] = withMenuIcons([{ kind: 'item', id: 'file-edit', text: 'Edit', action() {} }]);
const editSvg = decodeURIComponent(editMenu.iconUrl.split(',')[1]);
assert.match(editSvg, /width="24" height="24" viewBox="0 0 24 24"/);
assert.match(editSvg, /fill="#000"/);
assert.match(editSvg, /fill-rule="evenodd"/);
assert.ok(Edit.every(([tag, attributes]) => tag !== 'path' || editSvg.includes(`d="${attributes.d}"`)));
assert.doesNotMatch(editSvg, /currentColor|className| key=/);

const { xyzrenderContextMenuItems } = await import('../apps/desktop/src/components/xyzrender-context-menu.ts');
const xyzActions = [];
const xyzItems = xyzrenderContextMenuItems({ label: 'caffeine.xyz', hasSelection: true, hasHidden: true }, action => xyzActions.push(action));
assert.deepEqual(xyzItems.map(item => item.id || item.kind), [
  'canvas:select-all', 'canvas:duplicate', 'canvas:arrange', 'canvas:animate', 'separator',
  'view:hide', 'view:show-all', 'xyzrender-selection', 'separator', 'xyzrender-export',
]);
xyzItems[1].action();
xyzItems[7].items[0].action();
xyzItems[9].items[1].action();
assert.deepEqual(xyzActions, ['canvas:duplicate', 'select:hide', 'save-format:png']);
const minimalXyzItems = xyzrenderContextMenuItems({ label: 'a', hasSelection: false, hasHidden: false }, () => {});
assert.equal(minimalXyzItems.length, 8);
assert.ok(!minimalXyzItems.some(item => item.kind === 'label'), 'native menu omits the filename label');
console.log('xyzrender native menu context and action routing passed');

// The Mol* 3D right click: the viewer describes the menu, the host parses it into
// NSMenu rows, and every choice or slider move comes back to the viewer.
const { molstarContextMenuItems } = await import('../apps/desktop/src/components/molstar-context-menu.ts');
const viewerSource = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const viewerFunction = name => {
  const match = new RegExp(`\\n  function ${name}\\([\\s\\S]*?\\n  \\}`).exec(viewerSource);
  assert.ok(match, name);
  return match[0];
};
const molstarMenuFunctions = ['molstarNativeMenuLabel', 'molstarNativeMenuLiveUndo', 'molstarNativeRepresentationMenu', 'molstarNativeMenuEntries',
  'showDesktopNativeMolstarContextMenu', 'handleMolstarNativeMenuResult'];
const calls = [];
const log = name => (...args) => { calls.push([name, ...args]); };
const posted = [];
const representation = { cell: { transform: { params: { type: { name: 'cartoon', params: { alpha: 0.5 } }, colorTheme: { name: 'chain-id' } } } } };
const molstarStubs = {
  activeConfig: { appViewer: true },
  document: { body: { classList: { contains: () => false } } },
  postHostMessage: message => { posted.push(message); return true; },
  molstarNativeMenuIcon: paths => paths ? 'data:image/svg+xml,icon' : undefined,
  moleculeContextActionIcon: () => 'paths',
  MOLECULE_MENU_GROUPS: [
    { id: 'view', title: 'View', direct: true, hideTitle: true },
    { id: 'color', title: 'Colour', breakBefore: true },
  ],
  MOLECULE_MENU_GROUP_ICONS: {},
  MOLECULE_MENU_GROUP_TITLES: {},
  VIEWPORT_GRANULARITIES: [['residue', 'Residue'], ['chain', 'Chain']],
  molstarContextMenuActions: () => [['focus', 'Focus in current view'], ['represent:menu', 'Representation & colour…'],
    ['colour:red', 'Red'], ['extract:chain', 'Extract Chain A as PDB']],
  moleculeContextActionGroup: name => /^(?:colour|extract):/.test(name) ? 'color' : 'view',
  moleculeMenuSectionEntries: (grouped, section) => grouped.get(section.id) || [],
  moleculeMenuActionChildren: () => [],
  molstarContextChainLabel: () => 'Chain A',
  activeMolstarViewer: () => ({}),
  molstarContextComponentRef: () => 'component',
  sceneTreeColorTargets: () => new Map([['component', [{ representations: [{ cell: { transform: { ref: 'rep' } } }] }]]]),
  sceneTreeRepresentationTargets: () => new Map([['rep', { component: {}, representation }]]),
  sceneTreeNodes: () => [],
  sceneTreeNodeByRef: () => ({ label: 'Cartoon' }),
  sceneTreeRepresentationTypes: () => [{ name: 'cartoon', label: 'Cartoon' }, { name: 'surface', label: 'Surface' }],
  sceneTreeSurfaceFill: () => null,
  sceneTreeColorThemes: () => [{ name: 'chain-id', label: 'Chain ID' }, { name: 'uniform', label: 'Uniform' }],
  sceneTreeRepresentationTint: () => 0xff0000,
  sceneTreeColorHex: value => `#${value.toString(16).padStart(6, '0')}`,
  SCENE_TREE_UNIFORM_COLORS: [{ value: 0xff0000 }, { value: 0x00ff00 }],
  molstarOutlineBrightness: 0.4,
  sceneTreeAdvancedParams: () => ({
    rows: [
      { name: 'sizeFactor', label: 'Size', definition: { type: 'number', min: 0, max: 3, step: 0.1, defaultValue: 1 } },
      { name: 'ignoreLight', label: 'Ignore light', definition: { type: 'boolean' } },
      { name: 'quality', label: 'Quality', definition: { type: 'select', options: [['auto', 'Auto'], ['high', 'High']], defaultValue: 'auto' } },
    ],
    current: { sizeFactor: 0.5 },
    sizeOptions: [['uniform', 'Uniform'], ['physical', 'Physical']],
  }),
  molstarSceneMenuSelectUndoLabel: kind => `undo ${kind}`,
  runMolstarSceneEdit: (label, run) => { calls.push(['edit', label]); return run(); },
  captureMolstarSceneUndoSnapshot: label => ({ label }),
  pushMolstarEditUndoSnapshot: snapshot => calls.push(['undo', snapshot.label]),
  ...Object.fromEntries(['runSceneTreeSelectAction', 'duplicateSceneTreeRepresentation', 'streamSceneTreeReprAlpha',
    'streamSceneTreeTheme', 'streamSceneTreeReprParam', 'applySceneTreeReprParam', 'setMolstarOutlineBrightness',
    'moleculeContextMenuAction', 'scheduleSceneTreeRender', 'setMolstarSelectionLevel', 'setStatus',
    'hideMolstarContextMenu', 'showMolstarContextMenu'].map(name => [name, log(name)])),
};
const molstarMenu = new Function(...Object.keys(molstarStubs), `
  const window = {};
  let molstarNativeMenuPending = null;
  let molstarNativeMenuSerial = 0;
  ${/\n  const MOLSTAR_NATIVE_MENU_LABELS = \{[\s\S]*?\n  \};/.exec(viewerSource)[0]}
  ${molstarMenuFunctions.map(viewerFunction).join('\n')}
  return { ${molstarMenuFunctions.join(',')} };
`)(...Object.values(molstarStubs));
const pick = { id: 'pick' };
const openMolstarMenu = mode => {
  assert.equal(molstarMenu.showDesktopNativeMolstarContextMenu({ clientX: 10, clientY: 20 }, pick, { label: 'ALA 12' }, mode), true);
  const message = posted.at(-1);
  const reply = body => molstarMenu.handleMolstarNativeMenuResult({ requestId: message.requestId, ...body });
  return { message, reply, items: molstarContextMenuItems(message.items, (id, value) => reply({ event: 'select', id, value })) };
};
const byId = (items, id) => items.find(item => item.id === `molstar-menu:${id}`);

const first = openMolstarMenu('residue');
assert.deepEqual({ type: first.message.type, clientX: first.message.clientX, clientY: first.message.clientY },
  { type: 'molstarContextMenu', clientX: 10, clientY: 20 });
assert.deepEqual(first.items.map(item => item.id || item.kind), [
  'molstar-menu-label-0', 'molstar-menu:picking-level', 'separator', 'molstar-menu:focus', 'molstar-menu:represent:menu',
  'separator', 'molstar-menu:section:color',
]);
assert.equal(first.items[0].text, 'ALA 12');
// Short native titles keep the NSMenu narrow; submenu rows drop the prefix their parent names.
assert.deepEqual([byId(first.items, 'focus').text, byId(first.items, 'represent:menu').text,
  byId(first.items, 'section:color').items.map(item => item.text)], ['Focus', 'Style', ['Red', 'Extract Chain A']]);
const representMenu = byId(first.items, 'represent:menu');
assert.equal(representMenu.iconUrl, 'data:image/svg+xml,icon');
assert.deepEqual(representMenu.items.map(item => item.id || item.kind), [
  'molstar-menu-label-1', 'molstar-menu:representation-type', 'molstar-menu:representation-add', 'molstar-menu:opacity',
  'molstar-menu:outline-brightness', 'separator', 'molstar-menu-label-2', 'molstar-menu:representation-color',
  'molstar-menu:tint', 'separator', 'molstar-menu:advanced',
]);
assert.deepEqual(byId(representMenu.items, 'opacity'), {
  kind: 'number', id: 'molstar-menu:opacity', label: 'Opacity', value: 50, min: 0, max: 100, step: 1, unit: '%',
  action: byId(representMenu.items, 'opacity').action,
});
assert.deepEqual(byId(representMenu.items, 'tint').colors, ['#ff0000', '#00ff00']);
assert.equal(byId(representMenu.items, 'tint').activeColor, '#ff0000');
const advancedMenu = byId(representMenu.items, 'advanced');
assert.deepEqual(advancedMenu.items.map(item => `${item.kind}:${item.id}`), [
  'number:molstar-menu:param:sizeFactor', 'checkbox:molstar-menu:param:ignoreLight',
  'select:molstar-menu:param:quality', 'select:molstar-menu:representation-size',
]);
assert.equal(byId(advancedMenu.items, 'param:sizeFactor').value, 0.5);

// Live controls stream every move but record one undo step each, on close.
byId(representMenu.items, 'opacity').action(40);
byId(representMenu.items, 'opacity').action(30);
byId(representMenu.items, 'tint').action('#00ff00');
byId(advancedMenu.items, 'param:sizeFactor').action(1.5);
byId(representMenu.items, 'outline-brightness').action(80);
assert.equal(calls.filter(([name]) => name === 'undo').length, 0);
byId(representMenu.items, 'representation-type').action('surface');
byId(advancedMenu.items, 'param:ignoreLight').action(true);
byId(advancedMenu.items, 'param:quality').action('high');
byId(advancedMenu.items, 'representation-size').action('physical');
byId(first.items, 'focus').action();
first.reply({ event: 'closed' });
assert.deepEqual(calls, [
  ['streamSceneTreeReprAlpha', 'rep', 0.4],
  ['streamSceneTreeReprAlpha', 'rep', 0.3],
  ['streamSceneTreeTheme', 'rep', 'rep-tint-color', 'tint', 0x00ff00],
  ['streamSceneTreeReprParam', 'rep', 'sizeFactor', 1.5],
  ['setMolstarOutlineBrightness', 0.8],
  ['edit', 'undo representation-type'],
  ['runSceneTreeSelectAction', 'representation-type', 'rep', 'surface'],
  ['edit', 'ignoreLight of Cartoon'],
  ['applySceneTreeReprParam', 'rep', 'ignoreLight', true],
  ['edit', 'quality of Cartoon'],
  ['applySceneTreeReprParam', 'rep', 'quality', 'high'],
  ['edit', 'undo representation-size'],
  ['runSceneTreeSelectAction', 'representation-size', 'rep', 'physical'],
  ['moleculeContextMenuAction', 'focus', 'Focus in current view', { label: 'ALA 12', pickingLevel: 'residue' }],
  ['undo', 'opacity of Cartoon'],
  ['undo', 'colour of Cartoon'],
  ['undo', 'sizeFactor of Cartoon'],
  ['scheduleSceneTreeRender'],
]);
// A late or foreign reply never reaches a closed session.
calls.length = 0;
first.reply({ event: 'select', id: 'focus' });
assert.deepEqual(calls, []);

// A new picking level reopens the menu at the same point.
const second = openMolstarMenu('residue');
byId(second.items, 'picking-level').action('chain');
second.reply({ event: 'closed' });
assert.deepEqual(calls, [
  ['setMolstarSelectionLevel', 'chain'],
  ['setStatus', '[web] Picking level set to chain.'],
  ['showMolstarContextMenu', { clientX: 10, clientY: 20 }, pick],
]);

// Dismissing without a choice clears the menu state; a host without NSMenu falls back to the web menu.
calls.length = 0;
openMolstarMenu('chain').reply({ event: 'closed' });
openMolstarMenu('residue').reply({ event: 'unsupported' });
assert.deepEqual(calls, [['hideMolstarContextMenu'], ['showMolstarContextMenu', { clientX: 10, clientY: 20 }, pick, { forceWeb: true }]]);
assert.equal(posted.at(-2).items[0].text, 'Chain A');

molstarStubs.activeConfig.appViewer = false;
assert.equal(molstarMenu.showDesktopNativeMolstarContextMenu({ clientX: 0, clientY: 0 }, pick, { label: 'x' }, 'residue'), false);

// The host drops malformed rows and never lets the frame spoof shared ids or oversized payloads.
const parsed = molstarContextMenuItems([
  { kind: 'item', id: 'remove', text: 'Remove', icon: 'javascript:alert(1)' },
  { kind: 'item', id: 'x'.repeat(161), text: 'Too long' },
  { kind: 'submenu', id: 'empty', text: 'Empty', items: [{ kind: 'mystery' }] },
  { kind: 'number', id: 'bad', label: 'Bad', value: 1, min: 5, max: 5 },
  { kind: 'number', id: 'clamped', label: 'Clamped', value: 400, min: 0, max: 100 },
  { kind: 'swatches', id: 'colours', colors: ['red', '#12345g', '#abcdef'], active: 'url(x)' },
  { kind: 'select', id: 'choice', label: 'Choice', value: 'b', options: [{ value: 'a' }, { value: 'a', label: 'dup' }, { value: 'b', label: 'B' }] },
], () => {});
assert.deepEqual(parsed.map(({ action: _action, ...rest }) => rest), [
  { kind: 'item', id: 'molstar-menu:remove', text: 'Remove' },
  { kind: 'number', id: 'molstar-menu:clamped', label: 'Clamped', value: 100, min: 0, max: 100 },
  { kind: 'swatches', id: 'molstar-menu:colours', colors: ['#abcdef'] },
  { kind: 'select', id: 'molstar-menu:choice', label: 'Choice', value: 'b', options: ['a', 'b'], optionLabels: { a: 'a', b: 'B' } },
]);
// Budget and depth match popup_macos_context_menu, where a choice expands into a submenu of options.
assert.equal(molstarContextMenuItems(Array.from({ length: 600 }, () => ({ kind: 'separator' })), () => {}).length, 512);
const manyOptions = Array.from({ length: 80 }, (_, index) => ({ value: `v${index}` }));
assert.equal(molstarContextMenuItems(Array.from({ length: 7 }, (_, index) =>
  ({ kind: 'select', id: `s${index}`, label: 'S', options: manyOptions })), () => {}).length, 6);
const choice = id => ({ kind: 'select', id, label: 'Choice', options: [{ value: 'a' }] });
const [levelOne] = molstarContextMenuItems([{ kind: 'submenu', id: 'one', text: 'One', items: [
  { kind: 'submenu', id: 'two', text: 'Two', items: [choice('second'), { kind: 'submenu', id: 'three', text: 'Three', items: [
    choice('third'), { kind: 'item', id: 'leaf', text: 'Leaf' },
  ] }] },
] }], () => {});
const [secondChoice, levelThree] = levelOne.items[0].items;
assert.equal(secondChoice.kind, 'select');
assert.deepEqual(levelThree.items.map(item => item.id), ['molstar-menu:leaf'], 'a third-level choice would nest past AppKit');
console.log('Mol* native context menu protocol passed');
