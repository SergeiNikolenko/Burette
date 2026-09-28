import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { defaultPreferences } from '../apps/desktop/src/stores/settings-store.ts';

const oldWindow = globalThis.window;
globalThis.window = { __BURETTE_HOSTED_MCP_WIDGET__: true,
  __BURETTE_WEB_ASSETS_BASE__: 'https://burette-plugin.vercel.app/burette-viewer/' };
try {
  const { openBrowserDevMolstarContextDocument, deleteBrowserDevVirtualTextDocument } =
    await import('../apps/desktop/src/lib/browser-dev-documents.ts?hosted-sdf-regression');
  const data = readFileSync('apps/burette-public-plugin/public/review-fixtures/salicylate-series.sdf', 'utf8');
  const document = await openBrowserDevMolstarContextDocument({ label: 'salicylate-series.sdf',
    context: { hostedMcpWidget: true, hostedMcpActions: [] },
    entries: [{ role: 'structure', label: 'salicylate-series.sdf', format: 'sdf', data }],
  }, defaultPreferences);
  assert.equal(document.renderer, 'grid2d');
  const html = document.runtimePath;
  const records = JSON.parse(html.match(/id="burette-grid-records" type="application\/json">([^<]*)<\/script>/)[1]);
  const config = JSON.parse(html.match(/id="burette-runtime-config" type="application\/json">([^<]*)<\/script>/)[1]);
  assert.deepEqual(records.map(record => record.name), ['Salicylic acid', 'Aspirin', 'Methyl salicylate']);
  assert.ok(records.every(record => record.molblock.includes('V2000')));
  assert.equal(config.recordsIncluded, 3);
  assert.equal(config.rdkitWasmPath, 'https://burette-plugin.vercel.app/burette-viewer/rdkit/RDKit_minimal.wasm');
  assert.equal((html.match(/<script(?![^>]*(?:src=|type="application\/json"))/g) || []).length, 0);
  assert.ok(!html.includes('<base '));
  for (const asset of ['viewer-bootstrap.js', 'grid.css', 'grid-ui.js', 'grid-viewer.js', 'rdkit/RDKit_minimal.js']) {
    assert.ok(html.includes('https://burette-plugin.vercel.app/burette-viewer/' + asset));
  }
  const messages = [];
  const window = { parent: { postMessage: message => messages.push(message) } };
  const json = { 'burette-runtime-config': config, 'burette-grid-records': records };
  runInNewContext(readFileSync('PreviewExtension/Web/viewer-bootstrap.js', 'utf8'), {
    window, document: { getElementById: id => json[id] ? { textContent: JSON.stringify(json[id]) } : null },
  });
  assert.equal(window.BuretteGridMode, true);
  assert.equal(window.BuretteGridRecords.length, 3);
  window.__mqlPost('ready', 'Loaded');
  assert.equal(messages[0].source, 'burette-grid');
  deleteBrowserDevVirtualTextDocument(document.path);
  console.log('Hosted SDF opens three named records with CSP-safe collection bootstrap');
} finally { globalThis.window = oldWindow; }

// Retain source metadata without indistinguishable duplicate column headings.
const gridSource = readFileSync('PreviewExtension/Web/grid-viewer.js', 'utf8');
const catalogStart = gridSource.indexOf('  function tableColumnCatalog()');
const catalogEnd = gridSource.indexOf('  function invalidateTableColumnCatalog()', catalogStart);
const row = { index: 0, name: 'Aspirin', smiles: 'CC(=O)Oc1ccccc1C(=O)O',
  props: { Name: 'Original file name', SMILES: 'original source string', Batch: 'A' } };
const catalogContext = { state: {}, tableColumnDiscoveryRows: () => [row],
  tableColumnCatalogKey: () => 'fixture', safeConfig: () => ({}),
  effectiveMolecularGrid: () => true, inferPropColumnType: () => 'text',
  rowSmiles: row => row.smiles, tableColumnPickerSearchText: column => column.label };
runInNewContext(gridSource.slice(catalogStart, catalogEnd), catalogContext);
const columns = catalogContext.tableColumnCatalog();
assert.equal(columns.find(c => c.id === 'prop:Name').label, 'Name (file)');
assert.equal(columns.find(c => c.id === 'prop:SMILES').label, 'SMILES (file)');
assert.equal(columns.find(c => c.id === 'prop:Batch').label, 'Batch');
assert.equal(columns.find(c => c.id === 'prop:Name').get(row), 'Original file name');
console.log('Collection column labels distinguish, and retain, original file properties');
const optionStart = gridSource.indexOf('  function propertyOptionList(cfg)');
const optionEnd = gridSource.indexOf('  function setCardRenderer(', optionStart);
const optionContext = { state: { all: [row] }, effectiveMolecularGrid: () => true, isRemoteMode: () => false };
runInNewContext(gridSource.slice(optionStart, optionEnd), optionContext);
assert.equal(optionContext.propertyOptionList({}).find(o => o.value === 'prop:Name').label, 'Name (file)');
assert.equal(optionContext.propertyOptionList({}).find(o => o.value === 'prop:SMILES').label, 'SMILES (file)');
