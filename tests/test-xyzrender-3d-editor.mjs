import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
const window = new Window();
const document = window.document;
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.dispatchEvent(new window.Event('close')); };
const source = readFileSync(new URL('../PreviewExtension/Web/xyzrender-3d-editor.js', import.meta.url), 'utf8');
new Function('window', 'document', source)(window, document);
let request, download;
await window.BuretteXyzrender3D.open({ label: 'caffeine.xyz',
 render: async input => { request = input; return { gifBase64: btoa('GIF89a') }; },
 download: (blob, name) => { download = { blob, name }; },
});
assert.deepEqual(request, { mode: 'rotation', axis: 'y' });
const dialog = document.querySelector('dialog');
assert.equal(dialog.querySelector('img').hidden, false);
assert.equal(dialog.querySelector('[data-render]').hidden, true);
dialog.querySelector('[aria-label="Animation"]').value = 'trajectory';
await dialog.querySelector('[aria-label="Animation"]').onchange();
assert.deepEqual(request, { mode: 'trajectory', axis: 'y' });
assert.equal(dialog.querySelector('img').hidden, false);
assert.equal(dialog.querySelector('[data-export]').disabled, false);
dialog.querySelector('[data-export]').click();
assert.equal(download.name, 'caffeine-trajectory.gif');
assert.equal(download.blob.type, 'image/gif');
dialog.close();
assert.equal(document.querySelector('dialog'), null);
await window.BuretteXyzrender3D.open({ label: 'bad.xyz', render: async () => { throw new Error('Invalid trajectory'); } });
await document.querySelector('[data-render]').onclick();
assert.equal(document.querySelector('[role=status]').textContent, 'Invalid trajectory');
assert.equal(document.querySelector('[data-export]').disabled, true);
console.log('xyzrender animation UI tests passed');
// A slow renderer must show the current molecule immediately on opening.
let complete;
const pending = window.BuretteXyzrender3D.open({ label: 'slow.xyz',
 previewSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
 render: () => new Promise(resolve => { complete = resolve; }),
});
assert.equal(document.querySelector('img').hidden, false);
assert.equal(document.querySelector('[role=status]').textContent, 'Rendering with xyzrender…');
document.querySelector('dialog').close();
complete({ gifBase64: btoa('GIF89a') });
await pending;
assert.equal(document.querySelector('dialog'), null);

// A packaged host has no browser endpoint but must receive the editor action.
const viewer = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const nativeOpen = viewer.slice(viewer.indexOf('  async function openXyzrender3DEditor()'), viewer.indexOf('  function installExternalArtifactKeyboard', viewer.indexOf('  async function openXyzrender3DEditor()')));
const selected = { id: 'native-molecule' };
const published = [];
const errors = [];
await new Function('activeConfig', 'selectedXyzrenderSheetItems', 'xyzrenderSheetItemEntry', 'publishXyzrenderItem', 'setStatus', `${nativeOpen}; return openXyzrender3DEditor();`)(
  { appViewer: true }, () => [selected], () => ({}), (...args) => published.push(args), (...args) => errors.push(args),
);
assert.deepEqual(published, [[selected, 'openXyzrenderAnimation']]);
assert.deepEqual(errors, []);
