import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const create = source.slice(source.indexOf('  async function createViewer() {'), source.indexOf('  function ensureMolstarStylesheet()', source.indexOf('  async function createViewer() {')));
for (const background of [0x111111, 0xffffff]) {
  const events = [];
  const viewer = { plugin: { spec: {}, canvas3d: {
    setProps: props => events.push(['background', props.renderer.backgroundColor]),
    requestDraw: () => events.push('draw'),
  } } };
  const context = vm.createContext({
    window: { molstar: { Viewer: { create: async () => { events.push('create'); return viewer; } } } },
    document: { getElementById: () => ({ classList: { add: () => events.push('hide'), remove: () => events.push('show') } }) },
    debug() {}, createViewerOptions: () => ({}), transparentBackground: false,
    canvasBackgroundColor: () => background,
    requestAnimationFrame: callback => { events.push('frame'); queueMicrotask(callback); },
  });
  await vm.runInContext(`${create}\ncreateViewer()`, context);
  assert.deepEqual(events, ['hide', 'create', ['background', background], 'draw', 'frame', 'frame', 'show']);
}
console.log('Molstar first frame: configured background is drawn before reveal in light and dark themes.');
