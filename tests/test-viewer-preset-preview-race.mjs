import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8')
function functionSource(text, name, next) {
  const start = text.indexOf(`  ${name}`)
  const end = text.indexOf(`\n  ${next}`, start)
  assert.ok(start >= 0 && end > start, `Missing ${name}`)
  return text.slice(start, end)
}
const scheduler = functionSource(source, 'function scheduleMolstarPresetPreview(item)', 'function scheduleMolstarPresetPreviewResize(item)')
const renderer = functionSource(source, 'async function renderMolstarPresetPreview(viewer,', 'function scheduleMolstarPresetPreview(item)')

function fixture() {
  const pending = [], captured = [], errors = []
  const state = {cached: '', constrained: false, budget: ''}
  const preview = {classList: {contains: () => state.constrained, remove() {}, add() {}}, removeAttribute() {}}
  const viewer = {plugin: {state: {data: {setSnapshot() {}}}, runTask: () => new Promise(resolve => pending.push(resolve))}}
  const context = vm.createContext({
    activeViewer: {plugin: {state: {data: {getSnapshot: () => ({})}}}}, activeConfig: {},
    molstarPresetPreviewSerial: 0, molstarPresetPreviewPreset: '',
    cancelMolstarPresetPreviewClose() {}, molstarPresetOption: value => ({value}),
    showMolstarPresetPreviewShell() {}, molstarPresetPreviewElements: () => ({preview}),
    molstarPresetPreviewBudgetMessage: () => state.budget,
    restoreCachedMolstarPresetPreview: (_, preset) => preset === state.cached,
    hideFailedMolstarPresetPreview: error => errors.push(error),
    captureMolstarCameraSnapshot: () => null, copyMolstarPresetPreviewCanvasProps() {},
    applyMolstarProviderPreset() {}, applyMolstarStyle() {}, molstarPresetAppearance() {},
    applyMolstarAppearance() {}, applyViewerBackground() {}, waitForAnimationFrame() {},
    waitForMolstarPresetPreviewDraw() {},
    captureMolstarPresetPreview: item => captured.push(item.dataset.buretMolstarPreset),
  })
  vm.runInContext(`${renderer}\n${scheduler}`, context)
  const renders = []
  context.ensureMolstarPresetPreviewController = () => ({
    show() {}, requestPreview(request) {
      const render = context.renderMolstarPresetPreview(viewer, request)
      renders.push(render)
      return render
    },
  })
  return {state, pending, captured, errors, context, renders,
    hover(preset) {context.scheduleMolstarPresetPreview({dataset: {buretMolstarPreset: preset}})},
  }
}

for (const mode of ['cache', 'constrained', 'budget']) {
  test(`a ${mode} hover invalidates an older asynchronous preview`, async () => {
    const f = fixture()
    f.hover('spacefill')
    assert.equal(f.pending.length, 1)
    if (mode === 'cache') f.state.cached = 'ghost-surface'
    if (mode === 'constrained') f.state.constrained = true
    if (mode === 'budget') f.state.budget = 'Preview unavailable'
    f.hover('ghost-surface')
    assert.equal(f.context.molstarPresetPreviewSerial, 2)
    assert.equal(f.pending.length, 1, 'early return must not start a new renderer')
    f.pending[0]()
    await Promise.all(f.renders)
    assert.deepEqual(f.captured, [], 'stale render must not capture or cache its frame')
    assert.equal(f.errors.length, mode === 'budget' ? 1 : 0)
  })
}

test('a current preview still renders; repeated hover does not restart it', async () => {
  const f = fixture()
  f.hover('ghost-surface')
  f.hover('ghost-surface')
  assert.equal(f.context.molstarPresetPreviewSerial, 1)
  f.pending[0]()
  await Promise.all(f.renders)
  assert.deepEqual(f.captured, ['ghost-surface'])
  assert.deepEqual(f.errors, [])
})

