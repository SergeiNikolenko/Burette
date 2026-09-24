import type { XyzrenderControls } from '../types';

export type RenderProperty = {
  id: string; label: string; control?: keyof XyzrenderControls; flag?: string;
  kind?: 'number' | 'toggle' | 'text'; options?: string[]; min?: number; max?: number;
  step?: number; hint?: string; arity?: number; repeat?: boolean; negative?: string;
};
const c = (control: keyof XyzrenderControls, label: string, rest: Partial<RenderProperty> = {}): RenderProperty => ({ id: control, control, label, ...rest });
const f = (flag: string, label: string, rest: Partial<RenderProperty> = {}): RenderProperty => ({ id: flag, flag, label, ...rest });
const number = { kind: 'number' as const, min: 0, step: 0.1 };
const toggle = { kind: 'toggle' as const };
const selector = 'Atoms: 1-6,8 · elements: C,N · groups: M,het';
export const renderPropertyGroups: { name: string; description: string; fields: RenderProperty[] }[] = [
  { name: 'Atoms & bonds', description: 'Size, outlines and molecular colour', fields: [
    c('atomScale', 'Atom size', number), c('bondWidth', 'Bond width', number), c('atomStrokeWidth', 'Atom outline', number),
    c('molColor', 'Molecule colour', { hint: 'Colour name or #hex; empty uses element colours' }),
    f('--bond-color', 'Bond colour'), f('--bond-outline-color', 'Bond outline colour'), f('--bond-outline-width', 'Bond outline width', number),
    f('--bond-by-element', 'Element-coloured bonds', { ...toggle, negative: '--no-bond-by-element' }), f('--bond-gradient', 'Shaded bonds', { ...toggle, negative: '--no-bond-gradient' }),
    f('--atom-interlocking', 'Interlocked atoms', { ...toggle, negative: '--no-atom-interlocking' }), f('--h-scale', 'Hydrogen size', number),
    f('--radius-scale', 'Local radius rules', { repeat: true, arity: 2, hint: 'One rule per line: Fe 1.4' }),
    f('--atom-opacity', 'Local opacity rules', { repeat: true, arity: 2, hint: 'One rule per line: 1-6 0.5' }),
  ] },
  { name: 'Selection & interactions', description: 'Atom subsets, highlights and bond rules', fields: [
    f('--only', 'Show only', { hint: selector }), f('--exclude', 'Exclude atoms', { hint: selector }),
    f('--hl', 'Highlight rules', { repeat: true, arity: 2, hint: 'One per line: 1-6 steelblue' }),
    f('--unbond', 'Hide bonds', { hint: 'Pairs or rules: 1-2 M-L M-pi' }), f('--bond', 'Add bonds', { hint: 'Pairs: 1-3 4-5' }),
    f('--haptic', 'Haptic centroid bonds', toggle), f('--ts', 'Detect transition-state bonds', toggle),
    f('--ts-bond', 'Manual TS bonds', { repeat: true, hint: 'One pair per line: 1-2' }), f('--ts-color', 'TS colour'), f('--ts-element', 'TS element colours', { ...toggle, negative: '--no-ts-element' }), f('--ts-frame', 'TS reference frame', { ...number, step: 1 }),
    f('--ts-dash', 'TS dash pattern', { hint: 'Length,gap: 1.2,2.2' }), f('--ts-width', 'TS line width', number),
    f('--nci', 'Detect non-covalent interactions', toggle), f('--nci-bond', 'Manual NCI bonds', { repeat: true, hint: 'One pair per line: 4-9' }),
    f('--nci-color', 'NCI colour'), f('--nci-element', 'NCI element colours', { ...toggle, negative: '--no-nci-element' }), f('--nci-dash', 'NCI dash pattern', { hint: 'Length,gap: 0.08,2.0' }), f('--nci-width', 'NCI line width', number),
  ] },
  { name: 'Depth & lighting', description: 'Shading, atmosphere and focus', fields: [
    c('fogStrength', 'Fog strength', number), f('--fog-color', 'Fog colour'), f('--atom-gradient-strength', 'Gradient strength', number),
    f('--dof', 'Depth of field', toggle), f('--dof-strength', 'Focus blur', number),
    f('--glow', 'Glowing atoms', { hint: selector }), f('--glow-strength', 'Glow blur', number),
    f('--hue-shift-factor', 'Hue shift', { ...number, min: -360 }), f('--light-shift-factor', 'Lightness shift', { ...number, min: -1 }),
    f('--saturation-shift-factor', 'Saturation shift', { ...number, min: -1 }),
  ] },
  { name: 'van der Waals', description: 'Sphere selection and rendering', fields: [
    c('vdwAtoms', 'Sphere atoms', { hint: selector }), c('vdwScale', 'Sphere size', number), c('vdwOpacity', 'Sphere opacity', { ...number, max: 1 }),
    f('--vdw-gradient-strength', 'Sphere shading', number), f('--vdw-interlocking', 'Interlocked spheres', { ...toggle, negative: '--no-vdw-interlocking' }),
    f('--vdw-outline-width', 'Sphere outline', number), f('--vdw-outline-color', 'Outline colour'), f('--vdw-h-scale', 'Hydrogen sphere size', number),
  ] },
  { name: 'Surfaces', description: 'Orbitals, density and mapped fields', fields: [
    c('fieldMode', 'Field', { options: ['auto', 'off', 'mo', 'density', 'esp', 'nci'] }),
    c('fieldIso', 'Isovalue', { ...number, step: 0.001 }), c('fieldOpacity', 'Opacity', number),
    c('fieldSurfaceStyle', 'Surface style', { options: ['solid', 'mesh', 'contour', 'dot'] }),
    f('--esp', 'ESP colour map file', { hint: 'Absolute path to ESP cube; open the density cube as the main structure' }),
    f('--nci-surf', 'Interaction surface file', { hint: 'Absolute path to RDG / IGMH cube; main cube supplies the colouring field' }),
    f('--nci-mode', 'Interaction colouring', { options: ['avg', 'pixel', 'uniform'] }),
    c('fieldMoPositiveColor', 'Positive orbital colour'), c('fieldMoNegativeColor', 'Negative orbital colour'), c('fieldDensityColor', 'Density colour'),
    f('--mo-outline-width', 'Orbital outline', number), f('--mo-outline-color', 'Orbital outline colour'),
    f('--mo-blur', 'Orbital smoothing', number), f('--mo-upsample', 'Contour detail', { ...number, min: 1, max: 8, step: 1 }),
    f('--flat-mo', 'Flat orbital colours', toggle),
  ] },
  { name: 'Rings, faces & pores', description: 'Geometry overlays', fields: [
    c('hullAtoms', 'Hull atoms', { hint: selector }), c('hullOpacity', 'Face opacity', { ...number, max: 1 }), c('poreOpacity', 'Pore opacity', { ...number, max: 1 }),
    f('--hull-color', 'Face colour'), f('--hull-color-type', 'Ring colouring', { options: ['type', 'size', 'env'] }),
    f('--hull-edge', 'Show face edges', { ...toggle, negative: '--no-hull-edge' }), f('--hull-edge-width-ratio', 'Edge width ratio', number),
    f('--ring-min-size', 'Minimum ring size', { ...number, min: 3, step: 1 }), f('--ring-max-size', 'Maximum ring size', { ...number, min: 3, step: 1 }),
    f('--face-planarity', 'Planarity tolerance', { ...number, max: 1 }), f('--pore-color', 'Pore colour'),
  ] },
  { name: 'Compare structures', description: 'Aligned overlay or conformer ensemble', fields: [
    f('--overlay', 'Overlay structure file', { hint: 'Absolute path to a second structure; clear before enabling ensemble' }),
    f('--overlay-color', 'Overlay colour'), f('--opacity', 'Overlay / ensemble opacity', { ...number, max: 1 }),
    f('--no-align', 'Keep original coordinates', toggle), f('--align-atoms', 'Alignment atoms', { hint: selector }),
    f('--overlay-atom-scale', 'Overlay atom size', number), f('--overlay-bond-width', 'Overlay bond width', number),
    f('--overlay-show', 'Overlay atoms', { hint: selector }), f('--overlay-unbond', 'Hide overlay bonds'), f('--overlay-bond', 'Add overlay bonds'),
    f('--overlay-ts', 'Overlay TS detection', toggle), f('--overlay-ts-bond', 'Overlay TS pairs', { repeat: true }),
    f('--ensemble', 'Conformer ensemble', toggle), f('--ensemble-color', 'Ensemble palette', { options: ['spectral', 'viridis', 'plasma', 'coolwarm', 'cpk'] }),
  ] },
  { name: 'Labels & measurements', description: 'Annotations for static figures', fields: [
    f('--idx', 'Atom labels', { options: ['sn', 's', 'n'] }), f('--stereo', 'Stereochemistry', { options: ['point', 'ez', 'axis', 'plane', 'helix', 'point,ez,axis,plane,helix'] }),
    f('--stereo-style', 'Stereo placement', { options: ['atom', 'label'] }), f('-l', 'Annotations', { repeat: true, hint: 'One annotation per line, e.g. 1 2 d for distance; 1 2 3 a for angle; 1 2 3 4 t for torsion' }),
    f('--label', 'Annotation file'), f('--label-size', 'Label size', { ...number, min: 1 }),
    f('--cmap', 'Atom property file', { hint: 'File with atom index and value per line' }),
    c('fieldCmapPalette', 'Property palette', { options: ['viridis', 'plasma', 'coolwarm', 'RdBu', 'batlow', 'rainbow'] }),
    c('fieldCmapMin', 'Minimum value', { kind: 'number', step: 0.1 }), c('fieldCmapMax', 'Maximum value', { kind: 'number', step: 0.1 }),
    f('--cmap-symm', 'Symmetric colour range', toggle), f('--cbar', 'Colour scale legend', toggle),
    f('--vector', 'Vector arrows file', { hint: 'JSON with 3D vector arrows' }), f('--vector-scale', 'Vector scale', number),
  ] },
  { name: 'Crystal', description: 'Requires lattice / unit-cell data', fields: [
    c('showCell', 'Unit cell', toggle), c('showGhosts', 'Periodic images', toggle), c('showAxes', 'Crystal axes', toggle),
    c('cellWidth', 'Cell line width', number), f('--cell-color', 'Cell colour'), f('--ghost-opacity', 'Periodic image opacity', { ...number, max: 1 }),
    f('--axis', 'View direction', { hint: 'Miller indices, e.g. 111' }), f('--supercell', 'Supercell', { arity: 3, hint: 'Repeats along a b c, e.g. 2 2 1' }), f('--unwrap', 'Unwrap molecules', toggle),
  ] },
  { name: 'Input & output', description: 'Interpretation and render resolution', fields: [
    c('canvasSize', 'Image size', { ...number, min: 128, max: 4096, step: 64 }), f('--mol-frame', 'SDF record', { ...number, step: 1 }),
    f('--charge', 'Charge', { kind: 'number', step: 1 }), f('--multiplicity', 'Multiplicity', { ...number, min: 1, step: 1 }),
    f('--bohr', 'Coordinates in Bohr', toggle), f('--rebuild', 'Rebuild connectivity', toggle),
    c('customConfigPath', 'Custom style JSON', { hint: 'Absolute path to a saved xyzrender preset' }),
  ] },
];

