import { withMenuIcons } from "../apps/desktop/src/components/menu-icons.ts";
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
console.log('Native menu icons, submenus, accelerators, callbacks and runtime routing passed');

const macSource = readFileSync(new URL('../apps/desktop/src/components/mac-context-menu.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export async function', 'async function');
const macJs = ts.transpileModule(macSource, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
let result = { kind: 'shown', selection: 'open' };
let wire;
const macShow = new Function('nativeMenuImage', 'invoke', `${macJs}\nreturn showMacContextMenu;`)(async url => { assert.match(decodeURIComponent(url), /<svg/); return 'sdk-png'; }, async (command, args) => {
  assert.equal(command, 'popup_macos_context_menu');
  wire = args;
  return result;
});
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
