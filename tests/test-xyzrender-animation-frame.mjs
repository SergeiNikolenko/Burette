import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
const source = readFileSync('PreviewExtension/Web/viewer.js', 'utf8');
const start = source.indexOf("    if (event.source === window.parent && body.type === 'applyXyzrenderAnimationFrame')");
const end = source.indexOf("    if (event.source === window.parent && body.type === 'applyXyzrenderAnimation')", start);
const window = new Window();
const { document } = window;
document.body.innerHTML = '<div class="buret-xyzrender-sheet-item" data-buret-xyzrender-editor-id="test"><div class="buret-xyzrender-sheet-item-body"><svg></svg></div></div>';
let painted;
window.HTMLCanvasElement.prototype.getContext = () => ({ putImageData: data => { painted = data; } });
class ImageData { constructor(pixels, width, height) { Object.assign(this, {pixels, width, height}); } }
const receive = new Function('event', 'body', 'window', 'document', 'ImageData', source.slice(start, end));
const body = { type: 'applyXyzrenderAnimationFrame', itemId: 'test', width: 2, height: 2, pixels: new Uint8ClampedArray(16).fill(255) };
const send = (message, sender = window.parent) => receive({ source: sender }, message, window, document, ImageData);
send(body, {}); assert.equal(document.querySelector('canvas'), null);
send({...body, pixels: new Uint8ClampedArray(3)}); assert.equal(document.querySelector('canvas'), null);
send(body); const canvas = document.querySelector('canvas');
assert.deepEqual([canvas.width, canvas.height, painted.pixels.length], [2,2,16]);
assert.equal(document.querySelector('svg').style.visibility, 'hidden');
send({...body, pixels: new Uint8ClampedArray(16)});
assert.equal(document.querySelector('canvas'), canvas); assert.equal(painted.pixels[0], 0);
console.log('animation frame bridge: validates sender and pixels, reuses canvas, updates pixels');

// Ending a preview restores the static drawing, or the applied GIF when present.
send({ type: 'clearXyzrenderAnimationPreview', itemId: 'test' });
assert.equal(document.querySelector('canvas'), null);
assert.equal(document.querySelector('svg').style.visibility, '');
send(body);
const gif = document.createElement('img');
gif.className = 'buret-xyzrender-animation-image';
document.querySelector('.buret-xyzrender-sheet-item-body').append(gif);
send(body);
assert.equal(gif.style.visibility, 'hidden');
send({ type: 'clearXyzrenderAnimationPreview', itemId: 'test' });
assert.deepEqual([document.querySelector('canvas'), gif.style.visibility, document.querySelector('svg').style.visibility], [null, 'visible', 'hidden']);
gif.remove();
send(body);
console.log('animation preview clear: restores the drawing or the applied GIF');

// A live preview belongs to the original item; its copy shows the real artwork.
const canvasAfterClear = document.querySelector('canvas');
const original = document.querySelector('.buret-xyzrender-sheet-item');
const duplicateStart = source.indexOf('  function duplicateXyzrenderSheetItems(item)');
const duplicateEnd = source.indexOf('  function arrangeXyzrenderSheetItems', duplicateStart);
const stage = document.createElement('div');
stage.className = 'buret-external-artifact-stage';
const root = document.createElement('div'); root.append(stage);
let copiedBody;
const duplicate = new Function('document', 'selectedXyzrenderSheetItemsForAction', 'ensureXyzrenderSheet', 'sheetItemCenterPosition', 'addXyzrenderSheetItem', 'sheetItemExportLabel', 'xyzrenderSheetItemEntry', 'setSheetItemRotation', 'clearRotatableArtifactSelection', 'publishXyzrenderSelection', `${source.slice(duplicateStart, duplicateEnd)}; return duplicateXyzrenderSheetItems;`)(document,
  () => ({root, items: [original]}), () => stage, () => ({left: 0, top: 0}),
  (_sheet, html) => { copiedBody = document.createElement('div'); copiedBody.innerHTML = html; return copiedBody; },
  () => 'caffeine.xyz', () => ({}), () => {}, () => {}, () => {});
duplicate(original);
assert.equal(copiedBody.querySelector('canvas'), null);
assert.equal(copiedBody.querySelector('img'), null);
assert.equal(copiedBody.querySelector('svg').style.visibility, '');
assert.equal(original.querySelector('canvas'), canvasAfterClear, 'the original keeps its preview');
original.querySelector('.buret-xyzrender-sheet-item-body').innerHTML = '<svg style="visibility:hidden"></svg><img class="buret-xyzrender-animation-image" style="visibility:hidden" src="data:image/gif;base64,Z2lm"><canvas class="buret-xyzrender-animation-canvas"></canvas>';
duplicate(original);
assert.equal(copiedBody.querySelector('canvas'), null);
assert.equal(copiedBody.querySelector('img').src, 'data:image/gif;base64,Z2lm');
assert.equal(copiedBody.querySelector('img').style.visibility, 'visible');
console.log('animation duplication: drops the live preview and keeps committed GIFs');
