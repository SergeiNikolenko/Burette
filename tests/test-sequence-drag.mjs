import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const window = new Window();
const { document } = window;
const frames = new Map();
let frameId = 0;
const tick = time => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(time));
};
const bind = new Function('MouseEvent', 'requestAnimationFrame', 'cancelAnimationFrame',
  readFileSync(new URL('../apps/desktop/src/preview-sequence/drag-selection.js', import.meta.url), 'utf8')
    .replace('export function', 'function') + '\nreturn bindSequenceDrag;')(
  window.MouseEvent, callback => { frames.set(++frameId, callback); return frameId; }, id => frames.delete(id));
document.body.innerHTML = '<div class="msp-sequence"><div class="msp-sequence-wrapper-non-empty"><div class="msp-sequence-wrapper"></div></div></div>';
const panel = document.querySelector('.msp-sequence');
const reading = panel.firstElementChild;
const wrapper = reading.firstElementChild;
reading.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 70 });
let horizontal = false;
for (let i = 0; i < 30; i++) {
  const node = document.createElement('span');
  node.dataset.seqid = String(i);
  node.getBoundingClientRect = () => {
    const left = (horizontal ? i : i % 10) * 10;
    const top = horizontal ? 20 : Math.floor(i / 10) * 40 + 20;
    return { left, right: left + 10, top, bottom: top + 20 };
  };
  wrapper.append(node);
}
const send = (node, type, x, y, buttons = 1) => node.dispatchEvent(new window.MouseEvent(type, {
  bubbles: true, button: 0, buttons, clientX: x, clientY: y,
}));
const committed = [];
wrapper.addEventListener('mouseup', event => committed.push(event.target.dataset.seqid));
const dispose = bind(panel);
send(wrapper.children[1], 'mousedown', 15, 25);
send(document.body, 'mousemove', 25, 75);
tick(16); tick(48);
assert.ok(reading.scrollTop > 0, 'holding below the viewport scrolls the sequence');
assert.ok(panel.querySelectorAll('[data-buret-drag-selected]').length > 10, 'preview extends through numbered rows');
send(document.body, 'mouseup', 25, 75, 0);
assert.equal(committed.length, 1, 'release outside the panel commits once through Mol*');
assert.ok(Number(committed[0]) > 10, 'commit uses the endpoint reached after scrolling');
assert.equal(panel.querySelectorAll('[data-buret-drag-selected]').length, 0);
assert.equal(frames.size, 0);
let blankDowns = 0;
wrapper.addEventListener('mousedown', () => blankDowns++);
for (const target of [wrapper, reading]) {
  send(target, 'mousedown', 95, 65);
  send(target, 'mouseup', 95, 65, 0);
}
assert.equal(blankDowns, 0, 'blank reading-area presses do not reach Mol* picking');
assert.equal(committed.length, 1, 'blank clicks preserve the existing selection');
assert.equal(frames.size, 0, 'blank clicks do not start a drag');
horizontal = true;
reading.scrollTop = 0;
reading.scrollLeft = 0;
send(wrapper.children[1], 'mousedown', 15, 25);
send(document.body, 'mousemove', 120, 25);
tick(16); tick(48);
assert.ok(reading.scrollLeft > 0, 'compact tracks scroll horizontally');
window.dispatchEvent(new window.Event('blur'));
assert.equal(frames.size, 0, 'losing focus cancels scrolling');
assert.equal(panel.querySelectorAll('[data-buret-drag-selected]').length, 0);
dispose();
send(wrapper.children[1], 'mousedown', 15, 25);
assert.equal(frames.size, 0, 'unmounted panels no longer start drags');
window.happyDOM.abort();
console.log('Sequence drag: row ranges, edge scrolling, outside release, horizontal mode and cleanup passed');
