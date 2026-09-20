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
const api = new Function('document', `let xyzrenderLassoEnabled = false; ${names.map(declaration).join('\n')} return { ${names.join(',')} };`)(document);
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
