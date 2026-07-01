#!/usr/bin/env node
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');
const webRoot = process.env.BURRETE_AGENT_PREVIEW_WEB_ROOT
  ? resolve(process.env.BURRETE_AGENT_PREVIEW_WEB_ROOT)
  : defaultPreviewWebRoot();
const agentControlApiVersion = 'burette-agent-control/v1';
const renderPanelReadLimit = 512 * 1024;
const mvsReadLimit = 25 * 1024 * 1024;
const amberNcPreviewFrameLimit = 100;
const coordinateArtifactExtensions = new Set(['xml', 'inpcrd', 'rst7', 'restrt', 'crd', 'rst', 'state', 'lammpstrj', 'dump', 'pos', 'cfg', 'in', 'inp', 'log', 'out', 'data', 'lammps', 'lmp']);
const textArtifactExtensions = new Set(['par', 'prm', 'rtf', 'str', 'key', 'chk', 'checkpoint']);
const amberNetcdfExtensions = new Set(['nc', 'ncdf', 'netcdf', 'ncrst']);
const topologyPreviewExtensions = new Set(['pdb', 'ent', 'pdbqt', 'pqr', 'xpdb']);

function defaultPreviewWebRoot() {
  const sourcePreviewWeb = sourcePreviewWebRoot();
  if (sourcePreviewWeb) return sourcePreviewWeb;
  const pluginPreviewWeb = resolve(repoRoot, 'preview-web');
  return existsSync(join(pluginPreviewWeb, 'index.html'))
    ? pluginPreviewWeb
    : resolve(repoRoot, 'PreviewExtension', 'Web');
}

function sourcePreviewWebRoot() {
  const candidates = [
    resolve(repoRoot, 'PreviewExtension', 'Web'),
    resolve(repoRoot, '..', '..', 'PreviewExtension', 'Web'),
  ];
  return candidates.find(candidate =>
    existsSync(join(candidate, 'index.html')) && existsSync(join(candidate, 'viewer.js'))
  ) || null;
}

function usage() {
  console.error(`Usage: node scripts/agent-preview.mjs <structure-file> [--port 5177] [--host 127.0.0.1] [--token <token>]

Starts a tiny localhost-only Burrete agent viewer for browser-use/manual QA.
It serves PreviewExtension/Web assets and generates preview-config.js/preview-data.js in-memory.`);
}

