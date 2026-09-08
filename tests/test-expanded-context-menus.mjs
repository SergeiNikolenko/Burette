import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const source = readFileSync('PreviewExtension/Web/grid-viewer.js', 'utf8');
function sourceFunction(name) {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  const rest = source.slice(match.index + 1);
  const end = rest.search(/\n {2}(?:async )?function [\w$]/);
  return rest.slice(0, end);
}
const window = new Window();
const document = window.document;
document.body.innerHTML = '<main id="app"><div tabindex="0" id="target">Column</div></main>';
const root = document.getElementById('app');
const state = { tablePinnedColumns: new Set(['value']), tableColumnWidths: new Map(), tableHiddenColumns: new Set(), tableScrollLeft: 240 };
const functions = ['compare', 'tableActiveSort', 'tableColumnWidth', 'tableColumnWindow', 'tableColumnWidthStyle', 'tableVisibleColumns',
  'showGridContextMenu', 'hideMoleculeContextMenu', 'positionMoleculeContextMenu'];
const runtime = new Function('window', 'document', 'root', 'state', `
  const TABLE_DEFAULT_COLUMN_WIDTH = 118, TABLE_COLUMN_OVERSCAN_PX = 200;
  function tableViewportWidth() { return 600; }
  function analysisDisplayValue(cell) { return cell?.value ?? ''; }
  function setStatus(message) { throw new Error(message); }
  ${functions.map(sourceFunction).join('\n')}
  return { ${functions.join(',')} };
`)(window, document, root, state);
const rows = [{ index: 0, props: { score: '2' } }, { index: 1, props: { score: '10' } }, { index: 2, props: { score: '' } }];
assert.deepEqual([...rows].sort((a, b) => runtime.compare(a, b, 'desc:numeric:prop:score')).map(row => row.index), [1, 0, 2]);
const columns = [{ id: 'name' }, { id: 'value' }, { id: 'other' }];
const visible = runtime.tableVisibleColumns(columns);
const columnWindow = runtime.tableColumnWindow(visible);
assert.deepEqual(columnWindow.fixedColumns.map(column => column.id), ['value']);
assert.ok(columnWindow.scrollColumns.every(column => column.id !== 'value'));
assert.match(runtime.tableColumnWidthStyle(columns[1]), /position:sticky;left:0px/);

let invoked = 0;
const target = document.getElementById('target');
const event = { target, clientX: 20, clientY: 30, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
const menu = runtime.showGridContextMenu(event, 'Actions', [
  { id: 'first', label: 'First', action: () => invoked++ }, null,
  { id: 'disabled', label: 'Unavailable', disabled: true, action: () => invoked += 100 },
  { id: 'last', label: 'Last', action: () => invoked++ },
]);
assert.equal(document.activeElement.textContent, 'First');
document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
assert.equal(document.activeElement.textContent, 'Last');
document.activeElement.click();
await Promise.resolve();
assert.equal(invoked, 1);
assert.equal(menu.isConnected, false);
assert.equal(document.activeElement, target);
runtime.showGridContextMenu(event, 'Statistics', [], 'Count: 3');
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
assert.equal(root.querySelector('[role="menu"]'), null);
const filterMenu = runtime.showGridContextMenu(event, 'Filter', [{ id: 'apply', label: 'Apply', action() {} }]);
const minimum = document.createElement('input');
const maximum = document.createElement('input');
filterMenu.prepend(minimum, maximum);
minimum.focus();
minimum.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
assert.equal(document.activeElement, maximum);
assert.ok(filterMenu.isConnected);
maximum.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
assert.equal(document.activeElement, minimum);
runtime.hideMoleculeContextMenu();
await window.happyDOM.close();
console.log('Expanded context menu keyboard, actions, numeric sort and pinned-column contracts passed');
