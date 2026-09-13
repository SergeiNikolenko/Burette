import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
const source = readFileSync(new URL('../PreviewExtension/Web/native-viewer-menu.js', import.meta.url), 'utf8');
const window = new Window();
const sent = [];
const host = { postMessage: value => sent.push(value.body) };
Object.defineProperty(window, 'parent', { value: host });
window.BuretteConfig = { documentId: 'molecule-a' };
new Function('window', 'document', 'MutationObserver', 'Element', 'Event', 'KeyboardEvent', 'PointerEvent', 'FocusEvent', 'CustomEvent', 'crypto', source)(window, window.document, window.MutationObserver, window.Element, window.Event, window.KeyboardEvent, window.PointerEvent, window.FocusEvent, window.CustomEvent, crypto);
const message = value => window.dispatchEvent(new window.MessageEvent('message', { source: host, data: { source: 'burette-native-menu', ...value } }));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function menu() {
 const root = window.document.createElement('div');
 root.id = 'buret-scene-tree-menu';
 root.innerHTML = `<div class="buret-tree-menu-title">Angle</div><button aria-selected="true">Focus</button>
 <label><span>Thickness</span><input type="range" min="0.01" max="5" step="0.01" value="0.02"></label>
 <label><span>Text</span><input type="text" value="Angle"></label>
 <details><summary>Advanced</summary><label><span>Flat colour</span><input type="checkbox"></label></details>
 <div data-scene-tree-picker-list="theme" hidden>Long hidden list of theme choices</div>
 <div class="buret-tree-swatches"><button data-scene-tree-color="16711680" aria-pressed="true">Red</button><button data-scene-tree-color="255">Blue</button></div>`;
 return root;
}
const web = menu(); window.document.body.append(web); await settle();
assert.equal(web.style.visibility, '', 'browser menu is untouched without a native capability');
assert.deepEqual(sent.map(x => x.type), ['nativeMenuReady']);
web.remove();
message({ kind: 'available' });
const root = menu(); let selected = 0; let changes = [];
root.querySelector('button').onclick = () => selected++;
root.querySelector('input').addEventListener('input', event => changes.push(['input',event.target.value]));
root.querySelector('input').addEventListener('change', event => changes.push(['change',event.target.value]));
window.document.body.append(root); await settle();
const opened = sent.at(-1);
assert.equal(opened.type, 'nativeMenuOpen');
assert.equal(root.style.visibility, 'hidden');
assert.deepEqual(opened.items.map(x => x.kind), ['item','item','control','control','submenu','control']);
assert.deepEqual(opened.items[2].control, {kind:'slider',value:0.02,min:0.01,max:5,step:0.01});
assert.equal(opened.items[1].checked,true,'current DOM options keep their native checkmark');
assert.equal(opened.items[5].text,'Colour','hidden theme choices are never used as the palette heading');
assert.deepEqual(opened.items[5].control, {kind:'palette',colors:['#ff0000','#0000ff'],selected:'#ff0000'});
message({kind:'control',token:'stale',id:opened.items[2].id,phase:'input',value:1});
assert.deepEqual(changes,[]);
message({kind:'control',token:opened.token,id:opened.items[2].id,phase:'input',value:0.15});
message({kind:'control',token:opened.token,id:opened.items[2].id,phase:'change',value:0.15});
assert.deepEqual(changes,[['input','0.15'],['change','0.15']]);
message({kind:'closed',token:opened.token,selection:opened.items[1].id});
assert.equal(selected,1,'the original action is invoked once');
root.remove();
const delayed = menu();
let complete;
let dismissed = false;
delayed.addEventListener('burette-native-menu-close', () => { dismissed = true; });
delayed.querySelector('button').onclick = () => { delayed._buretPendingAction = new Promise(resolve => { complete = resolve; }); };
window.document.body.append(delayed); await settle();
const pending = sent.at(-1);
message({kind:'closed',token:pending.token,selection:pending.items[1].id});
assert.equal(dismissed,false,'native closing must not cancel an in-flight representation commit');
complete(); await settle();
assert.equal(dismissed,true,'menu closes after the selected representation is applied');
delayed.remove();
const fallback = menu(); window.document.body.append(fallback); await settle();
message({kind:'fallback',token:sent.at(-1).token});
assert.equal(fallback.style.visibility,'','an older native host keeps the complete web menu');
await window.happyDOM.close();
console.log('Native viewer menu capability, projection, callbacks, stale events and browser fallback passed');