function parseArgs(argv) {
  const args = { host: '127.0.0.1', port: 5177, token: null, structure: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    if (arg === '--port') { args.port = Number(argv[++i]); continue; }
    if (arg === '--host') { args.host = String(argv[++i] || '127.0.0.1'); continue; }
    if (arg === '--token') { args.token = String(argv[++i] || '').trim(); continue; }
    if (!args.structure) args.structure = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return args;
}

function inferFormat(file) {
  const ext = extname(file).toLowerCase().replace(/^\./, '');
  if (ext === 'cif' || ext === 'mmcif' || ext === 'mcif' || ext === 'bcif') return 'mmcif';
  if (ext === 'pdb' || ext === 'pdbqt') return 'pdb';
  if (ext === 'sdf' || ext === 'sd') return 'sdf';
  if (ext === 'mol') return 'mol';
  if (ext === 'mol2') return 'mol2';
  if (ext === 'xyz') return 'xyz';
  if (ext === 'gro') return 'gro';
  return 'auto';
}

function isMaestroPreviewFile(file) {
  const ext = extname(file).toLowerCase().replace(/^\./, '');
  return ext === 'cms' || ext === 'mae';
}

function isAmberNetcdfFile(file) {
  return amberNetcdfExtensions.has(extname(file).toLowerCase().replace(/^\./, ''));
}

function preparePreviewPayload(file, bytes) {
  const extension = previewExtension(file);
  if (isPreferredTextArtifact(file)) {
    return { bytes, format: 'text', binary: looksBinary(bytes), textPreview: true };
  }
  if (coordinateArtifactExtensions.has(extension)) {
    const converted = genericPdbDataFromText(bytes.toString('utf8'), extension, basename(file));
    if (converted) return { bytes: Buffer.from(converted, 'utf8'), format: 'pdb', binary: false };
  }
  if (textArtifactExtensions.has(extension)) {
    return { bytes, format: 'text', binary: looksBinary(bytes), textPreview: true };
  }
  if (!isMaestroPreviewFile(file)) return { bytes, format: inferFormat(file), binary: isBinaryFormat(file) };
  const converted = maestroPdbDataFromText(bytes.toString('utf8'));
  if (!converted) return { bytes, format: inferFormat(file), binary: isBinaryFormat(file) };
  return { bytes: Buffer.from(converted, 'utf8'), format: 'pdb', binary: false };
}

function previewExtension(file) {
  const explicit = extname(file).toLowerCase().replace(/^\./, '');
  if (explicit) return explicit;
  return /^in(?:_|$)/iu.test(basename(file)) ? 'in' : '';
}

function isPreferredTextArtifact(file) {
  return basename(file).toLowerCase() === 'log.lammps';
}

async function amberNcPreviewPayload(file) {
  if (!isAmberNetcdfFile(file)) return null;
  const topology = await findAmberNcTopology(file);
  if (!topology) {
    throw new Error(`${file}: Amber NetCDF trajectory requires a matching PDB topology/reference file in the same folder.`);
  }
  const tempDir = await mkdtemp(resolve(tmpdir(), 'burrete-amber-nc-preview-'));
  const outputPath = resolve(tempDir, 'amber-nc-preview.pdb');
  try {
    const frameCount = runAmberNcExtractor(topology, file, outputPath);
    const bytes = await readFile(outputPath);
    return {
      bytes,
      format: 'pdb',
      binary: false,
      topologyPath: topology,
      trajectoryPath: file,
      trajectoryFrameCount: frameCount || countPdbModels(bytes.toString('utf8')),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function findAmberNcTopology(trajectoryPath) {
  const folder = dirname(trajectoryPath);
  const stem = basename(trajectoryPath).replace(/\.[^.]+$/u, '');
  const preferred = [
    'reference.pdb',
    `${stem}.pdb`,
    'topology.pdb',
    'structure.pdb',
    'system.pdb',
    'top.pdb',
  ].map((name) => resolve(folder, name));
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const discovered = entries
    .filter((entry) => entry.isFile() && topologyPreviewExtensions.has(extname(entry.name).toLowerCase().replace(/^\./, '')))
    .map((entry) => resolve(folder, entry.name))
    .sort((left, right) => left.localeCompare(right));
  const candidates = Array.from(new Set([...preferred, ...discovered]));
  const errors = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const tempDir = await mkdtemp(resolve(tmpdir(), 'burrete-amber-nc-probe-'));
    const outputPath = resolve(tempDir, 'probe.pdb');
    try {
      runAmberNcExtractor(candidate, trajectoryPath, outputPath);
      return candidate;
    } catch (error) {
      errors.push(`${basename(candidate)}: ${error?.message || String(error)}`);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  if (errors.length) {
    throw new Error(`${trajectoryPath}: no matching PDB topology found. ${errors.join('; ')}`);
  }
  return null;
}

function runAmberNcExtractor(topologyPath, trajectoryPath, outputPath) {
  const extractor = resolve(__dirname, 'amber_nc_preview_extract.py');
  if (!existsSync(extractor)) throw new Error(`Missing Amber NetCDF extractor: ${extractor}`);
  const result = spawnSync('python3', [
    extractor,
    topologyPath,
    trajectoryPath,
    '--frames',
    String(amberNcPreviewFrameLimit),
    '--output',
    outputPath,
  ], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim();
    throw new Error(details || `extractor exited with status ${result.status}`);
  }
  const match = String(result.stdout || '').match(/frames=(\d+)/u);
  return match ? Number(match[1]) : 0;
}

function countPdbModels(text) {
  return text.match(/^MODEL\b/gmu)?.length ?? 0;
}

function genericPdbDataFromText(text, extension, label) {
  const atoms = atomsFromCoordinateText(text, extension);
  if (!atoms?.length) return null;
  return [
    `REMARK Converted from ${label}`,
    ...atoms.slice(0, 99999).map((atom, index) => genericPdbAtomLine(index + 1, atom)),
    ...pdbConectLines(atoms),
    'END',
    ''
  ].join('\n');
}

function atomsFromCoordinateText(text, extension) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (extension === 'inpcrd' || extension === 'rst7' || extension === 'restrt') return parseAmberRestartAtoms(lines);
  if (extension === 'in' || extension === 'inp') return parseQuantumEspressoAtoms(lines) ?? parseBestCoordinateBlock(lines);
  if (extension === 'log' || extension === 'out') return parseBestCoordinateBlock(lines);
  if (extension === 'lammpstrj' || extension === 'dump' || extension === 'pos') return parseLammpsDumpAtoms(lines);
  if (extension === 'cfg') return parseAtomeyeCfgAtoms(lines) ?? parseMlipCfgAtoms(lines);
  if (extension === 'data' || extension === 'lammps' || extension === 'lmp') return parseLammpsDataAtoms(lines);
  if (extension === 'crd') return parseCharmmCoordinateAtoms(lines);
  if (extension === 'rst') return parseCharmmCoordinateAtoms(lines) ?? parseAmberRestartAtoms(lines);
  if (extension === 'state' || extension === 'xml') return parseXmlPositionAtoms(text) ?? parseHoomdXmlAtoms(text);
  return null;
}

function parseQuantumEspressoAtoms(lines) {
  const start = lines.findIndex((line) => line.trim().toLowerCase().startsWith('atomic_positions')) + 1;
  if (start <= 0) return null;
  const atoms = [];
  for (const line of lines.slice(start)) {
    const parts = fields(line);
    if (parts.length < 4) break;
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const z = Number(parts[3]);
    if (!isElementSymbol(parts[0]) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) break;
    atoms.push({ symbol: normalizeElementSymbol(parts[0]), x, y, z });
  }
  return atoms.length ? atoms : null;
}

function parseBestCoordinateBlock(lines) {
  let best = [];
  let current = [];
  const finishBlock = () => {
    if (current.length > best.length) best = current;
    current = [];
  };
  for (const line of lines) {
    const atom = parseElementCoordinateLine(line);
    if (atom) current.push(atom);
    else finishBlock();
  }
  finishBlock();
  return best.length >= 2 ? best : null;
}

function parseAmberRestartAtoms(lines) {
  if (lines.length < 2) return null;
  const atomCount = Number.parseInt(fields(lines[1])[0] || '', 10);
  if (!Number.isFinite(atomCount) || atomCount <= 0) return null;
  const values = [];
  for (const line of lines.slice(2)) {
    for (const token of fields(line)) {
      const value = Number(token);
      if (Number.isFinite(value)) values.push(value);
      if (values.length >= atomCount * 3) break;
    }
    if (values.length >= atomCount * 3) break;
  }
  if (values.length < atomCount * 3) return null;
  return Array.from({ length: atomCount }, (_, index) => ({
    symbol: 'C',
    x: values[index * 3],
    y: values[index * 3 + 1],
    z: values[index * 3 + 2]
  }));
}

function parseCharmmCoordinateAtoms(lines) {
  const atoms = [];
  for (const line of lines) {
    const parts = fields(line);
    if (parts.length < 7) continue;
    const x = Number(parts[4]);
    const y = Number(parts[5]);
    const z = Number(parts[6]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    atoms.push({
      symbol: elementSymbolFromAtomName(parts[3]) ?? elementSymbolFromAtomName(parts[2]) ?? 'C',
      x,
      y,
      z
    });
  }
  return atoms.length ? atoms : null;
}

function parseLammpsDumpAtoms(lines) {
  const atoms = [];
  let inAtoms = false;
  let columns = [];
  let xIndex = -1;
  let yIndex = -1;
  let zIndex = -1;
  let symbolIndex = -1;
  let typeIndex = -1;
  for (const line of lines) {
    if (line.startsWith('ITEM: ')) {
      if (inAtoms && atoms.length > 0) break;
      inAtoms = false;
      if (line.startsWith('ITEM: ATOMS')) {
        columns = line.slice('ITEM: ATOMS'.length).trim().split(/\s+/u).filter(Boolean);
        xIndex = coordinateColumnIndex(columns, ['x', 'xu', 'xs', 'xsu']);
        yIndex = coordinateColumnIndex(columns, ['y', 'yu', 'ys', 'ysu']);
        zIndex = coordinateColumnIndex(columns, ['z', 'zu', 'zs', 'zsu']);
        symbolIndex = coordinateColumnIndex(columns, ['element', 'symbol', 'name']);
        typeIndex = coordinateColumnIndex(columns, ['type']);
        inAtoms = xIndex >= 0 && yIndex >= 0 && zIndex >= 0;
      }
      continue;
    }
    if (!inAtoms) continue;
    const parts = fields(line);
    const x = Number.parseFloat(parts[xIndex] ?? '');
    const y = Number.parseFloat(parts[yIndex] ?? '');
    const z = Number.parseFloat(parts[zIndex] ?? '');
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const symbol = elementSymbolFromAtomName(parts[symbolIndex] ?? '')
      ?? elementSymbolFromAtomName(parts[typeIndex] ?? '')
      ?? 'C';
    atoms.push({ symbol, x, y, z });
  }
  return atoms.length > 0 ? atoms : null;
}

function parseAtomeyeCfgAtoms(lines) {
  const atomCount = parseAtomeyeCfgAtomCount(lines);
  const scale = parseAtomeyeCfgScale(lines) ?? 1;
  const h0 = parseAtomeyeCfgH0(lines);
  const entryCount = parseAtomeyeCfgEntryCount(lines);
  const entryStart = lines.findIndex((line) => line.trim().startsWith('entry_count')) + 1;
  if (!atomCount || !h0 || !entryCount || entryStart <= 0) return null;
  const atoms = [];
  for (let index = entryStart; atoms.length < atomCount && index + entryCount <= lines.length; index += entryCount) {
    const entry = lines.slice(index, index + entryCount);
    const symbol = entry.map((line) => elementSymbolFromAtomName(line)).find(Boolean) ?? 'C';
    const fractional = entry
      .slice()
      .reverse()
      .map((line) => numericTokens(line))
      .find((values) => values.length >= 3);
    if (!fractional) return null;
    atoms.push({
      symbol,
      x: scale * (h0[0][0] * fractional[0] + h0[0][1] * fractional[1] + h0[0][2] * fractional[2]),
      y: scale * (h0[1][0] * fractional[0] + h0[1][1] * fractional[1] + h0[1][2] * fractional[2]),
      z: scale * (h0[2][0] * fractional[0] + h0[2][1] * fractional[1] + h0[2][2] * fractional[2])
    });
  }
  return atoms.length === atomCount ? atoms : null;
}

function parseMlipCfgAtoms(lines) {
  const begin = lines.findIndex((line) => line.trim().toLowerCase() === 'begin_cfg');
  if (begin < 0) return null;
  const relativeEnd = lines.slice(begin + 1).findIndex((line) => line.trim().toLowerCase() === 'end_cfg');
  const end = relativeEnd >= 0 ? begin + 1 + relativeEnd : lines.length;
  const block = lines.slice(begin + 1, end);
  const atomCount = parseMlipCfgSize(block);
  const atomDataIndex = block.findIndex((line) => line.trimStart().startsWith('AtomData:'));
  if (!atomCount || atomDataIndex < 0) return null;
  const header = fields(block[atomDataIndex]);
  const column = (name) => {
    const index = header.findIndex((value) => value.toLowerCase() === name.toLowerCase());
    return index > 0 ? index - 1 : -1;
  };
  const typeIndex = column('type');
  const xIndex = column('cartes_x');
  const yIndex = column('cartes_y');
  const zIndex = column('cartes_z');
  if (xIndex < 0 || yIndex < 0 || zIndex < 0) return null;
  const atoms = [];
  for (const line of block.slice(atomDataIndex + 1)) {
    const parts = fields(line);
    if (parts.length <= Math.max(xIndex, yIndex, zIndex)) {
      if (atoms.length) break;
      continue;
    }
    const x = Number(parts[xIndex]);
    const y = Number(parts[yIndex]);
    const z = Number(parts[zIndex]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      if (atoms.length) break;
      continue;
    }
    atoms.push({
      symbol: typeIndex >= 0 ? mlipCfgSymbolForType(parts[typeIndex] ?? '') : 'C',
      x,
      y,
      z
    });
    if (atoms.length === atomCount) break;
  }
  return atoms.length === atomCount ? atoms : null;
}

function parseLammpsDataAtoms(lines) {
  const masses = parseLammpsMasses(lines);
  let inAtoms = false;
  const atoms = [];
  for (const line of lines) {
    const parts = fields(stripInlineComment(line));
    const first = parts[0];
    if (!first) continue;
    if (first.toLowerCase() === 'atoms') {
      inAtoms = true;
      continue;
    }
    if (inAtoms && /^[A-Za-z]/u.test(first)) break;
    if (!inAtoms || parts.length < 5) continue;
    const coordinates = lammpsDataCoordinates(parts, masses);
    if (!coordinates) continue;
    atoms.push({
      symbol: lammpsDataAtomSymbol(parts, masses),
      x: coordinates[0],
      y: coordinates[1],
      z: coordinates[2]
    });
  }
  return atoms.length ? atoms : null;
}

function parseLammpsMasses(lines) {
  let inMasses = false;
  const masses = new Map();
  for (const line of lines) {
    const parts = fields(stripInlineComment(line));
    const first = parts[0];
    if (!first) continue;
    if (first.toLowerCase() === 'masses') {
      inMasses = true;
      continue;
    }
    if (inMasses && /^[A-Za-z]/u.test(first)) break;
    if (!inMasses || parts.length < 2) continue;
    const symbol = elementSymbolFromAtomName(parts[2] ?? '') ?? lammpsSymbolFromMass(parts[1] ?? '');
    if (symbol) masses.set(parts[0], symbol);
  }
  return masses;
}

function lammpsDataCoordinates(parts, masses) {
  const starts = [];
  if (masses.has(parts[2])) starts.push(4);
  if (masses.has(parts[1])) starts.push(3, 2);
  starts.push(3, 4, 2);
  for (const start of starts) {
    const x = Number(parts[start]);
    const y = Number(parts[start + 1]);
    const z = Number(parts[start + 2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
  }
  return null;
}

function lammpsDataAtomSymbol(parts, masses) {
  return masses.get(parts[1])
    ?? masses.get(parts[2])
    ?? elementSymbolFromAtomName(parts[1] ?? '')
    ?? elementSymbolFromAtomName(parts[2] ?? '')
    ?? 'C';
}

function lammpsSymbolFromMass(value) {
  const mass = Number(value);
  if (!Number.isFinite(mass)) return null;
  const candidates = [
    [1.008, 'H'], [12.011, 'C'], [14.007, 'N'], [15.999, 'O'], [18.998, 'F'],
    [22.99, 'Na'], [24.305, 'Mg'], [30.974, 'P'], [32.06, 'S'], [35.45, 'Cl']
  ];
  const match = candidates.find(([candidate]) => Math.abs(candidate - mass) < 0.15);
  return match?.[1] ?? null;
}

function stripInlineComment(line) {
  return line.split('#')[0] ?? '';
}

function parseMlipCfgSize(lines) {
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (lines[index].trim().toLowerCase() !== 'size') continue;
    const value = Number.parseInt(fields(lines[index + 1])[0] ?? '', 10);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function mlipCfgSymbolForType(value) {
  const normalized = normalizeElementSymbol(value);
  if (isElementSymbol(normalized)) return normalized;
  if (value.trim() === '1') return 'H';
  return 'C';
}

function parseAtomeyeCfgAtomCount(lines) {
  for (const line of lines) {
    const match = /^Number of particles\s*=\s*(\d+)/u.exec(line.trim());
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

function parseAtomeyeCfgScale(lines) {
  for (const line of lines) {
    const match = /^A\s*=\s*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/u.exec(line.trim());
    if (match) return Number(match[1]);
  }
  return null;
}

function parseAtomeyeCfgEntryCount(lines) {
  for (const line of lines) {
    const match = /^entry_count\s*=\s*(\d+)/u.exec(line.trim());
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

function parseAtomeyeCfgH0(lines) {
  const h0 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let seen = 0;
  for (const line of lines) {
    const match = /^H0\((\d),(\d)\)\s*=\s*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/u.exec(line.trim());
    if (!match) continue;
    const row = Number.parseInt(match[1], 10) - 1;
    const column = Number.parseInt(match[2], 10) - 1;
    if (row < 0 || row >= 3 || column < 0 || column >= 3) continue;
    h0[row][column] = Number(match[3]);
    seen += 1;
  }
  return seen === 9 ? h0 : null;
}

function coordinateColumnIndex(columns, names) {
  return columns.findIndex((column) => names.includes(column.toLowerCase()));
}

function parseXmlPositionAtoms(text) {
  const atoms = [];
  const matcher = /<Position\b([^>]*)\/?>/giu;
  let match;
  while ((match = matcher.exec(text))) {
    const attributes = match[1] ?? '';
    const x = xmlNumberAttribute(attributes, 'x');
    const y = xmlNumberAttribute(attributes, 'y');
    const z = xmlNumberAttribute(attributes, 'z');
    if (x === null || y === null || z === null) continue;
    atoms.push({ symbol: 'C', x, y, z });
  }
  return atoms.length ? atoms : null;
}

function parseHoomdXmlAtoms(text) {
  if (!/<hoomd_xml\b/iu.test(text) && !/<configuration\b/iu.test(text)) return null;
  const positionMatch = /<position\b[^>]*>([\s\S]*?)<\/position>/iu.exec(text);
  if (!positionMatch) return null;
  const values = numericTokens(positionMatch[1] ?? '');
  if (values.length < 3) return null;
  const typeMatch = /<type\b[^>]*>([\s\S]*?)<\/type>/iu.exec(text);
  const symbols = typeMatch
    ? fields(typeMatch[1] ?? '').map((value) => elementSymbolFromAtomName(value) ?? 'C')
    : [];
  const atoms = [];
  for (let index = 0; index + 2 < values.length; index += 3) {
    const atomIndex = index / 3;
    atoms.push({
      symbol: symbols[atomIndex] || 'C',
      x: values[index],
      y: values[index + 1],
      z: values[index + 2]
    });
  }
  return atoms.length ? atoms : null;
}

function numericTokens(text) {
  return Array.from(text.matchAll(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/gu), (match) => Number(match[0]))
    .filter((value) => Number.isFinite(value));
}

function xmlNumberAttribute(attributes, name) {
  const match = new RegExp(`\\b${name}=["']([^"']+)["']`, 'iu').exec(attributes);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function genericPdbAtomLine(serial, atom) {
  const symbol = normalizeElementSymbol(atom.symbol);
  const atomName = formatPdbAtomName(symbol, symbol);
  return [
    'HETATM',
    String(Math.min(serial, 99999)).padStart(5, ' '),
    ' ',
    atomName.padEnd(4, ' ').slice(0, 4),
    ' ',
    'MOL',
    ' ',
    'A',
    String(1).padStart(4, ' '),
    '    ',
    atom.x.toFixed(3).padStart(8, ' '),
    atom.y.toFixed(3).padStart(8, ' '),
    atom.z.toFixed(3).padStart(8, ' '),
    '  1.00 10.00          ',
    truncateAscii(symbol, 2).padStart(2, ' ')
  ].join('');
}

function elementSymbolFromAtomName(value) {
  const clean = String(value || '').replace(/^[0-9]+/u, '').replace(/[^A-Za-z]/gu, '');
  if (!clean) return null;
  const two = normalizeElementSymbol(clean.slice(0, 2));
  if (isElementSymbol(two)) return two;
  const one = normalizeElementSymbol(clean.slice(0, 1));
  return isElementSymbol(one) ? one : null;
}

function parseElementCoordinateLine(line) {
  const parts = fields(line);
  if (parts.length < 4) return null;
  const symbol = elementSymbolFromAtomName(parts[0]);
  if (!symbol) return null;
  const x = Number(parts[1]);
  const y = Number(parts[2]);
  const z = Number(parts[3]);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? { symbol, x, y, z }
    : null;
}

function maestroPdbDataFromText(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const models = parseMaestroPdbModels(lines, 99999);
  if (!models?.length) return null;
  if (models.length === 1) {
    return [
      ...models[0].map((atom, index) => maestroPdbAtomLine(index + 1, atom)),
      ...pdbConectLines(models[0]),
      'END',
      ''
    ].join('\n');
  }
  return maestroModelsToPdb(models);
}

function parseMaestroPdbModels(lines, atomLimit) {
  let currentCtType = '';
  let bestScore = -1;
  const bestModels = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed === 'f_m_ct {') {
      const result = parseMaestroCtType(lines, index + 1);
      currentCtType = result.ctType;
      index = result.nextIndex - 1;
      continue;
    }
    if (!trimmed.startsWith('m_atom[') || !trimmed.endsWith('{')) continue;

    const headers = [];
    let hasImplicitAtomIndex = false;
    index += 1;
    while (index < lines.length) {
      const headerLine = lines[index].trim();
      index += 1;
      if (headerLine === ':::') break;
      if (headerLine.startsWith('#')) {
        hasImplicitAtomIndex ||= headerLine.toLowerCase().includes('first column is atom index');
        continue;
      }
      if (headerLine === '}') {
        headers.length = 0;
        break;
      }
      headers.push(...fields(headerLine));
    }
    if (!headers.length) continue;

    const xIndex = maestroHeaderIndex(headers, 'r_m_x_coord');
    const yIndex = maestroHeaderIndex(headers, 'r_m_y_coord');
    const zIndex = maestroHeaderIndex(headers, 'r_m_z_coord');
    if (xIndex < 0 || yIndex < 0 || zIndex < 0) continue;
    const atomicNumberIndex = maestroHeaderIndex(headers, 'i_m_atomic_number');
    const elementIndex = firstPresentHeaderIndex(headers, ['s_m_element', 's_m_pdb_element']);
    const atomNameIndex = firstPresentHeaderIndex(headers, ['s_m_atom_name', 's_m_pdb_atom_name']);
    const pdbAtomNameIndex = firstPresentHeaderIndex(headers, ['s_m_pdb_atom_name', 's_m_atom_name']);
    const residueNameIndex = firstPresentHeaderIndex(headers, ['s_m_pdb_residue_name', 's_m_mmod_res']);
    const residueNumberIndex = maestroHeaderIndex(headers, 'i_m_residue_number');
    const chainNameIndex = maestroHeaderIndex(headers, 's_m_chain_name');

    const atoms = [];
    while (index < lines.length) {
      const rowLine = lines[index].trim();
      index += 1;
      if (rowLine === ':::' || rowLine === '}') break;
      if (!rowLine) continue;
      const row = cifTokens(rowLine);
      const rowOffset = hasImplicitAtomIndex ? 1 : 0;
      const x = Number(row[xIndex + rowOffset]);
      const y = Number(row[yIndex + rowOffset]);
      const z = Number(row[zIndex + rowOffset]);
      const symbol = maestroAtomSymbol(row, rowOffset, atomicNumberIndex, elementIndex, atomNameIndex);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !symbol) continue;
      const atomName = normalizePdbAtomName((pdbAtomNameIndex >= 0 ? row[pdbAtomNameIndex + rowOffset] : symbol) || symbol);
      const residueName = normalizePdbResidueName((residueNameIndex >= 0 ? row[residueNameIndex + rowOffset] : 'MOL') || 'MOL') || 'MOL';
      const residueNumber = Number.parseInt((residueNumberIndex >= 0 ? row[residueNumberIndex + rowOffset] : '1') || '1', 10);
      const chainName = normalizePdbChainName((chainNameIndex >= 0 ? row[chainNameIndex + rowOffset] : 'A') || 'A');
      atoms.push({
        symbol,
        atomName: atomName || symbol,
        residueName,
        residueNumber: Number.isFinite(residueNumber) ? residueNumber : 1,
        chainName,
        x,
        y,
        z
      });
      if (atoms.length >= atomLimit) break;
    }
    if (atoms.length) {
      const score = maestroCtScore(currentCtType);
      if (score > bestScore) {
        bestScore = score;
        bestModels.length = 0;
        bestModels.push(atoms);
      } else if (score === bestScore) {
        bestModels.push(atoms);
      }
    }
  }
  return bestModels.length ? bestModels : null;
}

function parseMaestroCtType(lines, startIndex) {
  let index = startIndex;
  const headers = [];
  while (index < lines.length) {
    const line = lines[index].trim();
    index += 1;
    if (line === ':::') break;
    if (line.startsWith('m_atom[') || line === '}') return { ctType: '', nextIndex: index - 1 };
    headers.push(...fields(line));
  }
  const ctTypeIndex = maestroHeaderIndex(headers, 's_ffio_ct_type');
  const values = [];
  while (index < lines.length) {
    const line = lines[index].trim();
    if (line.startsWith('m_atom[') || line === '}') break;
    values.push(...cifTokens(line));
    index += 1;
  }
  return { ctType: (values[ctTypeIndex] || '').trim().toLowerCase(), nextIndex: index };
}

function maestroCtScore(ctType) {
  if (ctType === 'solute') return 4;
  if (ctType === 'full_system') return 3;
  if (ctType === 'ion') return 1;
  if (ctType === 'solvent') return 0;
  return 2;
}

function maestroModelsToPdb(models) {
  const lines = [];
  models.forEach((atoms, modelIndex) => {
    lines.push(`MODEL${String(modelIndex + 1).padStart(9, ' ')}`);
    atoms.forEach((atom, atomIndex) => {
      lines.push(maestroPdbAtomLine(atomIndex + 1, atom));
    });
    lines.push(...pdbConectLines(atoms));
    lines.push('ENDMDL');
  });
  lines.push('END', '');
  return lines.join('\n');
}

function maestroPdbAtomLine(serial, atom) {
  const residueName = truncateAscii(atom.residueName, 3) || 'MOL';
  const atomName = formatPdbAtomName(atom.atomName, atom.symbol);
  const chainName = truncateAscii(atom.chainName, 1) || 'A';
  const record = isStandardPolymerResidue(residueName) ? 'ATOM' : 'HETATM';
  return [
    record.padEnd(6, ' '),
    String(Math.min(serial, 99999)).padStart(5, ' '),
    ' ',
    atomName.padEnd(4, ' ').slice(0, 4),
    ' ',
    residueName.padStart(3, ' '),
    ' ',
    chainName,
    String(clamp(atom.residueNumber, -999, 9999)).padStart(4, ' '),
    '    ',
    atom.x.toFixed(3).padStart(8, ' '),
    atom.y.toFixed(3).padStart(8, ' '),
    atom.z.toFixed(3).padStart(8, ' '),
    '  1.00 10.00          ',
    truncateAscii(atom.symbol, 2).padStart(2, ' ')
  ].join('');
}

function pdbConectLines(atoms) {
  const bonds = inferPdbBonds(atoms);
  if (!bonds.length) return [];
  const adjacency = Array.from({ length: Math.min(atoms.length, 99999) }, () => []);
  for (const [left, right] of bonds) {
    adjacency[left].push(right + 1);
    adjacency[right].push(left + 1);
  }
  const lines = [];
  adjacency.forEach((neighbors, index) => {
    for (let offset = 0; offset < neighbors.length; offset += 4) {
      lines.push(`CONECT${String(index + 1).padStart(5, ' ')}${neighbors.slice(offset, offset + 4).map(serial => String(serial).padStart(5, ' ')).join('')}`);
    }
  });
  return lines;
}

function inferPdbBonds(atoms) {
  const cappedAtoms = atoms.slice(0, 99999);
  if (cappedAtoms.length > 2000) return [];
  const bonds = [];
  for (let left = 0; left < cappedAtoms.length; left += 1) {
    const leftRadius = covalentRadius(cappedAtoms[left].symbol);
    if (!leftRadius) continue;
    for (let right = left + 1; right < cappedAtoms.length; right += 1) {
      const rightRadius = covalentRadius(cappedAtoms[right].symbol);
      if (!rightRadius) continue;
      const dx = cappedAtoms[left].x - cappedAtoms[right].x;
      const dy = cappedAtoms[left].y - cappedAtoms[right].y;
      const dz = cappedAtoms[left].z - cappedAtoms[right].z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const maxDistance = Math.min(leftRadius + rightRadius + 0.45, 2.25);
      if (distance >= 0.35 && distance <= maxDistance) bonds.push([left, right]);
    }
  }
  return bonds;
}

function covalentRadius(symbol) {
  const radii = {
    H: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Ne: 0.58,
    Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06, K: 2.03, Ca: 1.76,
    Fe: 1.24, Co: 1.18, Ni: 1.17, Cu: 1.22, Zn: 1.22, Br: 1.20, I: 1.39
  };
  return radii[normalizeElementSymbol(symbol)] ?? 0;
}

function maestroAtomSymbol(row, rowOffset, atomicNumberIndex, elementIndex, atomNameIndex) {
  if (elementIndex >= 0) {
    const symbol = normalizeElementSymbol(row[elementIndex + rowOffset] || '');
    if (isElementSymbol(symbol)) return symbol;
  }
  if (atomicNumberIndex >= 0) {
    const symbol = symbolForAtomicNumber(Number.parseInt(row[atomicNumberIndex + rowOffset] || '', 10));
    if (isElementSymbol(symbol)) return symbol;
  }
  if (atomNameIndex >= 0) {
    const match = String(row[atomNameIndex + rowOffset] || '').replace(/^[0-9]+/u, '').match(/[A-Za-z]{1,2}/u);
    if (match) {
      const symbol = normalizeElementSymbol(match[0]);
      if (isElementSymbol(symbol)) return symbol;
      const fallback = normalizeElementSymbol(match[0][0]);
      if (isElementSymbol(fallback)) return fallback;
    }
  }
  return null;
}

function cifTokens(line) {
  const tokens = [];
  const matcher = /"([^"]*)"|'([^']*)'|(\S+)/gu;
  let match;
  while ((match = matcher.exec(line))) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
}

function fields(line) {
  return line.trim().split(/\s+/u).filter(Boolean);
}

function formatPdbAtomName(atomName, symbol) {
  return truncateAscii(atomName, 4) || truncateAscii(symbol, 2) || 'X';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function truncateAscii(value, maxLength) {
  return String(value || '').replace(/[^A-Za-z0-9]/gu, '').slice(0, maxLength);
}

function normalizePdbAtomName(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/gu, '').trim();
}

function normalizePdbResidueName(value) {
  return truncateAscii(String(value || '').trim().replace(/^['"]|['"]$/gu, '').trim(), 3).toUpperCase();
}

function normalizePdbChainName(value) {
  return truncateAscii(String(value || '').trim().replace(/^['"]|['"]$/gu, '').trim(), 1) || 'A';
}

function isStandardPolymerResidue(residueName) {
  return new Set([
    'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'CYX', 'GLN', 'GLU', 'GLY', 'HIS', 'HID', 'HIE', 'HIP',
    'ILE', 'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL'
  ]).has(residueName);
}

function maestroHeaderIndex(headers, name) {
  return headers.findIndex(header => header.toLowerCase() === name);
}

function firstPresentHeaderIndex(headers, names) {
  for (const name of names) {
    const index = maestroHeaderIndex(headers, name);
    if (index >= 0) return index;
  }
  return -1;
}

function isElementSymbol(value) {
  return ELEMENT_SYMBOLS.has(normalizeElementSymbol(value));
}

function normalizeElementSymbol(value) {
  return value ? value[0].toUpperCase() + value.slice(1).toLowerCase() : value;
}

function symbolForAtomicNumber(number) {
  return ATOMIC_SYMBOLS[number - 1] || 'X';
}

const ATOMIC_SYMBOLS = [
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
  'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
  'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
  'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
  'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn',
  'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd',
  'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb',
  'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
  'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn'
];

const ELEMENT_SYMBOLS = new Set(ATOMIC_SYMBOLS);

function isBinaryFormat(file) {
  return extname(file).toLowerCase() === '.bcif';
}

function js(name, value) {
  return `window.${name} = ${JSON.stringify(value)};\n`;
}

function controlConfig() {
  return {
    apiVersion: agentControlApiVersion,
    observeUrl: '/__agent/observe',
    reportUrl: '/__agent/report',
    nextActionUrl: '/__agent/next-action',
    actionResultUrl: '/__agent/action-result',
    actionPollIntervalMs: 500
  };
}

function observeState({ host, port, structurePath, config, liveReport, actions }) {
  const liveSummary = liveReport?.summary?.ok ? liveReport.summary.result : null;
  const liveCapabilities = liveReport?.capabilities?.ok ? liveReport.capabilities.result : null;
  const actionItems = Array.from(actions.values());
  const lastAction = actionItems.at(-1) || null;
  const workspacePanels = observedWorkspacePanels(actionItems);
  return {
    apiVersion: agentControlApiVersion,
    mode: 'browser-preview',
    transport: 'http-local-token',
    activeDocument: {
      title: config.label,
      path: structurePath,
      format: config.format,
      binary: config.binary,
      byteCount: config.byteCount,
      viewer: config.textPreview ? 'text' : config.format === 'sdf' ? 'grid-or-molstar' : 'molstar',
      ready: config.textPreview ? true : !!liveSummary
    },
    viewerAgent: {
      apiVersion: 'burette-agent/v1',
      available: !!liveCapabilities,
      commands: liveCapabilities?.commands || [],
      lastReportAt: liveReport?.reportedAt || null,
      note: liveCapabilities
        ? 'Live Mol* state was reported by window.BurreteAgent inside the browser runtime.'
        : 'Live Mol* state is available inside the browser through window.BurreteAgent after the viewer loads.'
    },
    scene: liveSummary
      ? {
          known: true,
          format: liveSummary.format,
          label: liveSummary.label,
          structures: liveSummary.counts?.structures || 0,
          models: liveSummary.counts?.models || 0,
          chains: liveSummary.structures?.flatMap(item => item.chains || []) || [],
          ligands: liveSummary.structures?.flatMap(item => item.ligands || []) || [],
          counts: liveSummary.counts
        }
      : {
          known: false,
          note: 'The preview server only knows the input artifact. Use the browser runtime agent for live Mol* scene state.'
        },
    panels: ['viewer', ...workspacePanels.map(panel => panel.id)],
    workspacePanels,
    endpoints: {
      health: `http://${host}:${port}/healthz`,
      observe: `http://${host}:${port}/__agent/observe`,
      report: `http://${host}:${port}/__agent/report`,
      act: `http://${host}:${port}/__agent/act`
    },
    actions: {
      queued: actionItems.filter(action => action.status === 'queued').length,
      dispatched: actionItems.filter(action => action.status === 'dispatched').length,
      completed: actionItems.filter(action => action.status === 'completed').length,
      failed: actionItems.filter(action => action.status === 'failed').length,
      last: lastAction ? publicAction(lastAction) : null,
      recent: actionItems.slice(-20).map(publicAction)
    },
    errors: []
  };
}

function textPreviewHtml({ title, extension, byteCount, text }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Burrete - ${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    main { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
    header { padding: 14px 18px 10px; border-bottom: 1px solid rgba(127, 127, 127, 0.24); }
    h1 { margin: 0 0 6px; font-size: 15px; font-weight: 600; letter-spacing: 0; }
    .meta { display: flex; gap: 10px; color: #6b7280; font-size: 12px; }
    @media (prefers-color-scheme: dark) { .meta { color: #9ca3af; } }
    pre { margin: 0; padding: 16px 18px 28px; overflow: auto; white-space: pre; font: 12px/1.45 "SF Mono", Menlo, Consolas, monospace; tab-size: 2; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta"><span>.${escapeHtml(extension)}</span><span>${byteCount} bytes</span></div>
    </header>
    <pre>${escapeHtml(text)}</pre>
  </main>
</body>
</html>`;
}

function textPreviewContent(file, bytes, preview) {
  if (preview.binary) {
    return [
      `${basename(file)} is a binary OpenMM checkpoint artifact.`,
      '',
      `Path: ${file}`,
      `Bytes: ${bytes.length}`,
      '',
      'Burrete shows metadata for binary checkpoints instead of rendering opaque bytes as text.'
    ].join('\n');
  }
  return bytes.toString('utf8');
}

function looksBinary(bytes) {
  const limit = Math.min(bytes.length, 8192);
  for (let index = 0; index < limit; index += 1) {
    const byte = bytes[index];
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) return true;
  }
  return false;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function observedWorkspacePanels(actionItems) {
  const panels = [];
  const seen = new Set();
  for (const item of actionItems) {
    if (item.action?.type !== 'render_panel' || item.status === 'failed') continue;
    const panel = item.action.panel || {};
    const kind = String(panel.kind || item.action.kind || '').trim();
    const title = String(panel.title || item.action.title || `${kind} panel`).trim();
    if (!kind || !title) continue;
    const area = item.action.area === 'bottom' ? 'bottom' : 'right';
    const id = `agent-panel:${area}:${kind}:${title}`;
    if (seen.has(id)) continue;
    seen.add(id);
    panels.push({
      id,
      actionId: item.id,
      status: item.status,
      area,
      kind,
      title,
      file: typeof panel.file === 'string' ? panel.file : null,
      byteCount: Number.isFinite(panel.byteCount) ? panel.byteCount : null
    });
  }
  return panels;
}

function publicAction(action) {
  return {
    id: action.id,
    type: action.action?.type || null,
    status: action.status,
    createdAt: action.createdAt,
    dispatchedAt: action.dispatchedAt || null,
    completedAt: action.completedAt || null,
    result: action.result || null
  };
}

function validateAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return 'Action must be a JSON object.';
  }
  const type = String(action.type || '').trim();
  if (!type) return 'Action must include a type.';
  const allowed = new Set([
    'focus_ligand',
    'show_ligands',
    'select_residues',
    'focus_selection',
    'label_selection',
    'contacts',
    'reset_camera',
    'hide_waters',
    'show_waters',
    'show_surface',
    'color_by_chain',
    'open_files',
    'set_structure_pose',
    'set_molstar_style',
    'set_sdf_context_style',
    'set_sdf_context_opacity',
    'set_sdf_context_color',
    'set_sdf_pose_mode',
    'set_sdf_pose_index',
    'render_panel',
    'apply_scene',
    'load_mvs',
    'screenshot',
    'export_image',
    'raw_burrete_agent'
  ]);
  if (!allowed.has(type)) return `Unsupported action type: ${type}.`;
  if (type === 'render_panel') {
    const kind = String(action.kind || '').trim();
    if (!['markdown', 'table', 'chart'].includes(kind)) return 'render_panel kind must be markdown, table, or chart.';
    if (typeof action.content !== 'string' && typeof action.file !== 'string') return 'render_panel requires file or content.';
  }
  if (type === 'open_files') {
    if (!Array.isArray(action.paths) || action.paths.length === 0) return 'open_files requires a non-empty paths array.';
    if (!action.paths.every(item => typeof item === 'string' && item.trim())) return 'open_files paths must be non-empty strings.';
  }
  if (type === 'load_mvs') {
    if (
      typeof action.file !== 'string' &&
      typeof action.data !== 'string' &&
      typeof action.dataBase64 !== 'string' &&
      action.json === undefined
    ) {
      return 'load_mvs requires file, data, dataBase64, or json.';
    }
  }
  if (type === 'apply_scene') {
    const components = Array.isArray(action.components) ? action.components : null;
    const operations = Array.isArray(action.operations) ? action.operations : null;
    if (!components && !operations) return 'apply_scene requires components or operations.';
    if (components && components.length === 0) return 'apply_scene components must not be empty.';
    if (operations && operations.length === 0) return 'apply_scene operations must not be empty.';
  }
  return null;
}

async function prepareAction(action) {
  if (action?.type === 'load_mvs') return prepareMvsAction(action);
  if (action?.type !== 'render_panel') return action;
  if (typeof action.content === 'string') {
    return {
      ...action,
      panel: {
        kind: action.kind,
        title: action.title || `${action.kind} panel`,
        content: action.content,
        byteCount: Buffer.byteLength(action.content, 'utf8')
      }
    };
  }
  const file = resolve(String(action.file));
  const info = await stat(file);
  if (!info.isFile()) throw new Error(`${file} is not a file.`);
  if (info.size > renderPanelReadLimit) {
    throw new Error(`render_panel file exceeds ${renderPanelReadLimit} bytes.`);
  }
  const content = await readFile(file, 'utf8');
  return {
    ...action,
    file,
    panel: {
      kind: action.kind,
      title: action.title || basename(file),
      file,
      content,
      byteCount: info.size
    }
  };
}

async function prepareMvsAction(action) {
  if (typeof action.file !== 'string') return action;
  const file = resolve(String(action.file));
  const info = await stat(file);
  if (!info.isFile()) throw new Error(`${file} is not a file.`);
  if (info.size > mvsReadLimit) {
    throw new Error(`load_mvs file exceeds ${mvsReadLimit} bytes.`);
  }
  const extension = extname(file).toLowerCase().replace(/^\./, '');
  const format = String(action.format || extension || 'mvsj').toLowerCase();
  const bytes = await readFile(file);
  return {
    ...action,
    file,
    format,
    dataBase64: bytes.toString('base64'),
    byteCount: info.size
  };
}

function cookieValue(cookieHeader, name) {
  const prefix = `${name}=`;
  for (const part of String(cookieHeader || '').split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return '';
}

function contentType(pathname) {
  if (pathname.endsWith('.html')) return 'text/html; charset=utf-8';
  if (pathname.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  if (pathname.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

function safeWebPath(urlPath) {
  const stripped = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const normal = normalize(stripped);
  if (normal.startsWith('..') || normal.includes('/../') || normal.includes('\\')) return null;
  return resolve(webRoot, normal);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.structure || !Number.isInteger(args.port) || args.port <= 0) {
    usage();
    process.exit(args.help ? 0 : 2);
  }

  const structurePath = resolve(args.structure);
  const sourceBytes = await readFile(structurePath);
  const st = await stat(structurePath);
  const preview = await amberNcPreviewPayload(structurePath) ?? preparePreviewPayload(structurePath, sourceBytes);
  const extension = extname(structurePath).toLowerCase().replace(/^\./, '');
  const trajectoryFrameCount = Number(preview.trajectoryFrameCount || 0);
  const config = {
    label: preview.topologyPath ? `${basename(structurePath)} + ${basename(preview.topologyPath)}` : basename(structurePath),
    format: preview.format,
    binary: preview.binary,
    byteCount: st.size,
    sourceExtension: extension,
    sourcePath: structurePath,
    topologyPath: preview.topologyPath || null,
    trajectoryPath: preview.trajectoryPath || null,
    trajectoryControls: trajectoryFrameCount > 1,
    trajectoryFrameCount,
    textPreview: Boolean(preview.textPreview),
    showPanelControls: true,
    enablePreviewDocks: true,
    defaultPreviewDocks: [],
    defaultLayoutState: { left: 'hidden', right: 'hidden', top: 'hidden', bottom: 'hidden' },
    theme: 'auto',
    canvasBackground: 'auto'
  };
  const dataBase64 = preview.bytes.toString('base64');
  const token = args.token || Math.random().toString(36).slice(2) + Date.now().toString(36);
  const tokenCookieName = 'BurreteAgentPreviewToken';
  let liveReport = null;
  let nextActionId = 1;
  const actions = new Map();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${args.host}:${args.port}`);
      const hasValidToken = url.searchParams.get('token') === token || cookieValue(req.headers.cookie, tokenCookieName) === token;
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, tokenRequired: true }));
        return;
      }
      if ((url.pathname === '/' || url.pathname.endsWith('.html')) && !hasValidToken) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Missing or invalid token.');
        return;
      }
      if ((url.pathname === '/preview-config.js' || url.pathname === '/preview-data.js') && !hasValidToken) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Missing or invalid token.');
        return;
      }
      if (url.pathname.startsWith('/__agent/') && !hasValidToken) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Missing or invalid token.');
        return;
      }
      if (url.pathname === '/__agent/observe') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(observeState({
          host: args.host,
          port: args.port,
          structurePath,
          config,
          liveReport,
          actions
        }), null, 2));
        return;
      }
      if (url.pathname === '/__agent/act' && req.method === 'POST') {
        const body = await readRequestBody(req, 512 * 1024);
        const action = JSON.parse(body || '{}');
        const error = validateAction(action);
        if (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, apiVersion: agentControlApiVersion, error: { code: 'INVALID_ACTION', message: error } }));
          return;
        }
        let preparedAction = action;
        try {
          preparedAction = await prepareAction(action);
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, apiVersion: agentControlApiVersion, error: { code: 'INVALID_ACTION', message: error?.message || String(error) } }));
          return;
        }
        const id = `act-${nextActionId++}`;
        const item = {
          id,
          action: preparedAction,
          status: 'queued',
          createdAt: new Date().toISOString()
        };
        actions.set(id, item);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, apiVersion: agentControlApiVersion, action: publicAction(item) }));
        return;
      }
      if (url.pathname === '/__agent/next-action') {
        const item = Array.from(actions.values()).find(action => action.status === 'queued');
        if (!item) {
          res.writeHead(204);
          res.end();
          return;
        }
        item.status = 'dispatched';
        item.dispatchedAt = new Date().toISOString();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, apiVersion: agentControlApiVersion, id: item.id, action: item.action }));
        return;
      }
      if (url.pathname === '/__agent/action-result' && req.method === 'POST') {
        const body = await readRequestBody(req, 512 * 1024);
        const parsed = JSON.parse(body || '{}');
        const item = actions.get(String(parsed.id || ''));
        if (!item) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, apiVersion: agentControlApiVersion, error: { code: 'UNKNOWN_ACTION', message: 'Unknown action id.' } }));
          return;
        }
        item.completedAt = new Date().toISOString();
        item.result = parsed.result || null;
        item.status = parsed.result?.ok === false ? 'failed' : 'completed';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, apiVersion: agentControlApiVersion, action: publicAction(item) }));
        return;
      }
      if (url.pathname === '/__agent/report' && req.method === 'POST') {
        const body = await readRequestBody(req, 512 * 1024);
        const parsed = JSON.parse(body || '{}');
        liveReport = {
          reportedAt: new Date().toISOString(),
          capabilities: parsed.capabilities || null,
          summary: parsed.summary || null,
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings : []
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, apiVersion: agentControlApiVersion }));
        return;
      }
      if (url.pathname === '/preview-config.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        res.end(js('BurreteConfig', config) + js('BurreteAgentControl', controlConfig()));
        return;
      }
      if (url.pathname === '/preview-data.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        res.end(js('BurreteDataBase64', dataBase64));
        return;
      }
      const file = safeWebPath(url.pathname);
      if (!file || !file.startsWith(webRoot)) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad path.');
        return;
      }
      await stat(file);
      const headers = { 'Content-Type': contentType(file) };
      if (url.pathname === '/' || url.pathname.endsWith('.html')) {
        headers['Set-Cookie'] = `${tokenCookieName}=${encodeURIComponent(token)}; Path=/; SameSite=Strict`;
        if (config.textPreview) {
          res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
          res.end(textPreviewHtml({
            title: config.label,
            extension: config.sourceExtension,
            byteCount: config.byteCount,
            text: textPreviewContent(structurePath, sourceBytes, preview)
          }));
          return;
        }
        const html = await readFile(file, 'utf8');
        const assetVersion = String(Date.now());
        res.writeHead(200, headers);
        res.end(html
          .replaceAll('./viewer-runtime.css"', `./viewer-runtime.css?v=${assetVersion}"`)
          .replaceAll('./viewer-shell.js"', `./viewer-shell.js?v=${assetVersion}"`)
          .replaceAll('./burette-agent.js"', `./burette-agent.js?v=${assetVersion}"`)
          .replaceAll('./viewer.js"', `./viewer.js?v=${assetVersion}"`));
        return;
      }
      res.writeHead(200, headers);
      createReadStream(file).pipe(res);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(error?.message || 'Not found');
    }
  });

  server.listen(args.port, args.host, () => {
    const url = `http://${args.host}:${args.port}/index.html?token=${encodeURIComponent(token)}`;
    console.log(JSON.stringify({ ok: true, url, token, structurePath, config }, null, 2));
  });
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        rejectBody(new Error(`Request body exceeds ${maxBytes} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
