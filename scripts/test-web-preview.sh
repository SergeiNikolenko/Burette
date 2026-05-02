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
const { spawnSync } = require('child_process');
const file = process.argv[2];
const configOut = process.argv[3];
const dataOut = process.argv[4];
const basename = path.basename(file).toLowerCase();
const ext = basename.endsWith('.mae.gz') ? 'maegz' : path.extname(file).toLowerCase().slice(1);
const data = fs.readFileSync(file);
const xyzrenderExts = new Set(['cub', 'cube', 'in', 'log', 'out', 'vasp', 'mae', 'maegz', 'cms']);

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
else if (ext === 'csv') format = 'csv';
else if (['smi', 'smiles'].includes(ext)) format = 'smiles';
else if (ext === 'tsv') format = 'tsv';
else if (ext === 'mol') format = 'mol';
else if (ext === 'mol2') format = 'mol2';
else if (ext === 'xyz') format = 'xyz';
else if (ext === 'gro') format = 'gro';
else if (['xtc', 'trr', 'dcd', 'nctraj'].includes(ext)) { format = ext; binary = true; }
else if (['lammpstrj', 'top', 'psf', 'prmtop'].includes(ext)) format = ext;
else if (xyzrenderExts.has(ext)) format = 'xyzrender';

const gridExts = new Set(['csv', 'sd', 'sdf', 'smi', 'smiles', 'tsv']);
const renderer = gridExts.has(ext) ? 'grid2d' : (ext === 'xyz' ? 'xyz-fast' : (xyzrenderExts.has(ext) ? 'xyzrender-external' : 'molstar'));
const vestaExts = new Set(['xyz', 'cub', 'cube']);
const config = {
  mode: gridExts.has(ext) ? 'grid2d' : 'structure',
  label: path.basename(file),
  format,
  molstarFormat: format,
  renderer,
  allowMolstarFallback: true,
  binary,
  byteCount: data.length,
  previewByteCount: data.length,
  theme: 'auto',
  canvasBackground: 'auto',
  transparentBackground: false,
  sdfGrid: true,
  showPanelControls: true,
  canOpenInVesta: vestaExts.has(ext)
};
if (renderer === 'xyzrender-external') {
  const artifactPath = path.join(path.dirname(configOut), 'xyzrender.svg');
  const started = Date.now();
  const result = spawnSync('xyzrender', [file, '-o', artifactPath, '--config', 'default'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10
  });
  if (result.status !== 0 || !fs.existsSync(artifactPath) || fs.statSync(artifactPath).size <= 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`xyzrender failed for ${file}: ${output}`);
  }
  config.quickLookViewer = true;
  config.xyzrenderViewer = true;
  config.molstarAvailable = false;
  config.xyzrenderPreset = 'default';
  config.xyzrenderPresetOptions = [
    { value: 'default', label: 'Default' },
    { value: 'flat', label: 'Flat' },
    { value: 'paton', label: 'Paton' },
    { value: 'pmol', label: 'PMol' },
    { value: 'skeletal', label: 'Skeletal' },
    { value: 'bubble', label: 'Bubble' },
    { value: 'tube', label: 'Tube' },
    { value: 'btube', label: 'BTube' },
    { value: 'mtube', label: 'MTube' },
    { value: 'wire', label: 'Wire' },
    { value: 'graph', label: 'Graph' },
    { value: 'custom', label: 'Custom JSON' }
  ];
  config.externalArtifact = {
    path: 'xyzrender.svg',
    type: 'svg',
    renderer: 'xyzrender',
    preset: 'default',
    config: 'default',
    elapsedMs: Date.now() - started,
    log: `${result.stdout || ''}\n${result.stderr || ''}`.trim()
  };
}
if (renderer === 'xyz-fast') {
  config.xyzFast = {
    style: 'default',
    firstFrameOnly: true,
    showCell: true,
    sourceByteCount: data.length,
    previewByteCount: data.length
  };
}
fs.writeFileSync(configOut, 'window.BurreteConfig = ' + JSON.stringify(config, null, 2) + ';\n');
fs.writeFileSync(dataOut, 'window.BurreteDataBase64 = "' + data.toString('base64') + '";\n');
console.log(`Wrote preview config/data for ${file} as ${format}`);
JS

