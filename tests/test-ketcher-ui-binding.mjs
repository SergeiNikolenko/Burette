import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript-compiler-api";
import { runInNewContext } from "node:vm";
import { ketcherUiPlugin } from "../apps/desktop/vite/ketcher-ui.ts";

const path = new URL("../apps/desktop/node_modules/ketcher-react/dist/index.js", import.meta.url).pathname;
const original = readFileSync(path, "utf8");
const plugin = ketcherUiPlugin();
// SettingsService must have a functioning browser EventEmitter, rather than
// Vite's empty external placeholder for Node built-ins.
const eventsPath = plugin.config().resolve.alias.events;
const { default: browserEvents } = await import(eventsPath);
const emitter = new browserEvents.EventEmitter();
let notified;
emitter.once("settings", value => { notified = value; });
emitter.emit("settings", { zoom: 100 });
assert.deepEqual(notified, { zoom: 100 });
const patched = plugin.transform(original, path).code;
const source = ts.createSourceFile("patched.js", patched, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.deepEqual(source.parseDiagnostics, []);
assert.equal(plugin.transform(original, "/other-package/dist/index.js"), null);
assert.throws(() => plugin.transform(original.replace("var Dialog = function Dialog(props)", "var Dialog = function Dialog(changedProps)"), path), /contract changed: Dialog/);
assert.throws(() => plugin.transform(original.replace("var Dialog =", "var RemovedDialog ="), path), /primitives are missing/);
// Input codecs and chemistry/editor implementation must stay byte-for-byte
// unchanged. In particular, wrapping a checkbox must not remove its .val codec.
for (const name of ["CheckBox.val", "Slider.val", "GenericInput.val", "TextArea.val", "Select.val"]) {
  const start = original.indexOf(name + " =");
  const end = original.indexOf("\n};", start) + 3;
  assert.ok(start > 0 && patched.includes(original.slice(start, end)), name);
}
assert.ok(patched.includes("var Dialog = __buretteKetcherDialog;"));
assert.ok(patched.includes("var IconButtonBase = __buretteKetcherIconButton;"));
// Optimizer must keep app components external, so shell contexts and HMR have
// a single identity rather than a second prebundled copy.
const optimizer = plugin.config().optimizeDeps.rolldownOptions.plugins[0];
assert.equal(optimizer.transform(original, path).code, patched);
const importPath = /^import .* from "(.+)";/u.exec(patched)[1];
assert.deepEqual(optimizer.resolveId(importPath), { id: `/@fs/${importPath}`, external: true });
console.log("Ketcher UI binding: version guard, codecs, syntax, optimizer identity passed");

// Both editor controllers keep their input parsing, event subscription and zoom
// callbacks, while their presentation routes to the same shared menu.
for (const filename of ["index.js", "index.modern-55d8e3ef.js"]) {
  const bundlePath = new URL(`../apps/desktop/node_modules/ketcher-react/dist/${filename}`, import.meta.url).pathname;
  const bundle = readFileSync(bundlePath, "utf8");
  const result = plugin.transform(bundle, bundlePath).code;
  assert.deepEqual(ts.createSourceFile(filename, result, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics, []);
  const start = bundle.indexOf("var ZoomControls = function ZoomControls");
  const render = bundle.indexOf("  return jsxs(ElementAndDropdown", start);
  assert.ok(result.includes(bundle.slice(start, render)), `${filename}: original zoom controller`);
  assert.ok(result.includes("return jsx(__buretteKetcherZoomMenu,"));
  assert.ok(result.includes("var StyledInput = __buretteKetcherInput;"));
  assert.throws(() => plugin.transform(bundle.replace("var ZoomControls = function ZoomControls()", "var ZoomControls = function ZoomControls(changed)" ).replace("var ZoomControls = function ZoomControls(_ref)", "var ZoomControls = function ZoomControls(changed)"), bundlePath), /contract changed: ZoomControls/);
  const menuPath = /^import .* from "(.+menus\.tsx)";/mu.exec(result)[1];
  assert.deepEqual(optimizer.resolveId(menuPath), { id: `/@fs/${menuPath}`, external: true });
}
console.log("Ketcher zoom menus: molecule and macro controller preservation passed");

for (const [filename, names] of [["index.js", ["ModeControl", "MenuItemWithDropdown", "NaturalAnaloguePicker"]], ["index.modern-55d8e3ef.js", ["SubMenu", "MenuItem"]]]) {
  const bundlePath = new URL(`../apps/desktop/node_modules/ketcher-react/dist/${filename}`, import.meta.url).pathname;
  const bundle = readFileSync(bundlePath, "utf8");
  const result = plugin.transform(bundle, bundlePath).code;
  const parsed = ts.createSourceFile(filename, bundle, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!names.includes(declaration.name.getText(parsed))) continue;
      const node = declaration.initializer;
      const rendered = node.body.statements.findLast(ts.isReturnStatement);
      assert.ok(result.includes(bundle.slice(node.getStart(parsed), rendered.getStart(parsed))), `${filename}: ${declaration.name.getText(parsed)} original controller`);
    }
  }
  assert.ok(!/import \{[^\n]+\} from 'react-contexify'/u.test(result));
  assert.ok(result.includes('context-menus.tsx"'));
  assert.throws(() => plugin.transform(bundle.replace("from 'react-contexify'", "from 'other-context-menu'"), bundlePath), /context menu import contract changed/);
}
console.log("Ketcher toolbar menus: mode, clipboard, macro controllers and context imports passed");

