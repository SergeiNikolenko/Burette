import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { ketcherUiPlugin } from '../apps/desktop/vite/ketcher-ui.ts';
const plugin = ketcherUiPlugin();
const transform = code => plugin.transform(code, '/node_modules/ketcher-core/dist/application/editor/Editor.modern.js').code;
for (const filename of ['Editor.js', 'Editor.modern.js']) {
  const source = readFileSync(new URL(`../apps/desktop/node_modules/ketcher-core/dist/application/editor/${filename}`, import.meta.url), 'utf8')
  const code = plugin.transform(source, `/node_modules/ketcher-core/dist/application/editor/${filename}`).code
  const canvasFocus = code.match(/this\.buretteFocusCanvas = (\(\) => \{[\s\S]*?\n      \});/)[1];
  const focusCalls = [];
  const focusedEditor = { ketcherRootElement: { focus: options => focusCalls.push(['focus', options.preventScroll]) } };
  const blur = () => focusCalls.push(['blur']);
  const focusContext = { editor: focusedEditor, blurActiveElement: blur, dom: { blurActiveElement: blur } };
  vm.runInNewContext(`(function(){return ${canvasFocus}}).call(editor)()`, focusContext);
  assert.deepEqual(focusCalls, [['blur'], ['focus', true]], 'Canvas click restores scoped focus without scrolling');
  assert.equal(focusedEditor.ketcherRootElement.tabIndex, -1);
  assert.ok(code.includes("this.canvas.removeEventListener('mousedown', this.buretteFocusCanvas);"));
  const setup = code.match(/value: function setupKeyboardEvents\(\) \{([\s\S]*?)\n    \}\n  \}, \{/)[1]
  let listener, dispatched = 0, commands = 0, blocked = false
  const inside = {}, outside = {}
  const editor = {
    _type: 0, ketcherRootElement: { contains: target => target === inside },
    events: { keyDown: { dispatch: event => { dispatched++; if (blocked) event.stopPropagation() } } },
    mode: { onKeyDown: () => { commands++; return Promise.resolve() } },
  }
  const context = { editor, EditorType: { Micromolecules: 0 }, KetcherLogger: { error() {} },
    document: { addEventListener: (_name, callback) => { listener = callback } } }
  if (filename === 'Editor.js') {
    context.editor_types = { EditorType: context.EditorType }
    delete context.EditorType
  }
  vm.runInNewContext(`(function(){${setup}}).call(editor)`, context)
  const key = target => listener({ target, stopPropagation() {} })
  key(inside); key(outside)
  assert.equal(commands, 0, `${filename}: hidden macro core ignores molecule-mode keys`)
  editor._type = 1
  key(outside); key(null)
  assert.equal(dispatched, 0, `${filename}: external keys never reach macro subscribers`)
  key(inside)
  assert.equal(commands, 1, `${filename}: macro keyboard editing still works`)
  blocked = true
  key(inside)
  assert.equal(commands, 1, `${filename}: subscriber propagation control is preserved`)
  assert.equal(dispatched, 2)

  const hotKeyBody = code.match(/value: function handleHotKeyEvents\(event\) \{([\s\S]*?)\n    \}\n  \}, \{/)[1]
  class Element {}
  const localTarget = new Element(), externalTarget = new Element()
  let hotKeyCommands = 0, prevented = 0
  editor.ketcherRootElement = { contains: target => target === localTarget }
  const hotKeyContext = {
    editor, EditorType: { Micromolecules: 0 }, HTMLElement: Element,
    hotkeysConfiguration: { bond: { handler: () => { hotKeyCommands++ } } },
    initHotKeys: settings => settings, keyNorm: { lookup: () => 'bond' },
    isEditableInputTarget: target => Boolean(target.editable),
  }
  if (filename === 'Editor.js') {
    hotKeyContext.editor_types = { EditorType: hotKeyContext.EditorType }
    hotKeyContext.editorEvents = { hotkeysConfiguration: hotKeyContext.hotkeysConfiguration }
    hotKeyContext.keynorm = { initHotKeys: hotKeyContext.initHotKeys, keyNorm: hotKeyContext.keyNorm }
    hotKeyContext.dom = { isEditableInputTarget: hotKeyContext.isEditableInputTarget }
    for (const name of ['EditorType', 'hotkeysConfiguration', 'initHotKeys', 'keyNorm', 'isEditableInputTarget']) delete hotKeyContext[name]
  }
  const hotKey = vm.runInNewContext(`(function(event){${hotKeyBody}}).bind(editor)`, hotKeyContext)
  const hotEvent = target => hotKey({ target, preventDefault() { prevented++ } })
  editor._type = 0
  hotEvent(localTarget)
  editor._type = 1
  hotEvent(externalTarget); hotEvent(null)
  assert.equal(hotKeyCommands, 0, `${filename}: hotkeys ignore hidden and external editors`)
  hotEvent(localTarget)
  assert.equal(hotKeyCommands, 1, `${filename}: internal macro hotkey executes`)
  assert.equal(prevented, 1)
  localTarget.editable = true
  hotEvent(localTarget)
  assert.equal(hotKeyCommands, 1, `${filename}: editable input keeps its native keys`)
  editor.ketcherRootElement = null
  hotEvent(localTarget)
  assert.equal(hotKeyCommands, 1, `${filename}: detached editor ignores hotkeys`)
}
assert.throws(() => transform('changed upstream'), /contract changed/)
console.log('PASS: actual Ketcher document handlers ignore hidden/outside editors, retain macro editing and subscriber cancellation; changed contracts fail closed')
