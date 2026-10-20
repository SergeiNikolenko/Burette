import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript-compiler-api';
import { ketcherUiPlugin } from '../apps/desktop/vite/ketcher-ui.ts';
const path = new URL('../apps/desktop/node_modules/ketcher-react/dist/index.js', import.meta.url).pathname;
const native = readFileSync(path, 'utf8');
const plugin = ketcherUiPlugin();
const transform = code => plugin.transform(code, path).code;
const adapted = transform(native);
// Execute the actual transformed wheel handler, including native pan/zoom.
let wheelHandler
const adaptedTree = ts.createSourceFile('adapted.js', adapted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
function findWheel(node) {
  if (ts.isCallExpression(node) && node.arguments[1]?.getText(adaptedTree) === '"handleWheel"') wheelHandler = node.arguments[2]
  ts.forEachChild(node, findWheel)
}
findWheel(adaptedTree)
assert(wheelHandler && ts.isFunctionExpression(wheelHandler))
const wheelCalls = []
const pointer = { altKey: false }
const wheelEditor = {
  lastEvent: undefined,
  rotateController: { updateFloatingToolsPosition() { wheelCalls.push('rotate') } },
  hoverIcon: { updatePosition() { wheelCalls.push('icon') } },
  tool() { return { mousemove(event) { assert.equal(event, pointer); wheelCalls.push('hover') } } },
}
const wheel = vm.runInNewContext(`(${wheelHandler.getText(adaptedTree)})`, { _this: {
  editor: wheelEditor,
  scrollCanvas() { wheelCalls.push('pan') },
  props: { onZoomIn() { wheelCalls.push('in') }, onZoomOut() { wheelCalls.push('out') } },
} })
wheel({ ctrlKey: false })
assert.deepEqual(wheelCalls.splice(0), ['pan', 'rotate', 'icon'], 'First wheel pans without replaying an absent pointer')
wheelEditor.lastEvent = pointer
wheel({ ctrlKey: false })
assert.deepEqual(wheelCalls.splice(0), ['pan', 'rotate', 'icon', 'hover'])
for (const deltaY of [-1, 1]) wheel({ ctrlKey: true, deltaY, preventDefault() { wheelCalls.push('prevent') } })
assert.deepEqual(wheelCalls, ['prevent', 'in', 'prevent', 'out'], 'Keep native modifier zoom')
assert.throws(() => transform(native.replace('_this$editor$tool$mou.call(_this$editor$tool, _this.editor.lastEvent)', '_this$editor$tool$mou.call(_this$editor$tool, event)')), /canvas wheel contract changed/)
console.log('PASS: initial wheel, pointer replay, native modifier zoom and upstream drift guard');
