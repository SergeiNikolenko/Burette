import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
};
const messages = [];
const statuses = [];
const context = vm.createContext({
  Blob, Uint8Array,
  window: { webkit: { messageHandlers: { burette: {} } } },
  fetch() { throw new Error('Opaque-origin blob fetch is unavailable'); },
  URL: { createObjectURL() { throw new Error('Host export must use owned bytes'); } },
  bytesToBase64: bytes => Buffer.from(bytes).toString('base64'),
  postHostMessage: message => { messages.push(JSON.parse(JSON.stringify(message))); return true; },
  setStatus: (message, kind) => statuses.push({ message, kind }),
});
vm.runInContext(['canUseDownloadExportBridge', 'exportBlobToHost', 'shouldExportBlobAsText', 'safeDownloadFileName', 'downloadBlob'].map(extract).join('\n'), context);
const bytes = Uint8Array.from([0, 255, 128, 80, 75]);
await context.downloadBlob(new Blob([bytes], { type: 'application/zip' }), '../masks.zip');
const textBlob = new Blob(['data_map\n'], { type: 'text/plain' });
await context.downloadBlob(textBlob, 'map.cif');
assert.deepEqual(messages, [
  { type: 'exportData', name: '_masks.zip', mimeType: 'application/zip', base64: Buffer.from(bytes).toString('base64') },
  { type: 'exportText', name: 'map.cif', mimeType: textBlob.type, text: 'data_map\n' },
]);
assert.equal(statuses.some(item => item.kind === 'error'), false);
console.log('Viewer exports owned binary and text blobs without opaque-origin fetch.');
