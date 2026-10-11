import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript-compiler-api'

// Exercise the actual adapter function/effect, without loading Ketcher or a
// browser. Geometry and resolved-paint spies make measurement counts explicit.
const source = readFileSync(new URL('../apps/desktop/src/components/ketcher-editor.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('ketcher-editor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const guard = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'suppressFilledKetcherSelectionPaths')
let observerEffect
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
    && node.arguments[0]?.getText(tree).includes('let suppressionFrame')) observerEffect = node.arguments[0]
  ts.forEachChild(node, visit)
}
visit(tree)
assert.ok(guard && observerEffect, 'Keep the real selection guard and coalesced observer effect')
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const reads = [], writes = [], frames = new Map()
let frameId = 0, mutationCallback, resizeCallback, mutationOptions, mutationTarget, resizeTarget, disconnects = 0
const context = {
  getComputedStyle(path) { reads.push(`paint:${path.id}`); return { fill: path.paint } },
  requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId },
  cancelAnimationFrame(id) { frames.delete(id) },
  MutationObserver: class {
    constructor(callback) { mutationCallback = callback }
    observe(target, options) { mutationTarget = target; mutationOptions = options }
    disconnect() { disconnects++ }
  },
  ResizeObserver: class {
    constructor(callback) { resizeCallback = callback }
    observe(target) { resizeTarget = target }
    disconnect() { disconnects++ }
  },
}
vm.createContext(context)
vm.runInContext(compile(guard.getText(tree) + '\nthis.guard = suppressFilledKetcherSelectionPaths;\nthis.install = ' + observerEffect.getText(tree)), context)

function path(id, paint, width, height, options = {}) {
  const attributes = { d: 'M0,0L10,0L8,3Z', fill: options.attributeFill ?? paint, stroke: '#123456', 'stroke-width': '2', transform: 'translate(12,34)' }
  const element = {
    id, paint, attributes,
    style: {
      setProperty(name, value, priority) {
        writes.push([id, name, value, priority])
        assert.equal(name, 'fill', 'Never change bond/atom geometry or scientific stroke properties')
        element.paint = value === 'transparent' ? 'rgba(0, 0, 0, 0)' : value
      },
    },
    getBBox() {
      reads.push(`bbox:${id}`)
      if (options.throws) throw new Error('Detached SVG')
      return { width, height }
    },
  }
  return element
}
function root(paths, width = 1000, height = 600) {
  const svg = { dataset: {} }
  return {
    svg, paths,
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) { assert.equal(selector, '[class*="StructEditor-module_intermediateCanvas"] > svg'); return svg },
    querySelectorAll(selector) { assert.equal(selector, '[data-testid="canvas"] path'); return paths },
    getBoundingClientRect() { reads.push('root-box'); return { width, height } },
  }
}
const measured = () => reads.filter(read => read.startsWith('bbox:'))
const reset = () => { reads.length = 0; writes.length = 0 }
const flush = () => {
  const pending = [...frames]
  for (const [id, callback] of pending) { frames.delete(id); callback() }
}

