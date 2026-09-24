import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const tail = source.slice(start + 2);
  const end = tail.search(/\n  (?:async )?function /);
  return end < 0 ? tail : tail.slice(0, end);
}
const window = new Window();
const document = window.document;
document.body.innerHTML = `<div class="buret-external-artifact-root"><div class="buret-xyzrender-sheet-item selected" style="left: 100px; top: 120px"></div><div class="buret-xyzrender-sheet-item selected" style="left: 300px; top: 120px"></div><div class="buret-xyzrender-context-menu"><button>Duplicate</button></div><div id="empty"></div></div>`;
const names = ['selectRotatableArtifact', 'bringXyzrenderSheetItemToFront', 'clearRotatableArtifactSelection', 'installRotatableArtifactSelectionClear', 'sheetItemCenterPosition', 'installXyzrenderSheetItemDrag'];
const published = [];
const api = new Function('document', 'publishXyzrenderItem', `let xyzrenderLassoEnabled = false; ${names.map(declaration).join('\n')} return { ${names.join(',')} };`)(document, item => published.push(item));
const root = document.querySelector('.buret-external-artifact-root');
const items = [...root.querySelectorAll('.buret-xyzrender-sheet-item')];
api.installRotatableArtifactSelectionClear(root);
for (const item of items) api.installXyzrenderSheetItemDrag(item, () => 2);
const pointer = (target, type, x, y, extra = {}) => target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: x, clientY: y, ...extra }));
pointer(document.querySelector('button'), 'pointerdown', 0, 0);
assert.equal(root.querySelectorAll('.selected').length, 2, 'context menu actions preserve selection');
pointer(items[0], 'pointerdown', 100, 120);
pointer(items[0], 'pointermove', 140, 140);
pointer(items[0], 'pointerup', 140, 140);
assert.deepEqual(items.map(item => [item.style.left, item.style.top]), [['120px', '130px'], ['320px', '130px']], 'group drag respects canvas zoom');
pointer(document.querySelector('#empty'), 'pointerdown', 0, 0);
assert.equal(root.querySelectorAll('.selected').length, 0, 'empty canvas clears selection');
pointer(items[0], 'pointerdown', 120, 130);
pointer(items[0], 'pointerup', 120, 130);
pointer(items[1], 'pointerdown', 320, 130, { shiftKey: true });
pointer(items[1], 'pointerup', 320, 130);
assert.equal(root.querySelectorAll('.selected').length, 2, 'shift selection retains the first item');
console.log('xyzrender sheet editing interactions passed');

// A short additive lasso click must release capture without erasing selection.
let clears = 0;
let releases = 0;
const stroke = { pointerId: 2, dragging: false, additive: true, item: { releasePointerCapture() { releases++; } } };
const releaseLasso = new Function('stroke', 'clearXyzrenderSelection', `let xyzrenderLassoStroke = stroke; ${declaration('onXyzrenderLassoPointerUp')} return onXyzrenderLassoPointerUp;`)(stroke, () => clears++);
releaseLasso({ pointerId: 2 });
assert.deepEqual([clears, releases], [0, 1]);
console.log('xyzrender additive lasso click preserves selection and releases capture');

await new Promise(resolve => queueMicrotask(resolve));
assert.ok(published.includes(items[1]), 'active structure is sent to the inspector after selection');

const messages = [];
const config = { appViewer: true, documentId: 'doc', xyzrenderPreset: 'default', xyzrenderControls: { fog: true } };
const publish = new Function('document', 'window', 'activeConfig', 'postHostMessage', `
  let xyzrenderSheetRequestSerial = 0;
  const DEFAULT_XYZRENDER_CONTROLS = {};
  const xyzrenderSheetItemEntry = () => 'caffeine.xyz';
  const sheetEntryLabel = entry => entry;
  const sheetEntryInputDataBase64 = () => undefined;
  const sheetEntryInputExtension = () => 'xyz';
  const normalizeXyzrenderControls = value => value;
  const xyzrenderSheetItemRegions = () => [];
  const xyzrenderSheetItemVdwAtoms = () => '';
  const captureCurrentXyzrenderOrientationRef = () => null;
  ${declaration('publishXyzrenderItem')}
  return publishXyzrenderItem;
`)(document, window, config, message => messages.push(message));
publish(items[0]);
config.xyzrenderPreset = 'skeletal';
config.xyzrenderControls = { fog: false };
items[1].dataset.buretXyzrenderPreset = 'bubble';
items[1].dataset.buretXyzrenderControls = JSON.stringify({ fog: false });
publish(items[1]);
publish(items[0]);
assert.notEqual(messages[0].itemId, messages[1].itemId);
assert.deepEqual(messages.map(({type, preset, controls}) => [type, preset, controls.fog]), [
  ['xyzrenderActiveItem', 'default', true], ['xyzrenderActiveItem', 'bubble', false], ['xyzrenderActiveItem', 'default', true],
]);
assert.equal(messages[0].itemId, messages[2].itemId);
console.log('inspector selection preserves per-item identity and appearance across document default changes');

