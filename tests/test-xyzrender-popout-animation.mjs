import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Window } from 'happy-dom';
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { GIFEncoder } = require('gifenc');
const { parseGIF, decompressFrames } = require('gifuct-js');

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const tail = source.slice(start + 2);
  const end = tail.search(/\n  (?:async )?function /);
  return end < 0 ? tail : tail.slice(0, end);
}
const window = new Window();
const { document } = window;
// Use two frames with different delays and transparency, rather than a still image.
const gif = GIFEncoder();
for (const [index, delay] of [[1, 40], [2, 100]]) gif.writeFrame(new Uint8Array([index]), 1, 1, {
  palette: [[0, 0, 0], [255, 0, 0], [0, 0, 255]], delay, repeat: 0, transparent: true, transparentIndex: 0,
});
gif.finish();
const data = `data:image/gif;base64,${Buffer.from(gif.bytes()).toString('base64')}`;
function makeItem() {
  const item = document.createElement('div');
  item.className = 'buret-xyzrender-sheet-item selected';
  item.innerHTML = '<div class="buret-xyzrender-sheet-item-body"><svg viewBox="0 0 10 10"></svg></div>';
  return item;
}
const functions = new Function('document', `${declaration('xyzrenderPopoutAnimation')}\n${declaration('restoreXyzrenderPopoutAnimation').split("\n  window.addEventListener")[0]}\nreturn { xyzrenderPopoutAnimation, restoreXyzrenderPopoutAnimation };`)(document);
const original = makeItem();
document.body.append(original);
assert.equal(functions.xyzrenderPopoutAnimation(original), null);
const image = document.createElement('img');
image.className = 'buret-xyzrender-animation-image';
image.src = data;
original.firstElementChild.append(image);
Object.defineProperties(image, { complete: { value: false, configurable: true }, naturalWidth: { value: 0, configurable: true } });
assert.throws(() => functions.xyzrenderPopoutAnimation(original), /finish loading/);
Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 1 } });
assert.equal(functions.xyzrenderPopoutAnimation(original), data);
const canvas = document.createElement('canvas');
canvas.className = 'buret-xyzrender-animation-canvas';
original.firstElementChild.append(canvas);
assert.throws(() => functions.xyzrenderPopoutAnimation(original), /Apply or cancel/);
canvas.remove();
image.src = 'https://example.test/animation.gif';
assert.throws(() => functions.xyzrenderPopoutAnimation(original), /could not be moved/);
image.src = data;

const snapshot = new Function('document', 'window', 'activeConfig', 'xyzrenderItemPayload', 'externalArtifactViewSnapshot', 'xyzrenderPopoutAnimation', `${declaration('executeBuretteAgentAction')}\nreturn executeBuretteAgentAction;`)(document, window, { renderer: 'xyzrender-external' }, () => ({ path: '/caffeine.xyz' }), () => ({ scale: 2, x: 3, y: 4 }), functions.xyzrenderPopoutAnimation);
const { result: { sheet } } = await snapshot({ type: 'workspace_scene_snapshot' });
assert.equal(sheet.items[0].animation, data);
assert.deepEqual(sheet.view, { scale: 2, x: 3, y: 4 });
const bytes = Buffer.from(sheet.items[0].animation.split(',')[1], 'base64');
assert.deepEqual(bytes, Buffer.from(gif.bytes()));
assert.deepEqual(decompressFrames(parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), true).map(frame => frame.delay), [40, 100]);
// Control image completion: happy-dom otherwise dispatches load synchronously.
const createElement = document.createElement.bind(document);
document.createElement = (...args) => {
  const element = createElement(...args);
  if (args[0] === 'img') {
    let src = '';
    Object.defineProperty(element, 'src', { get: () => src, set: value => { src = value; } });
  }
  return element;
};
const restored = makeItem();
functions.restoreXyzrenderPopoutAnimation(restored, sheet.items[0].animation);
const restoredImage = restored.querySelector('img');
assert.deepEqual([restoredImage.src, restoredImage.dataset.buretPopoutAnimation, restored.querySelector('svg').style.visibility], [data, 'loading', 'hidden']);
restoredImage.dispatchEvent(new window.Event('load'));
assert.equal(restoredImage.dataset.buretPopoutAnimation, 'ready');
const failed = makeItem();
functions.restoreXyzrenderPopoutAnimation(failed, data);
failed.querySelector('img').dispatchEvent(new window.Event('error'));
assert.equal(failed.querySelector('img').dataset.buretPopoutAnimation, 'failed');
for (const invalid of ['', 'https://example.test/a.gif', 'data:image/svg+xml;base64,AAAA', 'data:image/gif;base64,??', `data:image/gif;base64,${'A'.repeat(24000000)}`]) {
  assert.throws(() => functions.restoreXyzrenderPopoutAnimation(makeItem(), invalid), /invalid/);
}
const root = document.createElement('div');
const restoredConfig = { popoutSheet: sheet };
sheet.items[0].geometry = { left: 20, top: 30, width: 400, height: 350, rotation: 12 };
const restoreStart = source.indexOf('    const restoredSheet = activeConfig?.popoutSheet;');
const restoreEnd = source.indexOf('    const viewportCleanup =', restoreStart);
new Function('activeConfig', 'root', 'ensureXyzrenderSheet', 'addXyzrenderSheetItem', 'setSheetItemRotation', 'restoreXyzrenderPopoutAnimation', `let scale = 1, translateX = 0, translateY = 0; const stage = root; const setXyzrenderSheetItemRegions = () => {}, setXyzrenderSheetItemVdwAtoms = () => {};\n${source.slice(restoreStart, restoreEnd)}`)(restoredConfig, root, () => root, (_sheet, svg) => {
  const item = makeItem();
  item.firstElementChild.innerHTML = svg;
  root.append(item);
  return item;
}, (item, rotation) => { item.dataset.rotation = String(rotation); }, functions.restoreXyzrenderPopoutAnimation);
assert.deepEqual([root.firstElementChild.style.left, root.firstElementChild.style.width, root.firstElementChild.dataset.rotation, root.querySelector('img').src], ['20px', '400px', '12', data]);
assert.equal(restoredConfig.popoutSheet, undefined, 'a later style edit does not replay the checkpoint');
original.querySelector('svg').innerHTML = 'A'.repeat(24 * 1024 * 1024);
await assert.rejects(snapshot({ type: 'workspace_scene_snapshot' }), /too large/);
console.log('XYZ popout: exact committed GIF frame data/timing, loading acknowledgement, draft rejection and bounded payload passed');