const ordinary = Array.from({ length: 400 }, (_, i) => path(`bond-${i}`, 'none', 600, 1))
const wedges = Array.from({ length: 8 }, (_, i) => path(`wedge-${i}`, 'rgb(0, 0, 0)', 20, 8))
const candidates = [
  path('large-black', 'rgb(0, 0, 0)', 900, 500),
  path('boundary-black', 'rgb(0, 0, 0)', 450, 270),
  path('css-overrides-none', 'rgb(0, 0, 0)', 800, 450, { attributeFill: 'none' }),
]
const other = [
  path('large-gray', 'rgb(115, 115, 115)', 900, 500),
  path('transparent', 'rgba(0, 0, 0, 0)', 900, 500),
  path('css-overrides-black', 'none', 900, 500, { attributeFill: 'black' }),
  path('long-bond', 'rgb(0, 0, 0)', 900, 2),
  path('narrow-black', 'rgb(0, 0, 0)', 449, 500),
  path('short-black', 'rgb(0, 0, 0)', 900, 269),
  path('detached', 'rgb(0, 0, 0)', 900, 500, { throws: true }),
]
const paths = [...ordinary, ...wedges, ...candidates, ...other]
const originalAttributes = structuredClone(paths.map(element => element.attributes))
const editorRoot = root(paths)
context.guard(editorRoot)
assert.equal(editorRoot.svg.dataset.testid, 'canvas', 'Restore the scoped adapter marker on replaced canvases')
assert.deepEqual(writes, candidates.map(candidate => [candidate.id, 'fill', 'transparent', 'important']))
assert.deepEqual(paths.map(element => element.attributes), originalAttributes, 'Keep exact d, transform, stereo wedge and scientific stroke attributes')
assert.equal(measured().length, 15, 'Measure only 8 wedges, 3 candidate overlays and 4 other black paths, not 418 paths')
assert.ok(measured().every(read => !read.includes('bond-') || read === 'bbox:long-bond'))
assert.equal(reads.filter(read => read === 'root-box').length, 1)
assert.equal(wedges.every(wedge => wedge.paint === 'rgb(0, 0, 0)'), true)
reset()
context.guard(editorRoot)
assert.equal(writes.length, 0, 'The guard is idempotent after suppressing candidates')
assert.equal(measured().length, 12, 'Transparent candidates do not get measured on the observer follow-up')
console.log('PASS: actual guard retains exactly the black+45%-width/height predicate, CSS overrides and canvas repair; preserves scientific d/strokes/transforms/wedges; 418→15 initial BBox calls and 12 after suppression')

reset()
const emptyPaintRoot = root(ordinary)
context.guard(emptyPaintRoot)
assert.equal(measured().length, 0)
assert.equal(reads.includes('root-box'), false, 'No root/SVG layout geometry for none-fill-only paths')
assert.equal(writes.length, 0)
console.log('PASS: ordinary none-fill paths do zero BBox/root geometry reads, with no scientific style changes')

reset()
context.rootRef = { current: emptyPaintRoot }
context.runtime = {}
const stop = context.install()
assert.equal(mutationTarget, emptyPaintRoot)
assert.equal(resizeTarget, emptyPaintRoot)
assert.deepEqual(Array.from(mutationOptions.attributeFilter), ['d', 'fill', 'style'])
assert.equal(mutationOptions.childList && mutationOptions.subtree && mutationOptions.attributes, true)
for (let i = 0; i < 40; i++) { mutationCallback([]); resizeCallback([]) }
assert.equal(frames.size, 1, 'Initial + mutation + resize bursts remain coalesced into one frame')
flush()
assert.equal(measured().length, 0)
assert.equal(reads.includes('root-box'), false)
// Keep full mutation coverage: a canvas replacement or CSS/ancestor change must
// still be checked. Do not optimize by ignoring raw fill="none" or style events.
reset()
const replacement = path('replacement-overlay', 'rgb(0, 0, 0)', 800, 500)
emptyPaintRoot.paths.push(replacement)
emptyPaintRoot.svg.dataset.testid = ''
mutationCallback([{ type: 'childList' }])
mutationCallback([{ type: 'attributes', attributeName: 'style' }])
assert.equal(frames.size, 1)
flush()
assert.deepEqual(writes, [['replacement-overlay', 'fill', 'transparent', 'important']])
assert.equal(emptyPaintRoot.svg.dataset.testid, 'canvas')
mutationCallback([])
assert.equal(frames.size, 1)
stop()
assert.equal(frames.size, 0, 'Cancel pending suppression on unmount')
assert.equal(disconnects, 2)
console.log('PASS: actual observer keeps full replacement/ancestor coverage, coalesces mutation/resize bursts, avoids geometry for none-fill follow-ups and cancels on teardown')
