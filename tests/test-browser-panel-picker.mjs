import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('apps/desktop/src/lib/web-demo-workspace.ts', 'utf8');
const functionSource = name => {
  const match = source.match(new RegExp(`\\n(?:export )?(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`, 'u'));
  assert.ok(match, `missing ${name}`);
  return match[0].replace(/^\nexport /u, '\n');
};
const picker = ['pickWebDemoFiles', 'importFile', 'registerImportedFile', 'registerFile', 'selectFiles', 'cleanSegment', 'emitChange']
  .map(functionSource).join('\n');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(picker);

let selection = [], request;
const blobs = new Map(), files = new Map(), texts = new Map(), pickedBinaries = new Map();
const scope = {
  pickBrowserFiles: async options => { request = options; return selection; },
  trackWebDemoLocalFiles: () => {},
  isScientificFile: async () => false,
  compressedName: () => false,
  saveBrowserImport: async record => record,
  isDocumentMediaPath: path => path.endsWith('.png'),
  readBrowserDevPickedBinary: path => pickedBinaries.get(path) ?? null,
  writeBrowserDevPickedBinary: (path, file) => pickedBinaries.set(path, file),
  readBrowserDevVirtualTextDocument: path => texts.get(path) ?? null,
  writeBrowserDevVirtualTextDocument: (path, text) => texts.set(path, text),
  documentViewerExtensions: new Set(['png']),
  binaryFiles: blobs, files, listeners: new Set(),
  MAX_FILE_BYTES: 3 * 1024 * 1024, BROWSER_IMPORT_MAX_FILE_BYTES: 24 * 1024 * 1024, SCIENTIFIC_FILE_LIMIT: 16 * 1024 * 1024,
  SCIENTIFIC_FILE_ACCEPT: '.fchk', COMPRESSED_FILE_ACCEPT: '.gz',
};
const run = new Function(...Object.keys(scope), `${compiled}; return pickWebDemoFiles;`)(...Object.values(scope));

const image = { name: 'image.png', size: 3, text: () => { throw new Error('Binary file was decoded as text'); } };
selection = [image, { name: 'table.csv', size: 10, text: async () => 'name,value\na,1' }];
assert.deepEqual(await run(), { root: '/OpenedFiles', paths: ['/OpenedFiles/image.png', '/OpenedFiles/table.csv'], scientific: [], errors: [] });
assert.equal(blobs.get('/OpenedFiles/image.png'), image);
assert.equal(texts.get('/OpenedFiles/table.csv'), 'name,value\na,1');
assert.equal(texts.has('/OpenedFiles/image.png'), false);
selection = [];
assert.equal(await run(), null);
assert.match(request.accept, /\.csv/);
assert.match(request.accept, /\.png/);
console.log('Browser panel picker preserves binary files, CSV and cancellation');