// This is an argument codec, never a shell command. Preserve unknown options for
// compatibility with custom presets; one repeated rule is shown per text line.
export function splitRenderArguments(value: string): string[] {
  const tokens: string[] = []; let token = ''; let quote = ''; let escape = false;
  for (const char of value) {
    if (escape) { token += char; escape = false; }
    else if (char === '\\') escape = true;
    else if (quote) { if (char === quote) quote = ''; else token += char; }
    else if (char === '"' || char === "'") quote = char;
    else if (/\s/.test(char)) { if (token) tokens.push(token); token = ''; }
    else token += char;
  }
  if (escape) token += '\\';
  if (token) tokens.push(token);
  return tokens;
}
function flagToken(value: string) { return /^--?[a-zA-Z]/.test(value); }
function entries(value: string) {
  const result: { flag: string; args: string[] }[] = [];
  for (const token of splitRenderArguments(value)) {
    if (flagToken(token)) { const eq = token.indexOf('='); result.push(eq > 0 ? { flag: token.slice(0, eq), args: [token.slice(eq + 1)] } : { flag: token, args: [] }); }
    else if (result.length) result[result.length - 1].args.push(token);
  }
  return result;
}
export function readRenderProperty(controls: XyzrenderControls, field: RenderProperty): string {
  if (field.control) return String(controls[field.control] ?? '');
  const options = entries(controls.extraArguments || '');
  if (field.negative) return options.some(entry => entry.flag === field.negative) ? 'false' : options.some(entry => entry.flag === field.flag) ? 'true' : '';
  const matches = options.filter(entry => entry.flag === field.flag);
  return field.kind === 'toggle' ? String(matches.length > 0) : matches.map(entry => entry.args.map(arg =>
    (field.arity || field.repeat) && /[\s"\\]/.test(arg) ? JSON.stringify(arg) : arg,
  ).join(' ')).join('\n');
}
export function setRenderProperty(controls: XyzrenderControls, field: RenderProperty, value: string): XyzrenderControls {
  if (field.control) return { ...controls, [field.control]: value === '' ? null : field.kind === 'number' ? Number(value) : field.kind === 'toggle' ? value === 'true' : value };
  const list = entries(controls.extraArguments || '').filter(entry => entry.flag !== field.flag && entry.flag !== field.negative);
  if (field.negative && value === 'false') list.push({ flag: field.negative, args: [] });
  if (value && !(field.kind === 'toggle' && value === 'false')) {
    for (const row of (field.repeat ? value.split('\n') : [value]).filter(row => row.trim())) {
      const args = field.kind === 'toggle' ? [] : field.arity || field.repeat || ['--unbond', '--bond', '--overlay-unbond', '--overlay-bond'].includes(field.flag || '') ? splitRenderArguments(row) : [row];
      list.push({ flag: field.flag!, args });
    }
  }
  return { ...controls, extraArguments: list.flatMap(entry => [entry.flag, ...entry.args.map(arg => JSON.stringify(arg))]).join(' ') };
}