const toolStart = patched.indexOf('var ToolbarMultiToolItem =');
const toolEnd = patched.indexOf('var ToolbarGroupItem =', toolStart);
const tool = patched.slice(toolStart, toolEnd);
assert.match(tool, /primary: jsx\(ActionButton, \{ className, name: iconName,[\s\S]*?action: configWithNonViewOnlyActionsDisabled\[currentId\][\s\S]*?indigoVerification, onAction,/u, 'primary button retains current action and dispatcher');
assert.ok(tool.includes('onSelect: function() { if (action?.action) onAction(action.action); }'), 'option dispatches the original Redux action');
assert.ok(tool.includes('if (next) onOpenOptions(); else onOpen(id, true);'), 'expand and close retain upstream open state');
assert.ok(tool.includes('hidden: state.hidden || !iconName') && tool.includes('disabled: state.disabled || indigoVerification && disableableButtons.includes(iconName)'), 'upstream availability remains enforced');
assert.throws(() => plugin.transform(original.replace('function ToolbarMultiToolItem(props)', 'function ToolbarMultiToolItem(changed)'), path), /contract changed: ToolbarMultiToolItem/);
console.log('Ketcher tool groups: primary action, options, availability and dropdown controller passed');

const libraryDeclaration = source.statements.flatMap(statement => ts.isVariableStatement(statement)
  ? [...statement.declarationList.declarations] : []).find(node => node.name.getText(source) === 'TemplateTable');
const selections = [];
const attaches = [];
const tmpl = { struct: { name: 'test' }, props: { group: 'User Templates' } };
const jsx = (type, props) => ({ type, props });
const TemplateTable = runInNewContext(`(${libraryDeclaration.initializer.getText(source)})`, {
  jsx, jsxs: jsx, classes$7: {}, greekify: value => value, getTemplateTitle: () => 'Test',
  tmplName: () => 'Test', __buretteKetcherLibraryPreview: 'preview', StructRender: 'renderer',
  _objectSpread$9: Object.assign, isFunctionalGroupTemplate: () => false,
  isSaltOrSolventTemplate: () => false, Icon: 'icon', createKeyDownHandler: fn => fn,
});
const tile = TemplateTable({ templates: [tmpl], onSelect: value => selections.push(value),
  onAttach: value => attaches.push(value), onDelete() {} }).props.children[0];
assert.equal(tile.type, 'div');
assert.equal(tile.props.role, 'button');
assert.equal(tile.props.tabIndex, 0);
const target = {};
for (const key of ['Enter', ' ']) tile.props.onKeyDown({ key, target, currentTarget: target, preventDefault() {} });
assert.deepEqual(selections, [tmpl, tmpl]);
tile.props.onKeyDown({ key: 'Enter', target: {}, currentTarget: target });
assert.equal(selections.length, 2, 'inner button keyboard events do not select the template');
const edit = tile.props.children.find(child => child?.props?.['data-testid'] === 'edit-template-button');
assert.equal(edit.props['aria-label'], 'Edit template');
edit.props.onClick({ stopPropagation() {} });
assert.deepEqual(attaches, [tmpl]);
assert.equal(selections.length, 2);
assert.equal(tile.props.children.find(child => child?.props?.['data-testid'] === 'delete-template-button').props['aria-label'], 'Delete template');
console.log('Ketcher library: independent keyboard selection and template actions passed');
