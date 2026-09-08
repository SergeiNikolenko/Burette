import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { ketcherUiPlugin } from "../apps/desktop/vite/ketcher-ui.ts";

const path = new URL("../apps/desktop/node_modules/ketcher-react/dist/index.js", import.meta.url).pathname;
const original = readFileSync(path, "utf8");
const plugin = ketcherUiPlugin();
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
for (const filename of ["index.js", "index.modern-7545f4b2.js"]) {
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

for (const [filename, names] of [["index.js", ["ModeControl", "MenuItemWithDropdown", "NaturalAnaloguePicker"]], ["index.modern-7545f4b2.js", ["SubMenu", "MenuItem"]]]) {
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
assert.ok(tool.includes('onAction: onAction,\n      name: iconName'), 'primary tool click selects its tool');
assert.ok(tool.includes('onAction: onAction\n      })'), 'choosing an option retains the original action dispatcher');
assert.throws(() => plugin.transform(original.replace('function ToolbarMultiToolItem(props)', 'function ToolbarMultiToolItem(changed)'), path), /contract changed: ToolbarMultiToolItem/);
assert.ok(tool.includes('jsx(__buretteKetcherToolExpand, { onClick: onOpenOptions, disabled: isDisabled, expanded: isOpen })'), 'independent dropdown keeps open and disabled state');
console.log('Ketcher tool groups: separate primary and dropdown actions passed');
