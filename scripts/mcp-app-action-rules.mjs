// Model-facing argument rules for MCP App actions. The mounted widget repeats
// the checks that depend on live state; these rules reject malformed requests
// before they are queued.

export const xyzrenderPresets = ['default', 'flat', 'paton', 'pmol', 'skeletal', 'bubble', 'tube', 'btube', 'mtube', 'wire', 'graph', 'vdw'];
// Formats the native xyzrender endpoint reads, and its source size limit.
export const xyzrenderFormats = ['xyz', 'sdf', 'sd', 'mol', 'smi', 'smiles', 'pdb', 'cif', 'mmcif'];
export const xyzrenderMaxBytes = 512 * 1024;

const booleanControls = ['transparentBackground', 'gradients', 'fog', 'showVdw', 'hideBonds', 'showCell', 'showGhosts', 'showAxes'];
const numberControls = { canvasSize: [64, 2048], atomScale: [0, 100], bondWidth: [0, 100], atomStrokeWidth: [0, 100], fogStrength: [0, 100], vdwOpacity: [0, 1], vdwScale: [0, 100], hullOpacity: [0, 1], poreOpacity: [0, 1], cellWidth: [0, 100] };
const choiceControls = {
  displayHydrogens: ['all', 'auto', 'none'],
  bondNotation: ['aromatic', 'kekule'],
  hullMode: ['benzene-ring', 'anthracene-rings', 'auto-rings', 'faces', 'mof5-faces', 'faces-pore', 'pore', 'mof5-pore'],
};
const atomSelector = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/u;

const fail = message => { throw new Error(message); };

function validateXyzrenderControls(controls) {
  if (controls === undefined) return;
  if (!controls || typeof controls !== 'object' || Array.isArray(controls)) fail('controls must be an object.');
  for (const [key, value] of Object.entries(controls)) {
    // null restores the preset default for that control.
    if (value === null) continue;
    if (booleanControls.includes(key)) { if (typeof value !== 'boolean') fail(`controls.${key} must be a boolean or null.`); continue; }
    if (numberControls[key]) {
      const [min, max] = numberControls[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`controls.${key} must be a number from ${min} to ${max}, or null.`);
      continue;
    }
    if (choiceControls[key]) { if (!choiceControls[key].includes(value)) fail(`controls.${key} must be one of ${choiceControls[key].join(', ')}, or null.`); continue; }
    if (key === 'molColor') { if (typeof value !== 'string' || !/^(#[0-9a-f]{3,8}|[a-z]{1,32})$/iu.test(value)) fail('controls.molColor must be a hex or CSS color name.'); continue; }
    if (key === 'vdwAtoms' || key === 'hullAtoms') { if (typeof value !== 'string' || value.length > 512 || !atomSelector.test(value)) fail(`controls.${key} must be a 1-based atom selector such as "1-6,9".`); continue; }
    if (key === 'supercell') { if (!Array.isArray(value) || value.length !== 3 || value.some(n => !Number.isInteger(n) || n < 1 || n > 4)) fail('controls.supercell must be three integers from 1 to 4.'); continue; }
    fail(`Unsupported xyzrender control: ${key}.`);
  }
}

/** Throws an Error with a model-actionable message when an action is malformed. */
export function validateMcpAppAction(action) {
  if (action.type === 'set_xyzrender_view') {
    if (action.preset !== undefined && !xyzrenderPresets.includes(action.preset)) fail(`preset must be one of ${xyzrenderPresets.join(', ')}.`);
    if (action.renderer !== undefined && !['xyzrender', 'molstar'].includes(action.renderer)) fail('renderer must be xyzrender or molstar.');
    validateXyzrenderControls(action.controls);
    if (action.preset === undefined && action.renderer === undefined && !Object.keys(action.controls || {}).length) fail('set_xyzrender_view needs preset, controls or renderer.');
    if (action.renderer === 'molstar' && (action.preset !== undefined || action.controls !== undefined)) fail('Switching to Mol* cannot also apply xyzrender preset or controls.');
  }
  // Paths are checked when the files are snapshotted.
  if (action.type === 'open_files' && action.view !== undefined && !['auto', 'xyzrender'].includes(action.view)) fail('open_files view must be auto or xyzrender.');
  if (action.type === 'set_workspace_panel' && (!['right', 'bottom'].includes(action.area) || typeof action.open !== 'boolean' || (action.documentId !== undefined && (typeof action.documentId !== 'string' || action.documentId.length > 256)))) {
    fail('Panel action requires right/bottom area, boolean open and an optional observed documentId.');
  }
  if (action.type === 'set_display_mode' && !['inline', 'fullscreen'].includes(action.mode)) fail('Display mode must be inline or fullscreen.');
}

/** Explains why a workspace-only action cannot run in the compact inline viewer. */
export function compactViewerActionError(type) {
  return `${type} is not available in the compact inline viewer: it shows one PDB/mmCIF document without tabs, file additions, Ketcher, Story, docking, panels or xyzrender. Open a native workspace with burette_open_viewer (file plus additionalFiles, up to 8 files) and control that session instead.`;
}

/** Bounded open-time notes for documents that xyzrender cannot render. */
export function xyzrenderOpenNotes(documents) {
  const notes = [];
  for (const document of documents.slice(0, 8)) {
    if (!xyzrenderFormats.includes(document.format)) notes.push(`${document.label}: xyzrender cannot read ${document.format}; it opens in Mol* or its native view.`);
    else if (document.byteCount > xyzrenderMaxBytes) notes.push(`${document.label}: ${document.byteCount} bytes exceeds the 512 KiB xyzrender input limit; it opens in Mol*.`);
  }
  notes.push('Proteins above 1500 atoms, multi-record SDF collections and failed renders open in Mol*. Confirm activeDocument.externalRenderer.status (ready, rendering, failed or fallback) with burette_observe_inline_viewer before describing the view.');
  return notes;
}
