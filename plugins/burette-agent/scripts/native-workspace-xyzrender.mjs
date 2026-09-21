import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const presets = ['default', 'flat', 'paton', 'pmol', 'skeletal', 'bubble', 'tube', 'btube', 'mtube', 'wire', 'graph', 'vdw'];
const maxBytes = 512 * 1024;

/** App-only rendering: no arbitrary input/config/output paths or extra CLI flags. */
export async function renderNativeWorkspaceXyz(input, { source, execute = executeFile } = {}) {
  const controls = input.controls || {};
  if (controls.customConfigPath || controls.extraArguments || input.preset === 'custom') throw new Error('Native XYZRender supports built-in presets, not custom config paths or extra CLI arguments.');
  const preset = input.preset || 'default';
  if (!presets.includes(preset)) throw new Error('Unknown XYZRender preset.');
  const extension = input.inputExtension || source?.format;
  if (!['xyz', 'sdf', 'sd', 'mol', 'smi', 'smiles', 'pdb', 'cif', 'mmcif'].includes(extension)) throw new Error('Unsupported XYZRender input format.');
  let bytes;
  if (input.inputDataBase64) {
    if (input.inputDataBase64.length > Math.ceil(maxBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.inputDataBase64)) throw new Error('XYZRender input exceeds 512 KiB or is invalid.');
    bytes = Buffer.from(input.inputDataBase64, 'base64');
  } else {
    if (!source || (await stat(source.path)).size > maxBytes) throw new Error('XYZRender requires an authorized source of at most 512 KiB.');
    bytes = await readFile(source.path);
  }
  if (!bytes.length) throw new Error('Empty XYZRender input.');
  if (extension === 'xyz' && input.activeModel != null) {
    if (!Number.isSafeInteger(input.activeModel) || input.activeModel < 0) throw new Error('Invalid XYZ frame index.');
    const lines = bytes.toString('utf8').replace(/\r\n?/gu, '\n').trimEnd().split('\n');
    const frames = [];
    for (let i = 0; i < lines.length;) {
      if (!lines[i].trim()) { i++; continue; }
      const count = Number(lines[i]);
      if (!Number.isSafeInteger(count) || count < 1 || i + count + 2 > lines.length) throw new Error('Invalid XYZ trajectory frame.');
      frames.push(lines.slice(i, i + count + 2).join('\n') + '\n');
      i += count + 2;
    }
    if (!frames[input.activeModel]) throw new Error('XYZ trajectory frame is out of range.');
    bytes = Buffer.from(frames[input.activeModel]);
  }
  const candidates = [join(homedir(), '.local/bin/xyzrender'), '/opt/homebrew/bin/xyzrender', '/usr/local/bin/xyzrender', ...String(process.env.PATH || '').split(delimiter).filter(Boolean).map(path => join(path, 'xyzrender'))];
  let executable;
  for (const path of candidates) if (await access(path).then(() => true, () => false)) { executable = path; break; }
  if (!executable) throw new Error('External xyzrender executable was not found on this host.');
  const directory = await mkdtemp(join(tmpdir(), 'burette-native-xyzrender-'));
  const startedAt = Date.now();
  try {
    const inputPath = join(directory, `input.${extension}`);
    const outputPath = join(directory, 'render.svg');
    await writeFile(inputPath, bytes);
    const args = [inputPath, '-o', outputPath, '--config', preset];
    const numbers = { canvasSize: '-S', atomScale: '-a', bondWidth: '-b', atomStrokeWidth: '-s', fogStrength: '-F', vdwOpacity: '--vdw-opacity', vdwScale: '--vdw-scale', hullOpacity: '--hull-opacity', poreOpacity: '--pore-opacity', cellWidth: '--cell-width', fieldIso: '--iso', fieldOpacity: '--opacity' };
    for (const [key, flag] of Object.entries(numbers)) if (controls[key] != null) {
      const value = Number(controls[key]);
      if (!Number.isFinite(value) || value < 0 || value > (key === 'canvasSize' ? 2048 : 100)) throw new Error(`Invalid XYZRender ${key}.`);
      args.push(flag, String(value));
    }
    for (const [key, yes, no] of [['transparentBackground', '--transparent'], ['gradients', '--grad', '--no-grad'], ['fog', '--fog', '--no-fog'], ['hideBonds', '--no-bonds'], ['showCell', '--cell', '--no-cell'], ['showGhosts', '--ghosts', '--no-ghosts'], ['showAxes', '--axes', '--no-axes']]) {
      if (controls[key] === true) args.push(yes);
      else if (controls[key] === false && no) args.push(no);
    }
    const selector = value => { if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/u.test(value) || value.length > 512) throw new Error('Invalid atom selector.'); return value; };
    if (controls.showVdw && preset !== 'vdw') { args.push('--vdw'); if (controls.vdwAtoms) args.push(selector(controls.vdwAtoms)); }
    const hull = controls.hullAtoms ? selector(controls.hullAtoms) : ['benzene-ring', 'anthracene-rings', 'auto-rings'].includes(controls.hullMode) ? 'rings' : ['faces', 'mof5-faces', 'faces-pore'].includes(controls.hullMode) ? 'faces' : null;
    if (hull) args.push('--hull', hull);
    if (['pore', 'mof5-pore', 'faces-pore'].includes(controls.hullMode)) args.push('--pore');
    if (controls.displayHydrogens === 'all') args.push('--hy');
    if (controls.displayHydrogens === 'none') args.push('--no-hy');
    if (['aromatic', 'kekule'].includes(controls.bondNotation)) args.push('--bo', ...(controls.bondNotation === 'kekule' ? ['-k'] : []));
    if (controls.molColor) { if (!/^(#[0-9a-f]{3,8}|[a-z]+)$/iu.test(controls.molColor)) throw new Error('Invalid molecular color.'); args.push('--mol-color', controls.molColor); }
    if (controls.supercell) {
      if (!Array.isArray(controls.supercell) || controls.supercell.length !== 3 || controls.supercell.some(n => !Number.isInteger(n) || n < 1 || n > 4)) throw new Error('Native XYZRender supercell is limited to 4 per axis.');
      args.push('--supercell', ...controls.supercell.map(String));
    }
    if (controls.fieldMode && controls.fieldMode !== 'auto') throw new Error('Volumetric-field rendering is not supported in the native workspace.');
    if (controls.regions?.length > 16) throw new Error('Too many XYZRender regions.');
    for (const region of controls.regions || []) { if (!presets.includes(region.preset)) throw new Error('Unknown region preset.'); args.push('--region', selector(region.atoms), region.preset); }
    let refPath;
    if (input.orientationRef) {
      if (typeof input.orientationRef !== 'string' || Buffer.byteLength(input.orientationRef) > 65536) throw new Error('Orientation reference exceeds 64 KiB.');
      refPath = join(directory, 'orientation.xyz');
      await writeFile(refPath, input.orientationRef);
    }
    const run = ref => execute(executable, [...args, ...(ref ? ['--ref', ref] : [])], { timeout: 25000, maxBuffer: 65536 });
    let result;
    try { result = await run(refPath); }
    catch (error) {
      if (!refPath || !`${error.stderr}${error.stdout}${error.message}`.includes('--ref is not supported for periodic structures')) throw error;
      result = await run(null);
    }
    if ((await stat(outputPath)).size > maxBytes) throw new Error('XYZRender SVG exceeds the native 512 KiB limit.');
    const svg = await readFile(outputPath, 'utf8');
    if (!svg.includes('<svg')) throw new Error('XYZRender produced no SVG.');
    return { svg, preset, configArgument: preset, elapsedMs: Date.now() - startedAt, log: `${result.stdout || ''}${result.stderr || ''}`.slice(0, 4096), activeModel: input.activeModel, xyzrenderControls: controls };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
