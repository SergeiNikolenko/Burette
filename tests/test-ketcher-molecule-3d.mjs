import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript-compiler-api'

const source = readFileSync(new URL('../apps/desktop/src/components/ketcher/molecule-3d-preview.tsx', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
let shellTheme = null
const document = { querySelector: () => shellTheme === null ? null : { getAttribute: () => shellTheme }, documentElement: { dataset: { theme: 'light' }, classList: { contains: () => false } } }
const context = { exports: {}, document, require: name => name === 'react' ? { Component: class {} } : {} }
vm.runInNewContext(js, context)
const { molecule3dOptions, registerDarkElementPalette } = context.exports
const chemicalOptions = {
  settings: { editing: true, inversePanning: true, autoPreset: false, bg: { color: 0xcccccc } },
  reps: [{ mode: 'BS', colorer: 'EL' }, { mode: ['TX', { template: '{{elem}}', showBg: true, bg: 0xcccccc }], selector: 'not elem C', colorer: 'EL' }],
}
const before = JSON.stringify(chemicalOptions)
const light = molecule3dOptions(chemicalOptions)
assert.equal(light.settings.bg.color, 0xffffff)
assert.equal(light.settings.editing, true, 'Keep native component and fragment editing available')
assert.equal(light.settings.inversePanning, true)
assert.equal(light.reps[0].mode, 'BS')
assert.equal(light.reps[0].colorer, 'EL', 'Keep elemental colors')
assert.equal(light.reps[1].selector, 'not elem C')
assert.equal(light.reps[1].mode[1].template, '{{elem}}')
assert.equal(light.reps[1].mode[1].showBg, false)
assert.equal(JSON.stringify(chemicalOptions), before, 'Do not modify Ketcher options or molecular source')
document.documentElement.dataset.theme = 'dark'
const dark = molecule3dOptions(chemicalOptions)
assert.equal(dark.settings.bg.color, 0x171717)
assert.equal(dark.reps[1].mode[1].bg, 0x171717)
assert.equal(dark.reps[1].colorer, 'EL')
assert.equal(dark.settings.palette, 'JM-burette-dark')
assert.equal(dark.settings.fog, false, 'Do not fade labels and bonds into the dark background')
assert.equal(light.settings.palette, 'JM')
shellTheme = 'light'
assert.equal(molecule3dOptions(chemicalOptions).settings.bg.color, 0xffffff, 'Resolved Burette shell overrides document theme')
document.documentElement.dataset.theme = 'light'
shellTheme = 'dark'
assert.equal(molecule3dOptions(chemicalOptions).settings.palette, 'JM-burette-dark', 'Auto theme uses resolved shell mode')
shellTheme = null
document.documentElement.dataset.theme = 'dark'
const originalPalette = {
  id: 'JM', elementColors: { C: 0x909090, N: 0x3050f8, O: 0xff0d0d, P: 0xff8000, S: 0xffff30, CL: 0x1ff01f, BR: 0xa62929 },
  getElementColor(element) { return this.elementColors[element] },
}
const paletteBefore = JSON.stringify(originalPalette)
const palettes = new Map([['JM', originalPalette]])
const registry = { get: id => palettes.get(id), register: palette => palettes.set(palette.id, palette) }
registerDarkElementPalette(registry, chemicalOptions)
registerDarkElementPalette(registry, chemicalOptions)
assert.equal(palettes.size, 2, 'Register one isolated palette, without replacing native JM')
assert.equal(JSON.stringify(originalPalette), paletteBefore)
const darkPalette = palettes.get(dark.settings.palette)
assert.equal(darkPalette.getElementColor('C'), 0xd0d0d0)
const contrast = color => {
  const linear = [color >> 16 & 255, color >> 8 & 255, color & 255].map(channel => { const c = channel / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 })
  return (.2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2] + .05) / (.00857 + .05)
}
for (const [element, color] of Object.entries(darkPalette.elementColors)) assert(contrast(color) >= 4.5, `${element} label remains readable`)
assert.equal(darkPalette.elementColors.S, originalPalette.elementColors.S, 'Already readable elemental colors remain unchanged')
for (const element of ['N', 'O', 'P', 'CL', 'BR']) {
  const before = originalPalette.elementColors[element], after = darkPalette.elementColors[element]
  const channels = color => [color >> 16 & 255, color >> 8 & 255, color & 255]
  assert.equal(channels(after).indexOf(Math.max(...channels(after))), channels(before).indexOf(Math.max(...channels(before))), `${element} keeps its identifying hue`)
}
console.log('PASS: isolated native dark elemental palette; readable carbon, N/O/P/S/halogen labels; original palette and hue identities preserved')
console.log('PASS: neutral two-theme 3D options preserve molecular representation and elemental colors; native component and fragment editing')

// Exercise the source-owned controls and confirm that rotation stays a preview
// until Apply is explicitly confirmed. Chemistry remains in upstream callbacks.
const hooks = []
let hookIndex = 0, applyCalls = 0, cancelCalls = 0, resetCalls = 0, originalInitCalls = 0
const jsx = (type, props) => ({ type, props })
const react = {
  Component: class {}, Suspense: 'suspense',
  useRef(value) { const index = hookIndex++; return hooks[index] ??= { current: value } },
  useState(value) { const index = hookIndex++; hooks[index] ??= value; return [hooks[index], next => { hooks[index] = next }] },
  useCallback: callback => callback, useEffect() {},
}
const uiContext = {
  exports: {}, document,
  require(name) {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    return new Proxy({}, { get: (_, key) => key === 'MiewViewer' ? 'viewer' : key })
  },
}
vm.runInNewContext(js, uiContext)
let componentCommits = 0, fragmentCommits = 0, lastSettings
const engine = {
  _editMode: 0,
  _enterComponentEditMode() { this._editMode = 1 }, _enterFragmentEditMode() { this._editMode = 2 },
  _applyComponentEdit() { componentCommits++; this._editMode = 0 },
  _applyFragmentEdit() { fragmentCommits++; this._editMode = 0 },
  _discardComponentEdit() { this._editMode = 0 }, _discardFragmentEdit() { this._editMode = 0 },
  set(value) { lastSettings = value }, resetView() { resetCalls++ }, setOptions(value) { assert.equal(value.reps[0].colorer, 'EL') },
}
const props = {
  Viewer: 'viewer', options: chemicalOptions, disabled: false, initialized: true,
  onInit: async value => { originalInitCalls++; assert.equal(value, engine); value.set({ bg: { color: 0xcccccc } }) },
  onApply: () => { applyCalls++ }, params: { onCancel: () => { cancelCalls++ } },
}
const render = () => { hookIndex = 0; return uiContext.exports.Molecule3dPreview(props) }
const find = (node, predicate) => {
  if (!node) return
  if (predicate(node)) return node
  for (const child of [node.props?.children].flat()) { const found = find(child, predicate); if (found) return found }
}
const byTestId = (node, id) => find(node, child => child.props?.['data-testid'] === id)
const byText = (node, text) => find(node, child => child.props?.children === text)
let tree = render()
await find(tree, node => node.type === 'viewer').props.onInit(engine)
assert.equal(originalInitCalls, 1)
assert.equal(lastSettings.bg.color, 0x171717, 'Apply Atlas background after the original asynchronous loader')
assert.equal(lastSettings.palette, 'JM-burette-dark')
assert.equal(lastSettings.fog, false, 'Disable native label fog after the original asynchronous loader')
assert.equal(resetCalls, 0, 'Post-load theme update must not reset the camera')
assert.equal(find(tree, node => node.props?.role === 'alert'), undefined, 'No scientific warning before an Apply decision')
const canvas = byTestId(tree, 'molecule-3d-canvas')
canvas.props.onPointerDownCapture({ button: 0, clientX: 100, clientY: 100 })
canvas.props.onPointerMoveCapture({ buttons: 1, clientX: 150, clientY: 110 })
canvas.props.onPointerUpCapture()
tree = render()
assert.equal(applyCalls, 0, 'Rotating the preview must not write to Ketcher')
assert.equal(find(tree, node => node.props?.role === 'alert'), undefined)
byTestId(tree, 'miew-modal-button').props.onClick()
assert.equal(applyCalls, 0, 'First Apply must show the stereo warning after rotation')
tree = render()
assert(find(tree, node => node.props?.role === 'alert'))
assert.equal(byTestId(tree, 'miew-modal-button').props.children, 'Apply rotation')
byTestId(tree, 'miew-modal-button').props.onClick()
assert.equal(applyCalls, 1)
byText(tree, 'Cancel').props.onClick()
assert.equal(cancelCalls, 1)
assert.equal(applyCalls, 1, 'Cancel must not apply coordinates')
byText(tree, 'Reset view').props.onClick()
assert.equal(resetCalls, 1)
tree = render()
assert.equal(byTestId(tree, 'miew-modal-button').props.children, 'Apply')
assert.equal(find(tree, node => node.props?.role === 'alert'), undefined)
console.log('PASS: initialization forwarding; preview-only rotation; stereo warning at Apply; explicit confirmation; Cancel isolation; Reset view')

// Native chemical edits remain separate from the host structure until Apply.
const selectMode = next => find(tree, node => node.type === 'Select').props.onValueChange(next)
selectMode('components')
assert.equal(engine._editMode, 1)
tree = render()
const componentCanvas = byTestId(tree, 'molecule-3d-canvas')
componentCanvas.props.onPointerDownCapture({ button: 0, clientX: 100, clientY: 100 })
componentCanvas.props.onPointerMoveCapture({ buttons: 1, clientX: 150, clientY: 110 })
componentCanvas.props.onPointerUpCapture()
tree = render()
byTestId(tree, 'miew-modal-button').props.onClick()
assert.equal(componentCommits, 0, 'The first Apply must not commit pending native chemical edits')
assert.equal(applyCalls, 1)
tree = render()
byTestId(tree, 'miew-modal-button').props.onClick()
assert.equal(componentCommits, 1)
assert.equal(applyCalls, 2)
selectMode('fragments')
assert.equal(engine._editMode, 2)
tree = render()
byText(tree, 'Cancel').props.onClick()
assert.equal(fragmentCommits, 0, 'Cancel must not commit the pending fragment rotation')
assert.equal(applyCalls, 2)
console.log('PASS: explicit native component/fragment modes; chemical edits committed only after Apply confirmation; fragment Cancel isolation')

// Test the installed renderer, not just adapter options: Miew's CSS labels are
// blended toward the scene fog color unless fog is explicitly disabled.
const THREE = await import('three')
const miewSource = readFileSync(new URL('../apps/desktop/node_modules/miew/dist/Miew.module.js', import.meta.url), 'utf8')
const rendererStart = miewSource.indexOf('class CSS2DRenderer {')
const rendererEnd = miewSource.indexOf('/* harmony default export */ const gfx_CSS2DRenderer', rendererStart)
assert(rendererStart >= 0 && rendererEnd > rendererStart, 'Review native label rendering when Miew changes')
class CSS2DObject extends THREE.Object3D {
  constructor(color) { super(); this.userData.color = color; this.userData.background = 'transparent'; this.element = { style: {} }; this.position.z = -5; this.updateMatrixWorld() }
  getElement() { return this.element }
}
const rendererContext = {
  exports: {}, document: { createElement: () => ({ style: {}, appendChild() {} }) },
  external_module_three_commonjs_three_commonjs2_three_amd_three_root_THREE_namespaceObject: THREE,
  gfx_CSS2DObject: CSS2DObject, tempColor: new THREE.Color(),
}
vm.runInNewContext(miewSource.slice(rendererStart, rendererEnd) + '\nexports.Renderer = CSS2DRenderer', rendererContext)
const renderer = new rendererContext.exports.Renderer()
renderer.setSize(600, 440)
const camera = new THREE.PerspectiveCamera(45, 600 / 440, .5, 100)
for (const element of ['N', 'O', 'P', 'S', 'CL', 'BR']) {
  const color = darkPalette.getElementColor(element)
  const label = new CSS2DObject(color)
  renderer._renderObject(label, camera, { fog: undefined })
  assert.equal(label.element.style.color, `#${color.toString(16).padStart(6, '0')}`, `${element} DOM label uses the actual high-contrast native palette without depth fading`)
  assert(contrast(Number.parseInt(label.element.style.color.slice(1), 16)) >= 4.5)
}
const fadedOxygen = new CSS2DObject(darkPalette.getElementColor('O'))
renderer._renderObject(fadedOxygen, camera, { fog: new THREE.Fog(0x171717, 1, 10) })
assert.notEqual(fadedOxygen.element.style.color, `#${darkPalette.getElementColor('O').toString(16).padStart(6, '0')}`, 'Native fog reproduces the observed label contrast regression')
console.log('PASS: installed native CSS2DRenderer emits high-contrast elemental DOM labels; fog regression reproduced and excluded')

// Execute the installed settings subscription and term implementations to prove
// that cleanup belongs to an individual viewer, including concurrent viewers.
const viewerSource = readFileSync(new URL('../apps/desktop/src/components/ketcher/miew-viewer.tsx', import.meta.url), 'utf8')
const viewerJS = ts.transpileModule(viewerSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
const lifecycleContext = { exports: {}, require: () => ({}) }
vm.runInNewContext(viewerJS, lifecycleContext)
const settings = {
  _handlers: {}, now: {},
  addEventListener(event, callback, context) { (this._handlers[event] ??= []).push([callback, context]) },
  removeEventListener(event, callback, context) { this._handlers[event] = this._handlers[event].filter(pair => pair[0] !== callback || pair[1] !== context) },
  emit(event) { for (const [callback] of [...(this._handlers[event] ?? [])]) callback({ value: false }) },
}
let externalCalls = 0
settings.addEventListener('change:fog', () => { externalCalls++ })
class NativeTestViewer {
  static settings = settings
  constructor() { this.settings = settings; this._gfx = { scene: {} }; this._loading = []; this._objects = []; this.updates = 0; this._initOnSettingsChanged() }
  _showMessage() {}
  halt() {}
  _updateFog() { assert(this._gfx?.scene, 'A disposed viewer must never receive a fog change'); this.updates++ }
}
const nativeLifecycleContext = {
  Miew: NativeTestViewer,
  external_module_lodash_commonjs_lodash_commonjs2_lodash_amd_lodash_root_namespaceObject: { default: { isArray: Array.isArray } },
}
for (const name of ['_initOnSettingsChanged', 'term']) {
  const start = miewSource.indexOf(`Miew.prototype.${name} = function (`)
  const end = miewSource.indexOf('\r\n};', start) + 4
  assert(start >= 0 && end > start, `Review native ${name} lifecycle when Miew changes`)
  vm.runInNewContext(miewSource.slice(start, end), nativeLifecycleContext)
}
const { createMiewInstance } = lifecycleContext.exports
const first = createMiewInstance(NativeTestViewer, {})
const concurrent = createMiewInstance(NativeTestViewer, {})
settings.emit('change:fog')
assert.equal(first.viewer.updates, 1)
assert.equal(concurrent.viewer.updates, 1)
first.dispose()
assert.equal(first.viewer._gfx, null, 'Native term still runs')
settings.emit('change:fog')
assert.equal(concurrent.viewer.updates, 2, 'Preserve the other active viewer settings handlers')
const reopened = createMiewInstance(NativeTestViewer, {})
settings.emit('change:fog')
assert.equal(reopened.viewer.updates, 1, 'Reopened viewer receives settings without notifying the disposed one')
concurrent.dispose(); reopened.dispose(); first.dispose()
settings.emit('change:fog')
assert.equal(externalCalls, 4, 'Never remove non-viewer listeners')
assert.equal(Object.values(settings._handlers).flat().length, 1, 'All owned native handlers are released')
console.log('PASS: installed native init/term subscriptions; reopen after disposal; concurrent viewer and external listener isolation; idempotent cleanup')