node - "$SAMPLE" "$TMP/Web/index.html" "$TMP/Web/viewer.js" "$TMP/Web/burette-agent.js" "$TMP/Web/preview-config.js" "$TMP/Web/preview-data.js" <<'JS'
const fs = require('fs');
const path = require('path');

const sample = process.argv[2];
const indexPath = process.argv[3];
const viewerPath = process.argv[4];
const agentPath = process.argv[5];
const configPath = process.argv[6];
const dataPath = process.argv[7];

const index = fs.readFileSync(indexPath, 'utf8');
const viewer = fs.readFileSync(viewerPath, 'utf8');
const agent = fs.readFileSync(agentPath, 'utf8');
const xyzFastPath = path.join(path.dirname(indexPath), 'xyz-fast.js');
const xyzFast = fs.readFileSync(xyzFastPath, 'utf8');
const configSource = fs.readFileSync(configPath, 'utf8');
const dataSource = fs.readFileSync(dataPath, 'utf8');
const contentView = fs.readFileSync('App/ContentView.swift', 'utf8');
const appDelegate = fs.readFileSync('App/BurreteApp.swift', 'utf8');
const appViewer = fs.readFileSync('App/MoleculeViewerWindowController.swift', 'utf8');
const quickLookViewer = fs.readFileSync('PreviewExtension/PreviewViewController.swift', 'utf8');
const rendererPolicy = fs.readFileSync('PreviewExtension/RendererPolicy.swift', 'utf8');
const quickLookInfo = fs.readFileSync('PreviewExtension/Info.plist', 'utf8');
const appInfo = fs.readFileSync('App/Info.plist', 'utf8');
const gridBuilder = fs.readFileSync('PreviewExtension/MoleculeGridPreview.swift', 'utf8');
const gridViewer = fs.readFileSync('PreviewExtension/Web/grid-viewer.js', 'utf8');
const gridCSS = fs.readFileSync('PreviewExtension/Web/grid.css', 'utf8');
const buildScript = fs.readFileSync('scripts/build.sh', 'utf8');
const releaseScript = fs.readFileSync('scripts/release.sh', 'utf8');
const forcePreview = fs.readFileSync('scripts/force-preview.sh', 'utf8');
const xcodeProject = fs.readFileSync('Burrete.xcodeproj/project.pbxproj', 'utf8');
const config = JSON.parse(configSource.replace(/^window\.BurreteConfig = /, '').replace(/;\s*$/, ''));
const sampleBasename = path.basename(sample).toLowerCase();
const ext = sampleBasename.endsWith('.mae.gz') ? 'maegz' : path.extname(sample).toLowerCase().slice(1);
const gridExts = new Set(['csv', 'sd', 'sdf', 'smi', 'smiles', 'tsv']);
const xyzrenderExts = new Set(['cub', 'cube', 'in', 'log', 'out', 'vasp', 'mae', 'maegz', 'cms']);

function assert(condition, message) {
  if (!condition) {
    console.error(`error: ${message}`);
    process.exit(1);
  }
}

