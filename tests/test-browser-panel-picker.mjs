import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('apps/desktop/src/lib/web-demo-workspace.ts', 'utf8');
const picker = source.slice(source.indexOf('export async function pickWebDemoFiles'));
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(picker.replace('export async function', 'async function'));
let input;
const blobs = new Map(), files = new Map(), texts = new Map();
const run = new Function('document', 'trackWebDemoLocalFiles', 'MAX_FILE_BYTES', 'binaryFiles', 'files', 'writeBrowserDevVirtualTextDocument', 'listeners', 'isDocumentMediaPath', 'documentViewerExtensions', `${compiled}; return pickWebDemoFiles;`)(
  { createElement() { const handlers = {}; input = { addEventListener: (type, handler) => { handlers[type] = handler; }, click() {}, setAttribute() {}, handlers }; return input; } },
  () => {}, 3 * 1024 * 1024, blobs, files, (path, text) => texts.set(path, text), new Set(),
  path => path.endsWith('.png'), new Set(['png']),
);
const pending = run();
const image = { name: 'image.png', size: 3, text: () => { throw new Error('Binary file was decoded as text'); } };
input.files = [image, { name: 'table.csv', size: 10, text: async () => 'name,value\na,1' }];
input.handlers.change();
assert.deepEqual(await pending, { root: '/OpenedFiles', paths: ['/OpenedFiles/image.png', '/OpenedFiles/table.csv'] });
assert.equal(blobs.get('/OpenedFiles/image.png'), image);
assert.equal(texts.get('/OpenedFiles/table.csv'), 'name,value\na,1');
assert.equal(texts.has('/OpenedFiles/image.png'), false);
const cancel = run(); input.handlers.cancel(); assert.equal(await cancel, null);
assert.match(input.accept, /\.csv/);
assert.match(input.accept, /\.png/);
console.log('Browser panel picker preserves binary files, CSV and cancellation');
