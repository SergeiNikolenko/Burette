import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../PreviewExtension/Web/grid-viewer.js', import.meta.url), 'utf8');
function body(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const rest = source.slice(start + 1);
  const next = rest.search(/\n {2}(?:async )?function [A-Za-z_$]/u);
  return next === -1 ? rest : rest.slice(0, next);
}

const window = new Window();
for (const name of ['document', 'HTMLElement', 'Element', 'Node', 'Event']) globalThis[name] = window[name];
globalThis.window = window;

window.localStorage.clear();

const rows = [{
  index: 0,
  name: '4mw9_2EJ',
  smiles: 'C#Cc1ccccc1',
  props: {
    'CSV row': '2',
    'SMILES column': 'smiles',
    ccd: '2EJ',
    dataset: 'timesplit_val',
    path_ligand: 'PDBBind/4mw9',
  },
  descriptors: {
    MW: { label: 'MW', value: 312.4 },
  },
  analyses: {},
}];

const state = {
  viewMode: 'cards',
  showProperties: true,
  cardPropertyPanelOpen: false,
  cardPropertyQuery: '',
  cardPropertyVisibleLimit: 240,
  cardHiddenProperties: new Set(),
  cardPropertiesCustomized: false,
  cardPropertyPanelOutsideController: null,
  tableColumnCatalogCache: null,
  remoteMode: false,
  all: rows,
  rows,
  totalRows: 1,
  recordsIndexed: 1,
  rowPatches: new Map(),
  insertedRows: [],
  hiddenRows: new Set(),
  remoteDescriptorIds: [],
  remoteAnalysisColumns: [],
};

document.body.innerHTML = '<div id="app"><button id="card-properties" type="button" hidden>Fields</button></div>';
const root = document.getElementById('app');
let renders = 0;

const api = new Function(
  'state', 'root', 'window', 'document', 'render', 'applyGridPreferences',
  `
  const CARD_HIDDEN_PROPERTIES_STORAGE_KEY = 'buret.grid.cardHiddenProperties';
  const CARD_INTERNAL_PROPERTY_IDS = new Set(['prop:CSV row', 'prop:SMILES column']);
  const CARD_DEFAULT_PROPERTY_LIMIT = 6;
  const CARD_CUSTOM_PROPERTY_LIMIT = 40;
  const TABLE_COLUMN_PICKER_LIMIT = 240;
  const effectiveMolecularGrid = () => true;
  const safeConfig = () => ({});
  const currentLocalCollectionRows = () => state.all;
  const inferPropColumnType = () => 'text';
  const rowSmiles = row => row.smiles || '';
  const descriptorHelpText = (id, label) => label || id;
  const draw = () => '';
  ${[
    'escapeHTML', 'escapeAttr', 'storeStringSet', 'analysisDisplayValue',
    'descriptorNumberText', 'descriptorDisplayValue',
    'tableColumnCatalog', 'tableColumnDiscoveryRows', 'tableColumnCatalogKey', 'tableColumnCatalogRowKey',
    'tableColumnPickerMatches', 'tableColumnPickerSearchText',
    'positionFloatingColumnPanel',
    'cardPropertyOrder', 'cardPropertyCatalog', 'cardPropertyIsVisible', 'ensureCustomCardHiddenProperties',
    'cardPropertyPanelSummary', 'cardPropertyPickerItemsHTML',
    'syncCardPropertiesButton', 'syncCardPropertyPanel', 'bindCardPropertyPanel',
    'toggleCardPropertyPanel', 'closeCardPropertyPanel', 'metadata',
  ].map(body).join('\n')}
  return {
    cardPropertyCatalog, cardPropertyIsVisible, metadata,
    toggleCardPropertyPanel, closeCardPropertyPanel, syncCardPropertiesButton, syncCardPropertyPanel,
  };
  `
)(state, root, window, document, () => { renders += 1; }, () => {
  api.syncCardPropertiesButton();
  api.syncCardPropertyPanel({});
});

// 1. By default, internal CSV metadata (CSV row, SMILES column) is hidden while real fields show.
const catalog = api.cardPropertyCatalog();
assert.equal(catalog[0].id, 'smiles');
assert.equal(api.cardPropertyIsVisible('prop:CSV row', catalog), false);
assert.equal(api.cardPropertyIsVisible('prop:SMILES column', catalog), false);
assert.equal(api.cardPropertyIsVisible('prop:ccd', catalog), true);
assert.equal(api.cardPropertyIsVisible('descriptor:MW', catalog), true);

const defaultHtml = api.metadata(rows[0], catalog, true);
assert.doesNotMatch(defaultHtml, /CSV row/);
assert.doesNotMatch(defaultHtml, /SMILES column/);
assert.match(defaultHtml, /<dt>MW<\/dt><dd>312\.4<\/dd>/);
assert.match(defaultHtml, /<dt>ccd<\/dt><dd>2EJ<\/dd>/);

// 2. Opening the Fields panel exposes checkboxes reflecting the default state.
api.syncCardPropertiesButton();
assert.equal(document.getElementById('card-properties').hidden, false);
api.toggleCardPropertyPanel({});
const panel = document.querySelector('.buret-card-property-panel');
assert.ok(panel, 'card property picker opens');
const csvBox = panel.querySelector('input[data-buret-card-property="prop:CSV row"]');
const ccdBox = panel.querySelector('input[data-buret-card-property="prop:ccd"]');
const smilesBox = panel.querySelector('input[data-buret-card-property="smiles"]');
assert.equal(csvBox.checked, false);
assert.equal(ccdBox.checked, true);
assert.equal(smilesBox.checked, true);

// 3. Unchecking a field preserves default-hidden internal fields and persists to storage.
ccdBox.checked = false;
ccdBox.dispatchEvent(new window.Event('change', { bubbles: true }));
assert.equal(state.cardPropertiesCustomized, true);
assert.equal(api.cardPropertyIsVisible('prop:ccd'), false);
assert.equal(api.cardPropertyIsVisible('prop:CSV row'), false, 'first toggle must not re-enable default-hidden CSV row');
assert.ok(window.localStorage.getItem('buret.grid.cardHiddenProperties') !== null);
assert.equal(renders, 1);
const customHtml = api.metadata(rows[0], api.cardPropertyCatalog(), true);
assert.doesNotMatch(customHtml, /<dt>ccd<\/dt>/);
assert.match(customHtml, /<dt>dataset<\/dt><dd>timesplit_val<\/dd>/);

// 4. User can re-enable CSV row explicitly or hide SMILES.
const csvBoxAfter = panel.querySelector('input[data-buret-card-property="prop:CSV row"]');
csvBoxAfter.checked = true;
csvBoxAfter.dispatchEvent(new window.Event('change', { bubbles: true }));
assert.match(api.metadata(rows[0], api.cardPropertyCatalog(), true), /<dt>CSV row<\/dt><dd>2<\/dd>/);

// 5. Select all / none toggles all card properties cleanly.
const toggleAll = panel.querySelector('[data-buret-card-property-action="toggle-all"]');
toggleAll.click(); // select all
assert.equal(api.cardPropertyIsVisible('prop:ccd'), true);
toggleAll.click(); // select none
assert.equal(api.cardPropertyIsVisible('smiles'), false);
assert.equal(api.metadata(rows[0], api.cardPropertyCatalog(), false), '', 'hiding all fields leaves no filler text');

await window.happyDOM.abort();
console.log('Card property picker: defaults, custom toggling, persistence, and select all/none passed.');
