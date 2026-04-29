#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export npm_config_cache="$ROOT/build/npm-cache"

OPEN_PREVIEW=1
OUT_DIR=""
SAMPLE="samples/mini.pdb"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-open)
      OPEN_PREVIEW=0
      shift
      ;;
    --out-dir)
      OUT_DIR="${2:-}"
      if [[ -z "$OUT_DIR" ]]; then
        echo "error: --out-dir requires a path" >&2
        exit 2
      fi
      shift 2
      ;;
    -h|--help)
      echo "usage: $0 [--no-open] [--out-dir DIR] [structure-file]" >&2
      exit 0
      ;;
    *)
      SAMPLE="$1"
      shift
      ;;
  esac
done

if [[ ! -f "$SAMPLE" ]]; then
  echo "error: sample not found: $SAMPLE" >&2
  exit 1
fi

if [[ ! -d node_modules/molstar ]]; then
  mkdir -p "$npm_config_cache"
  npm ci --ignore-scripts
fi
npm run vendor:molstar

if [[ -n "$OUT_DIR" ]]; then
  TMP="$OUT_DIR"
  rm -rf "$TMP"
  mkdir -p "$TMP"
else
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/burrete-web.XXXXXX")"
fi
cp -R PreviewExtension/Web "$TMP/Web"

node - "$SAMPLE" "$TMP/Web/preview-config.js" "$TMP/Web/preview-data.js" <<'JS'
const fs = require('fs');
const path = require('path');
const file = process.argv[2];
const configOut = process.argv[3];
const dataOut = process.argv[4];
const ext = path.extname(file).toLowerCase().slice(1);
const data = fs.readFileSync(file);

let format = 'mmcif';
let binary = false;
if (['pdb', 'ent', 'pdbqt', 'pqr'].includes(ext)) format = 'pdb';
else if (ext === 'cif') {
  const prefix = data.slice(0, 262144).toString('utf8').toLowerCase();
  format = (prefix.includes('_atom_site.cartn_x') || prefix.includes('_atom_site.label_atom_id') || prefix.includes('_atom_site.auth_atom_id') || prefix.includes('_entity_poly') || prefix.includes('_entity_poly_seq') || prefix.includes('_chem_comp.') || prefix.includes('_ma_') || prefix.includes('mmcif_ma.dic') || prefix.includes('modelcif') || prefix.includes('_pdbx_') || prefix.includes('_struct_asym')) ? 'mmcif' : 'cifCore';
}
else if (['mmcif', 'mcif'].includes(ext)) format = 'mmcif';
else if (ext === 'bcif') { format = 'mmcif'; binary = true; }
else if (['sdf', 'sd'].includes(ext)) format = 'sdf';
else if (ext === 'mol') format = 'mol';
else if (ext === 'mol2') format = 'mol2';
else if (ext === 'xyz') format = 'xyz';
else if (ext === 'gro') format = 'gro';

const config = {
  label: path.basename(file),
  format,
  binary,
  byteCount: data.length,
  theme: 'dark',
  canvasBackground: 'black',
  transparentBackground: false,
  sdfGrid: true,
  showPanelControls: true
};
fs.writeFileSync(configOut, 'window.BurreteConfig = ' + JSON.stringify(config, null, 2) + ';\n');
fs.writeFileSync(dataOut, 'window.BurreteDataBase64 = "' + data.toString('base64') + '";\n');
console.log(`Wrote preview config/data for ${file} as ${format}`);
JS

node - "$SAMPLE" "$TMP/Web/index.html" "$TMP/Web/viewer.js" "$TMP/Web/preview-config.js" "$TMP/Web/preview-data.js" <<'JS'
const fs = require('fs');
const path = require('path');

const sample = process.argv[2];
const indexPath = process.argv[3];
const viewerPath = process.argv[4];
const configPath = process.argv[5];
const dataPath = process.argv[6];

const index = fs.readFileSync(indexPath, 'utf8');
const viewer = fs.readFileSync(viewerPath, 'utf8');
const configSource = fs.readFileSync(configPath, 'utf8');
const dataSource = fs.readFileSync(dataPath, 'utf8');
const config = JSON.parse(configSource.replace(/^window\.BurreteConfig = /, '').replace(/;\s*$/, ''));
const ext = path.extname(sample).toLowerCase().slice(1);

function assert(condition, message) {
  if (!condition) {
    console.error(`error: ${message}`);
    process.exit(1);
  }
}

assert(index.includes('role="toolbar"'), 'preview HTML must expose a toolbar role');
assert(!index.includes('data-buret-action="fit"'), 'fit/fullscreen toolbar button should not be present');
assert(index.includes('aria-label="Collapse controls"'), 'toolbar handle should collapse controls');
assert(index.includes('aria-expanded="true"'), 'toolbar handle should expose expanded state');
assert(index.includes('--buret-molstar-panel-background'), 'preview HTML must define Mol* theme panel colors');
assert(index.includes('.msp-viewport-controls-panel'), 'preview HTML must theme Mol* viewport panels');
assert(!index.includes('aria-label="Fullscreen"'), 'stale Fullscreen aria-label found');
assert(!index.includes('title="Fullscreen"'), 'stale Fullscreen title found');
assert(viewer.includes('window.BurreteConfig'), 'viewer.js must read BurreteConfig');
assert(viewer.includes('buret.toolbar.collapsed'), 'viewer.js must remember compact toolbar state');
assert(viewer.includes('normalizeViewerTheme'), 'viewer.js must support viewer themes');
assert(viewer.includes('canvasBackgroundColor'), 'viewer.js must support configurable canvas backgrounds');
assert(viewer.includes('viewportBackgroundColor'), 'viewer.js must seed Mol* with the requested canvas background');
assert(dataSource.startsWith('window.BurreteDataBase64 = "'), 'preview data file must define BurreteDataBase64');
assert(config.label === path.basename(sample), 'config label should match sample basename');
assert(typeof config.byteCount === 'number' && config.byteCount > 0, 'config byteCount should be positive');
assert(config.theme === 'dark', 'theme should default to dark');
assert(config.canvasBackground === 'black', 'canvas background should default to black');
assert(config.transparentBackground === false, 'transparent background should be opt-in');
assert(config.sdfGrid === true, 'SDF grid flag should be encoded');

const expectedFormats = {
  pdb: 'pdb',
  ent: 'pdb',
  pdbqt: 'pdb',
  pqr: 'pdb',
  mmcif: 'mmcif',
  mcif: 'mmcif',
  bcif: 'mmcif',
  sdf: 'sdf',
  sd: 'sdf',
  mol: 'mol',
  mol2: 'mol2',
  xyz: 'xyz',
  gro: 'gro'
};
if (expectedFormats[ext]) {
  assert(config.format === expectedFormats[ext], `expected ${ext} to map to ${expectedFormats[ext]}, got ${config.format}`);
}
if (ext === 'bcif') {
  assert(config.binary === true, 'BCIF should be marked binary');
}
console.log('Validated web preview contract');
JS

PREVIEW_URL="$(python3 - "$TMP/Web/index.html" <<'PY'
import pathlib
import sys

print(pathlib.Path(sys.argv[1]).resolve().as_uri())
PY
)"

if [[ "$OPEN_PREVIEW" == "1" ]]; then
  echo "Opening web-only preview in: $PREVIEW_URL"
  open "$PREVIEW_URL"
else
  echo "$PREVIEW_URL"
fi