assert(index.includes('role="toolbar"'), 'preview HTML must expose a toolbar role');
assert(index.includes('./xyz-fast.js'), 'preview HTML must load the Fast XYZ renderer asset');
assert(!index.includes('data-buret-action="fit"'), 'fit/fullscreen toolbar button should not be present');
assert(index.includes('aria-label="Collapse controls"'), 'toolbar handle should collapse controls');
assert(index.includes('aria-expanded="true"'), 'toolbar handle should expose expanded state');
assert(index.includes('top: var(--buret-toolbar-safe-top); right: 12px; left: auto'), 'toolbar should honor the safe top inset');
assert(index.includes('data-buret-action="theme"'), 'toolbar should expose a separate theme toggle');
assert(index.includes('data-buret-action="open-vesta"'), 'toolbar should expose a VESTA handoff button');
assert(index.includes('--buret-molstar-panel-background'), 'preview HTML must define Mol* theme panel colors');
assert(index.includes('.msp-viewport-controls-panel'), 'preview HTML must theme Mol* viewport panels');
assert(index.includes('.msp-viewport-controls-panel .msp-control-group-header > button'), 'preview HTML must style Mol* floating settings panel headers');
assert(index.includes('.msp-selection-viewport-controls > .msp-flex-row'), 'preview HTML must style Mol* selection viewport toolbar');
assert(index.includes('--buret-molstar-panel-radius'), 'preview HTML must define a shared Mol* panel radius');
assert(index.includes('.msp-hover-box-wrapper .msp-hover-box-body'), 'preview HTML must round Mol* hover panels');
assert(index.includes('.msp-action-menu-options'), 'preview HTML must round Mol* action menu panels');
assert(index.includes('.msp-snapshot-description-wrapper *'), 'preview HTML must theme Mol* snapshot description text');
assert(index.includes('.msp-sequence-select > select'), 'preview HTML must theme Mol* sequence selectors');
assert(index.includes('top: 64px !important'), 'Mol* viewport controls should clear the toolbar row');
assert(!index.includes('aria-label="Fullscreen"'), 'stale Fullscreen aria-label found');
assert(!index.includes('title="Fullscreen"'), 'stale Fullscreen title found');
assert(index.includes('./burette-agent.js'), 'preview HTML must load the Burette agent bridge before viewer.js');
assert(viewer.includes('window.BurreteConfig'), 'viewer.js must read BurreteConfig');
assert(viewer.includes('config.binary ? base64ToBytes(base64) : base64ToText(base64)'), 'viewer.js must pass binary molecular data as Uint8Array');
assert(viewer.includes('BurreteAgent?.attach'), 'viewer.js must attach the Burette agent bridge');
assert(viewer.includes('requestOpenInVesta'), 'viewer.js must request VESTA handoff from the host app');
assert(viewer.includes('setXyzrenderOrientation'), 'viewer.js must send Mol* orientation references before xyzrender handoff');
assert(viewer.includes('buildXyzrenderOrientationRef'), 'viewer.js must build xyzrender reference XYZ from Mol* camera orientation');
assert(agent.includes('window.BurreteAgent'), 'burette-agent.js must expose the BurreteAgent alias');
assert(agent.includes('window.BuretteAgent'), 'burette-agent.js must expose the BuretteAgent alias');
assert(appViewer.includes('burette-agent.js'), 'app viewer runtime must copy and load burette-agent.js');
assert(quickLookViewer.includes('burette-agent.js'), 'Quick Look runtime must copy and load burette-agent.js');
assert(appDelegate.includes('UserDefaults.didChangeNotification'), 'app delegate must watch display preference changes');
assert(appDelegate.includes('viewerRuntimePreferencesDidChange'), 'app delegate must route runtime preference changes to open viewers');
assert(appDelegate.includes('ViewerRuntimePreferences'), 'app delegate must compare the full viewer runtime preference set');
assert(appDelegate.includes('structureRendererMode'), 'app delegate must react when the renderer picker changes');
assert(appDelegate.includes('xyzFastStyle'), 'app delegate must react when the Fast XYZ style picker changes');
assert(appDelegate.includes('xyzrenderCustomConfigPath'), 'app delegate must react when xyzrender custom config changes');
assert(appDelegate.includes('xyzrenderExecutablePath'), 'app delegate must react when xyzrender executable path changes');
assert(appDelegate.includes('MoleculeGridFileSupport.load()'), 'app delegate must react when grid file support toggles change');
assert(appDelegate.includes('rendererSettingsDiffer'), 'renderer setting changes must clear temporary toolbar overrides');
assert(appDelegate.includes('controller.reloadDisplayPreferences()'), 'open app viewers must reload when display preferences change');
assert(appViewer.includes('func reloadSettingsPreferences()'), 'app viewer must expose a settings-preference reload hook');
assert(contentView.includes('@AppStorage("viewerTheme") private var viewerTheme = "auto"'), 'settings UI theme should default to auto');
assert(contentView.includes('@AppStorage("viewerCanvasBackground") private var viewerCanvasBackground = "auto"'), 'settings UI canvas background should default to auto');
assert(appDelegate.includes('string(forKey: "viewerTheme") ?? "auto"'), 'app display preferences should default theme to auto');
assert(appDelegate.includes('string(forKey: "viewerCanvasBackground") ?? "auto"'), 'app display preferences should default canvas background to auto');
assert(appViewer.includes('string(forKey: "viewerTheme") ?? "auto"'), 'standalone app viewer should default theme to auto');
assert(appViewer.includes('string(forKey: "viewerCanvasBackground") ?? "auto"'), 'standalone app viewer should default canvas background to auto');
assert(quickLookViewer.includes('CFPreferencesCopyAppValue("viewerTheme" as CFString, appID) as? String) ?? "auto"'), 'Quick Look should default theme to auto');
assert(quickLookViewer.includes('CFPreferencesCopyAppValue("viewerCanvasBackground" as CFString, appID) as? String) ?? "auto"'), 'Quick Look should default canvas background to auto');
assert(appViewer.includes('func enterFullScreen()'), 'standalone app viewer must expose native fullscreen for Quick Look handoff');
assert(appViewer.includes('window.toggleFullScreen(nil)'), 'standalone app viewer should use AppKit native fullscreen');
assert(!appViewer.includes('exitFullScreenMode'), 'standalone app viewer must not call AppKit fullscreen exit during open');
assert(!appDelegate.includes('.enterFullScreen()'), 'opening files in the app must not force native fullscreen');
assert(appViewer.includes('func reloadDisplayPreferences()'), 'app viewer must expose a display-preference reload hook');
assert(appViewer.includes('applyWindowDisplayPreferences'), 'app viewer must update native window appearance and material preferences');
assert(appViewer.includes('NSVisualEffectView'), 'app viewer transparency must use native macOS material instead of a fully clear custom window');
assert(appViewer.includes('viewerWindowOpacity'), 'app viewer must expose configurable window material opacity');
assert(appViewer.includes('viewerOverlayOpacity'), 'app viewer must expose configurable overlay readability');
assert(appViewer.includes('defaultViewerPageZoom: CGFloat = 1.0'), 'app viewer must keep WKWebView page zoom at 1.0 so Mol* mouse picking stays aligned');
assert(quickLookViewer.includes('defaultViewerPageZoom: CGFloat = 1.0'), 'Quick Look viewer must keep WKWebView page zoom at 1.0 so Mol* mouse picking stays aligned');
assert(quickLookViewer.includes('requiredAssets: runtimeAssets(for: renderer)'), 'Quick Look should copy only renderer-required assets');
assert(quickLookViewer.includes('quickLookViewer'), 'Quick Look XYZ previews should expose renderer switching controls');
assert(quickLookViewer.includes('setRendererOverride'), 'Quick Look should handle renderer switching from the toolbar');
assert(quickLookViewer.includes('setXyzrenderPresetOverride'), 'Quick Look should handle xyzrender preset switching from the toolbar');
assert(quickLookViewer.includes('canOpenInVesta'), 'Quick Look should expose VESTA handoff eligibility');
assert(quickLookViewer.includes('VestaLauncher.open'), 'Quick Look should hand eligible XYZ/Cube files to VESTA');
assert(quickLookViewer.includes('xyzrenderOrientationRefText'), 'Quick Look should keep the latest Mol* orientation reference');
assert(quickLookViewer.includes('arguments += ["--ref", orientationRefURL.path]'), 'Quick Look xyzrender launch should pass orientation refs with --ref');
assert(quickLookViewer.includes('PreviewExternalXyzrenderWorker.render'), 'Quick Look should support xyzrender artifacts for XYZ files');
assert(quickLookViewer.includes('externalArtifactSourceURL'), 'Quick Look should copy generated xyzrender artifacts into the preview runtime');
assert(rendererPolicy.includes('struct BurreteRendererPolicy'), 'renderer selection policy should live in the shared Swift resolver');
assert(rendererPolicy.includes('static func resolve'), 'shared renderer policy must expose a resolver');
assert(rendererPolicy.includes('renderer = isXYZ ? BurreteRendererMode.xyzFast : BurreteRendererMode.molstar'), 'shared auto renderer should remain Fast XYZ by default for XYZ files');
assert(appViewer.includes('BurreteRendererPolicy.resolve'), 'standalone app viewer must use the shared renderer policy resolver');
assert(quickLookViewer.includes('BurreteRendererPolicy.resolve'), 'Quick Look must use the shared renderer policy resolver');
assert(!appViewer.includes('enum AppViewerRendererMode'), 'standalone app should not keep a separate renderer normalizer');
assert(!quickLookViewer.includes('private static func resolvedRenderer'), 'Quick Look should not keep a separate renderer resolver');
assert((quickLookViewer.match(/scheduleRenderTimeout\(for: requestID\)/g) || []).length >= 2, 'Quick Look renderer reloads must keep the render watchdog active');
assert((quickLookViewer.match(/finishPreviewIfNeeded\(nil, requestID: requestID\)/g) || []).length >= 2, 'Quick Look renderer reload errors must finish the preview callback path');
assert(quickLookViewer.includes('requiresRDKit: true'), 'Quick Look grid previews should opt into RDKit assets explicitly');
assert(quickLookViewer.includes('copyAssetIfNeeded'), 'Quick Look should reuse unchanged runtime assets instead of recopying every preview');
assert(quickLookViewer.includes('gridRecordsScriptWithRDKitWasm'), 'Quick Look grid previews must pass RDKit wasm without file:// fetch');
assert(quickLookViewer.includes('"smi", "smiles"'), 'Quick Look should allow SMILES files before grid dispatch');
assert(quickLookViewer.includes('"csv"'), 'Quick Look should allow CSV files before grid dispatch');
assert(quickLookViewer.includes('"tsv"'), 'Quick Look should allow TSV files before grid dispatch');
assert(quickLookViewer.includes('"cub", "cube"'), 'Quick Look should allow Gaussian cube files before xyzrender dispatch');
assert(quickLookViewer.includes('"in", "log"'), 'Quick Look should allow quantum input/log files before xyzrender dispatch');
assert(quickLookViewer.includes('"out"'), 'Quick Look should allow quantum output files before xyzrender dispatch');
assert(quickLookViewer.includes('"vasp"'), 'Quick Look should allow VASP files before xyzrender dispatch');
assert(quickLookViewer.includes('"xtc", "trr", "dcd", "nctraj"'), 'Quick Look should map binary MD trajectories to Mol* formats');
assert(quickLookViewer.includes('"lammpstrj", "top", "psf", "prmtop"'), 'Quick Look should map text MD trajectory/topology files to Mol* formats');
assert(quickLookViewer.includes('"mae", "maegz", "cms"'), 'Quick Look should allow Schrodinger files before xyzrender dispatch');
assert(quickLookViewer.includes('PreviewStructureTextConverter'), 'Quick Look should have a sandbox-safe text-to-XYZ fallback for xyzrender-only formats');
assert(quickLookViewer.includes('xyzrender.default=built-in-text-parser'), 'Quick Look should use the built-in parser by default for xyzrender-only formats');
assert(quickLookViewer.includes('parseCube'), 'Quick Look fallback should parse cube/cub atom sections');
assert(quickLookViewer.includes('parseVasp'), 'Quick Look fallback should parse VASP POSCAR files');
assert(quickLookViewer.includes('parseQuantumEspressoInput'), 'Quick Look fallback should parse Quantum ESPRESSO input files');
assert(quickLookViewer.includes('parseOrcaOutput'), 'Quick Look fallback should parse ORCA output files');
assert(quickLookViewer.includes('parseGaussianOutput'), 'Quick Look fallback should parse Gaussian log files');
assert(quickLookInfo.includes('com.local.burrete10.xyzrender-input'), 'Quick Look Info.plist must register xyzrender-only input types');
assert(quickLookInfo.includes('com.local.burrete10.molecular-dynamics'), 'Quick Look Info.plist must register molecular dynamics content types');
assert(quickLookInfo.includes('com.local.burrete10.schrodinger'), 'Quick Look Info.plist must register Schrodinger content types');
assert(quickLookInfo.includes('mae.gz'), 'Quick Look Info.plist must register compressed Schrodinger Maestro files');
assert(appInfo.includes('com.local.burrete10.xyzrender-input'), 'app Info.plist must register xyzrender-only input types');
assert(appInfo.includes('com.local.burrete10.molecular-dynamics'), 'app Info.plist must register molecular dynamics content types');
assert(appInfo.includes('com.local.burrete10.schrodinger'), 'app Info.plist must register Schrodinger content types');
assert(appInfo.includes('mae.gz'), 'app Info.plist must register compressed Schrodinger Maestro files');
assert(appDelegate.includes('com.local.burrete10.xyzrender-input'), 'app runtime default-handler registration must include xyzrender-only input types');
assert(appDelegate.includes('com.local.burrete10.molecular-dynamics'), 'app runtime default-handler registration must include molecular dynamics content types');
assert(appDelegate.includes('com.local.burrete10.schrodinger'), 'app runtime default-handler registration must include Schrodinger content types');
assert(appViewer.includes('isExternalXyzrenderOnly'), 'standalone app viewer must route xyzrender-only formats away from Mol*');
assert(appViewer.includes('canOpenInVesta'), 'standalone app viewer should expose VESTA handoff eligibility');
assert(appViewer.includes('VestaLauncher.open'), 'standalone app viewer should hand eligible XYZ/Cube files to VESTA');
assert(appViewer.includes('xyzrenderOrientationRefText'), 'standalone app viewer should keep the latest Mol* orientation reference');
assert(appViewer.includes('arguments += ["--ref", orientationRefURL.path]'), 'standalone app xyzrender launch should pass orientation refs with --ref');
assert(quickLookViewer.includes('isExternalXyzrenderOnly'), 'Quick Look viewer must route xyzrender-only formats away from Mol*');
assert(!appViewer.includes('URL(fileURLWithPath: "/usr/bin/env")'), 'standalone app xyzrender launch must not depend on /usr/bin/env');
assert(!quickLookViewer.includes('URL(fileURLWithPath: "/usr/bin/env")'), 'Quick Look xyzrender launch must not depend on /usr/bin/env');
assert(viewer.includes('xyzrenderViewer'), 'web viewer must expose xyzrender controls for xyzrender-only formats');
assert(appViewer.includes('gridRecordsScriptWithRDKitWasm'), 'standalone grid previews must pass RDKit wasm without file:// fetch');
assert(appViewer.includes('fileSupport: MoleculeGridFileSupport.load()'), 'standalone grid previews must honor enabled grid file types');
assert(gridViewer.includes('wasmBinary'), 'grid viewer must initialize RDKit with an in-memory wasmBinary fallback');
assert(gridViewer.includes('buret.grid.cardSize'), 'grid viewer must persist card size controls');
assert(gridViewer.includes('buret.grid.moleculeScale'), 'grid viewer must persist molecule zoom controls');
assert(gridViewer.includes('data-grid-size="compact"'), 'grid viewer must use stable segmented card-size controls');
assert(gridViewer.includes('buret.grid.loadBatch'), 'grid viewer must persist infinite-scroll batch size controls');
assert(gridViewer.includes('load-sentinel'), 'grid viewer must use a sentinel for infinite scrolling');
assert(gridViewer.includes('IntersectionObserver'), 'grid viewer must dynamically append molecules while scrolling');
assert(!gridViewer.includes('page-label'), 'grid viewer must not expose page navigation labels');
assert(gridViewer.includes('buret-hide-properties'), 'grid viewer must allow hiding card metadata properties');
assert(gridCSS.includes('--buret-card-min'), 'grid CSS must expose card size variables');
assert(gridCSS.includes('--buret-molecule-scale'), 'grid CSS must expose molecule zoom variables');
assert(gridCSS.includes('.buret-toolbar-row-main'), 'grid CSS must use named toolbar rows instead of fragile child selectors');
assert(gridCSS.includes('.buret-segmented-control'), 'grid CSS must style segmented grid-size controls');
assert(gridCSS.includes('.buret-load-status'), 'grid CSS must style infinite-scroll load status');
assert(gridBuilder.includes('case "csv"'), 'grid builder must parse CSV molecule tables');
assert(gridBuilder.includes('canonical_smiles'), 'grid builder must recognize canonical_smiles CSV columns');
assert(contentView.includes('CSV tables'), 'settings UI must expose CSV molecule table support');
assert(contentView.includes('TSV tables'), 'settings UI must expose TSV molecule table support');
assert(quickLookInfo.includes('public.comma-separated-values-text'), 'Quick Look should support CSV table content type');
assert(!quickLookInfo.includes('<string>public.comma-separated-values-text</string>\n\t\t\t\t\t<string>public.data</string>'), 'Quick Look should not claim every generic data file');
assert(quickLookInfo.includes('public.tab-separated-values-text'), 'Quick Look should support TSV table content type');
assert(quickLookInfo.includes('net.sourceforge.openbabel.xyz'), 'Quick Look should support Open Babel XYZ content type');
assert(appInfo.includes('net.sourceforge.openbabel.xyz'), 'app document types should support Open Babel XYZ content type');
assert(quickLookInfo.includes('com.local.burettexyzrender.smiles'), 'Quick Look should support existing SMILES content type');
assert(quickLookInfo.includes('com.local.molstarquicklook10.smiles'), 'Quick Look should support legacy SMILES content type');
assert(appDelegate.includes('com.local.burettexyzrender.smiles'), 'default-handler registration should include existing SMILES content type');
assert(appDelegate.includes('com.local.molstarquicklook10.smiles'), 'default-handler registration should include legacy SMILES content type');
assert(appDelegate.includes('public.comma-separated-values-text'), 'default-handler registration should include CSV table content type');
assert(appDelegate.includes('public.tab-separated-values-text'), 'default-handler registration should include TSV table content type');
assert(appDelegate.includes('MoleculeGridFileSupport.load()'), 'default-handler registration should respect enabled grid file type settings');
assert(forcePreview.includes('smi|SMI|smiles|SMILES'), 'force-preview should support SMILES files');
assert(forcePreview.includes('csv|CSV'), 'force-preview should support CSV files');
assert(forcePreview.includes('tsv|TSV'), 'force-preview should support TSV files');
assert(buildScript.includes('PreviewExtension/Web/burette-agent.js'), 'build script must require and syntax-check burette-agent.js');
assert(releaseScript.includes('PreviewExtension/Web/burette-agent.js'), 'release script must require and syntax-check burette-agent.js');
assert(xcodeProject.includes('PreviewExtension/Web/burette-agent.js'), 'Xcode validation phase must track burette-agent.js');
assert(viewer.includes('startXYZFast'), 'viewer.js must support Fast XYZ rendering');
assert(viewer.includes('startExternalArtifact'), 'viewer.js must support external xyzrender artifacts');
assert(viewer.includes("config.quickLookViewer === true && format === 'xyz'"), 'viewer.js must show renderer controls for Quick Look XYZ previews');
assert(viewer.includes('xyzrenderViewer'), 'viewer.js must show xyzrender preset controls for xyzrender-only previews');
assert(xyzFast.includes('BurreteXYZFast'), 'xyz-fast.js must expose BurreteXYZFast');
assert(viewer.includes('buret.toolbar.collapsed'), 'viewer.js must remember compact toolbar state');
assert(viewer.includes('TOOLBAR_POSITION_VERSION'), 'viewer.js must reset stale toolbar positions');
assert(viewer.includes("TOOLBAR_POSITION_VERSION = '7'"), 'toolbar position cache should invalidate pre-safe-area positions');
assert(viewer.includes("mode: 'custom'"), 'viewer.js must distinguish custom toolbar positions from defaults');
assert(!viewer.includes('initMolstarRightPanelToggle'), 'viewer.js must keep Mol* right-side buttons native');
assert(viewer.includes('VIEWER_THEME_STORAGE_KEY'), 'viewer.js must persist the separate theme toggle');
assert(!viewer.includes('initMolstarThemeToggle'), 'viewer.js must keep Mol* Illumination button native');
assert(viewer.includes("event.target.closest('[data-buret-toggle]')"), 'toolbar drag should not capture panel toggle buttons');
assert(viewer.includes("event.target.closest('select, input, textarea')"), 'toolbar drag should not capture picker controls');
assert(viewer.includes('startedOnHandle'), 'toolbar grip clicks should survive pointer capture and toggle collapse');
assert(viewer.includes('toolbarSafeTop'), 'toolbar drag should clamp to the safe top inset');
assert(!viewer.includes('initFastViewportReset'), 'Mol* reset camera button should keep its native click behavior');
assert(!appViewer.includes('outerDragInset'), 'standalone app viewer should use the native window frame instead of an inset fake frame');
assert(viewer.includes('normalizeViewerTheme'), 'viewer.js must support viewer themes');
assert(viewer.includes('canvasBackgroundColor'), 'viewer.js must support configurable canvas backgrounds');
assert(viewer.includes('resolvedCanvasBackground'), 'viewer.js must resolve auto canvas backgrounds from the active theme');
assert(viewer.includes("['auto', 'black', 'graphite', 'white', 'transparent']"), 'viewer.js must accept auto canvas background mode');
assert(viewer.includes('viewportBackgroundColor'), 'viewer.js must seed Mol* with the requested canvas background');
assert(viewer.includes('Mol* WebGL picking uses unscaled client coordinates'), 'viewer.js must document why Mol* cannot use page/body zoom');
assert(dataSource.startsWith('window.BurreteDataBase64 = "'), 'preview data file must define BurreteDataBase64');
assert(config.label === path.basename(sample), 'config label should match sample basename');
if (ext === 'csv') assert(config.format === 'csv' && config.mode === 'grid2d', 'CSV samples should be dispatched as grid2d CSV previews');
if (ext === 'tsv') assert(config.format === 'tsv' && config.mode === 'grid2d', 'TSV samples should be dispatched as grid2d TSV previews');
if (['smi', 'smiles'].includes(ext)) assert(config.format === 'smiles' && config.mode === 'grid2d', 'SMILES samples should be dispatched as grid2d previews');
assert(typeof config.byteCount === 'number' && config.byteCount > 0, 'config byteCount should be positive');
assert(config.theme === 'auto', 'theme should default to auto');
assert(config.canvasBackground === 'auto', 'canvas background should default to auto');
assert(config.transparentBackground === false, 'transparent background should be opt-in');
assert(config.sdfGrid === true, 'SDF grid flag should be encoded');
assert(config.molstarFormat === config.format, 'molstarFormat should mirror the resolved Mol* format');
assert(config.allowMolstarFallback === true, 'Mol* fallback flag should be encoded');
assert(config.renderer === (gridExts.has(ext) ? 'grid2d' : (ext === 'xyz' ? 'xyz-fast' : (xyzrenderExts.has(ext) ? 'xyzrender-external' : 'molstar'))), 'renderer should select grid2d for molecule collections, Fast XYZ for .xyz, xyzrender for xyzrender-only formats, and Mol* otherwise');
if (ext === 'xyz') {
  assert(config.xyzFast && config.xyzFast.firstFrameOnly === true, 'XYZ web test should encode first-frame Fast XYZ options');
  assert(config.xyzFast.showCell === true, 'XYZ web test should encode cell drawing preference');
}
if (xyzrenderExts.has(ext)) {
  assert(config.xyzrenderViewer === true, 'xyzrender-only web test should expose xyzrender controls');
  assert(config.molstarAvailable === false, 'xyzrender-only web test should hide Mol* switching');
  assert(config.externalArtifact && config.externalArtifact.path === 'xyzrender.svg', 'xyzrender-only web test should generate an SVG artifact');
}

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
  gro: 'gro',
  xtc: 'xtc',
  trr: 'trr',
  dcd: 'dcd',
  nctraj: 'nctraj',
  lammpstrj: 'lammpstrj',
  top: 'top',
  psf: 'psf',
  prmtop: 'prmtop',
  cub: 'xyzrender',
  cube: 'xyzrender',
  in: 'xyzrender',
  log: 'xyzrender',
  out: 'xyzrender',
  vasp: 'xyzrender',
  mae: 'xyzrender',
  maegz: 'xyzrender',
  cms: 'xyzrender'
};
if (expectedFormats[ext]) {
  assert(config.format === expectedFormats[ext], `expected ${ext} to map to ${expectedFormats[ext]}, got ${config.format}`);
}
if (ext === 'bcif') {
  assert(config.binary === true, 'BCIF should be marked binary');
}
if (['xtc', 'trr', 'dcd', 'nctraj'].includes(ext)) {
  assert(config.binary === true, `${ext.toUpperCase()} should be marked binary`);
}
if (['xyz', 'cub', 'cube'].includes(ext)) {
  assert(config.canOpenInVesta === true, `${ext.toUpperCase()} should expose VESTA handoff`);
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