const removals = [];
const removeItem = new Function('postHostMessage', 'activeConfig', 'window', 'frontmostXyzrenderSheetItem', 'selectRotatableArtifact', `${declaration('removeXyzrenderSheetItem')} return removeXyzrenderSheetItem;`)(message => removals.push(message), config, window, () => items[0], () => {});
removeItem(items[1]);
assert.equal(items[1].isConnected, false);
assert.deepEqual(removals.map(({type, itemId, documentId}) => [type, itemId, documentId]), [['xyzrenderItemRemoved', messages[1].itemId, 'doc']]);
assert.match(declaration('showXyzrenderSheetContextMenu'), /\['view:hide', \(\) => removeXyzrenderSheetItem\(item\)\]/);
assert.match(declaration('installRotatableArtifactKeyboard'), /removeXyzrenderSheetItem\(item\)/);

// A tab drop arranges two structures side by side, preserving later manual placement.
const layoutSheet = document.createElement('div');
Object.defineProperties(layoutSheet, { clientWidth: { value: 1000 }, clientHeight: { value: 700 } });
layoutSheet.innerHTML = '<div class="buret-xyzrender-sheet-item"></div><div class="buret-xyzrender-sheet-item"></div>';
const arrange = new Function(declaration('layoutAddedXyzrenderSheetItems') + '; return layoutAddedXyzrenderSheetItems;')();
arrange(layoutSheet);
const pair = [...layoutSheet.children];
assert.ok(parseFloat(pair[0].style.left) + parseFloat(pair[0].style.width) / 2 < parseFloat(pair[1].style.left) - parseFloat(pair[1].style.width) / 2);
// A previously zoomed and panned viewport still receives fully visible items.
const layoutRoot = document.createElement('div');
layoutRoot.className = 'buret-external-artifact-root';
Object.defineProperties(layoutRoot, { clientWidth: { value: 1000 }, clientHeight: { value: 700 } });
layoutRoot.getBoundingClientRect = () => ({ left: 0, top: 0 });
layoutRoot.appendChild(layoutSheet);
layoutSheet.getBoundingClientRect = () => ({ left: -400, top: -250 });
arrange(layoutSheet, 2);
for (const item of pair) {
  const x = -400 + parseFloat(item.style.left) * 2;
  const y = -250 + parseFloat(item.style.top) * 2;
  const size = parseFloat(item.style.width) * 2;
  assert.ok(x - size / 2 >= 0 && x + size / 2 <= 1000);
  assert.ok(y - size / 2 >= 0 && y + size / 2 <= 700);
}
pair[0].dataset.buretSheetPositioned = 'true';
pair[0].style.left = '200px';
arrange(layoutSheet);
assert.equal(pair[0].style.left, '200px');
console.log('Sheet additions fit side by side and preserve manual placement');

// Dense selections must fit without overlapping in a small viewport at any zoom.
for (const count of [2, 5, 16, 40, 200]) {
  for (const scale of [0.5, 1, 2]) {
    const root = document.createElement('div');
    root.className = 'buret-external-artifact-root';
    Object.defineProperties(root, { clientWidth: { value: 420 }, clientHeight: { value: 320 } });
    root.getBoundingClientRect = () => ({ left: 0, top: 0 });
    const sheet = document.createElement('div');
    sheet.getBoundingClientRect = () => ({ left: -40, top: -25 });
    sheet.innerHTML = '<div class="buret-xyzrender-sheet-item"></div>'.repeat(count);
    root.appendChild(sheet);
    arrange(sheet, scale);
    const boxes = [...sheet.children].map(item => {
      const size = parseFloat(item.style.width) * scale;
      const x = -40 + parseFloat(item.style.left) * scale;
      const y = -25 + parseFloat(item.style.top) * scale;
      assert.ok(size > 0 && x - size / 2 >= 0 && x + size / 2 <= 420 && y - size / 2 >= 0 && y + size / 2 <= 320, `${count} items fit at ${scale} zoom`);
      return { x, y, size };
    });
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      assert.ok(Math.abs(a.x-b.x) >= (a.size+b.size)/2 || Math.abs(a.y-b.y) >= (a.size+b.size)/2, `${count} items do not overlap at ${scale} zoom`);
    }
  }
}
console.log('Dense sheet selections fit at 50%, 100% and 200% zoom');
