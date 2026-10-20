import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const initRDKitModule = new Function('require', 'module', '__dirname',
  readFileSync(new URL('../PreviewExtension/Web/rdkit/RDKit_minimal.js', import.meta.url), 'utf8') + '\nreturn initRDKitModule;'
)(require, { exports: {} }, new URL('../PreviewExtension/Web/rdkit', import.meta.url).pathname);
const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const loader = source.slice(source.indexOf('  async function molstarPreviewLoadScript('), source.indexOf('  function molstarPreviewCleanRDKitSVG('));
const draw = source.slice(source.indexOf('  async function molstarMoleculePreviewRDKitSVG('), source.indexOf('  function selectMolstarMoleculePreviewAtoms('));
const wasm = readFileSync(new URL('../PreviewExtension/Web/rdkit/RDKit_minimal.wasm', import.meta.url));
const requests = [], scripts = [];
const window = {
  BuretteRDKitWasmURL: '/__burette/rdkit-wasm',
  BuretteResolveRuntimeAsset: async path => {
    requests.push(path);
    if (path !== 'rdkit/RDKit_minimal.js') throw new Error('Not packaged');
    return 'blob:packaged-rdkit';
  },
};
const api = runInNewContext(`${loader}\n${draw}\n({ init: molstarPreviewInitRDKit, draw: molstarMoleculePreviewRDKitSVG, showHydrogens(value) { molstarShowHydrogens = value; } })`, {
  window, Uint8Array, molstarShowHydrogens: true, molstarPreviewRdkit: null, molstarPreviewRdkitPromise: null,
  molstarPreviewSvgCache: new Map(), MOLSTAR_PREVIEW_RDKIT_SVG_SIZE: 400,
  runtimeURL: (name, fallback) => window[name] || fallback,
  withTimeout: async promise => promise,
  fetch: async path => { assert.equal(path, '/__burette/rdkit-wasm'); return new Response(wasm); },
  document: {
    querySelector: () => null,
    createElement: () => ({}),
    head: { appendChild(script) {
      scripts.push(script.src);
      assert.equal(script.src, 'blob:packaged-rdkit');
      window.initRDKitModule = initRDKitModule;
      script.onload();
    } },
  },
  normalizeFormat: value => value,
  molstarPreviewKey: entry => entry.data,
  splitSdfRecords: value => value.split('$$$$'),
  molstarPreviewCleanRDKitSVG: svg => svg,
  molstarPreviewCacheSVG() {},
  debug: message => assert.fail(message),
  molstarMoleculePreviewFallbackSVG: () => assert.fail('Must produce a real RDKit depiction'),
});
const [a, b] = await Promise.all([api.init(), api.init()]);
assert.equal(a, b);
assert.deepEqual(scripts, ['blob:packaged-rdkit']);
assert.deepEqual(requests, ['../assets/rdkit/RDKit_minimal.js', 'rdkit/RDKit_minimal.js']);
const svg = await api.draw({ format: 'sdf', data: readFileSync(new URL('../samples/nad-2d.sdf', import.meta.url), 'utf8') });
assert.match(svg, /<svg/);
assert.match(svg, /class='bond-/);
assert.doesNotMatch(svg, /data-buret-rdkit-svg="fallback"/);
console.log('Native lazy asset resolution, shared initialization and real NAD RDKit 2D depiction passed');

// Depiction-only H removal must retain the heavy atoms' original 3D positions
// for lasso selection, and must not change the structure consumed by copy/save.
const ethanol = a.get_mol('CCO');
ethanol.add_hs_in_place();
const entry = Object.freeze({ format: 'sdf', data: ethanol.get_molblock() });
const originalSmiles = ethanol.get_smiles();
const original = JSON.parse(ethanol.get_json()).molecules[0];
ethanol.delete();
const shown = await api.draw(entry);
api.showHydrogens(false);
const hidden = await api.draw(entry);
api.showHydrogens(true);
const restored = await api.draw(entry);
const positions = drawing => [...drawing.matchAll(/data-source-position='([^']*)'/g)].map(match => match[1]);
assert.equal(positions(shown).length, 9);
assert.equal(positions(hidden).length, 3);
assert.deepEqual(positions(hidden), positions(shown).slice(0, 3));
assert.equal(restored, shown);
const exported = a.get_mol(entry.data);
assert.equal(exported.get_smiles(), originalSmiles);
assert.equal(JSON.parse(exported.get_json()).molecules[0].atoms.length, original.atoms.length);
exported.delete();
console.log('Hydrogen depiction toggle, source atom mapping and unchanged export input passed');
