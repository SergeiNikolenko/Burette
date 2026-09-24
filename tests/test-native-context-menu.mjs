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
assert.deepEqual(wire.items[2].items, [
  { kind: 'item', id: 'text', text: 'Text', enabled: true, accelerator: 'CmdOrCtrl+T' },
  { kind: 'item', id: 'disabled', text: 'Unavailable', enabled: false },
]);
result = { kind: 'shown', selection: 'disabled' };
await macShow(spec);
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
