#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename, extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');
const webRoot = resolve(repoRoot, 'PreviewExtension', 'Web');
const agentControlApiVersion = 'burette-agent-control/v1';
const renderPanelReadLimit = 512 * 1024;

function usage() {
  console.error(`Usage: node scripts/agent-preview.mjs <structure-file> [--port 5177] [--host 127.0.0.1]

Starts a tiny localhost-only Burrete agent viewer for browser-use/manual QA.
It serves PreviewExtension/Web assets and generates preview-config.js/preview-data.js in-memory.`);
}

function parseArgs(argv) {
  const args = { host: '127.0.0.1', port: 5177, structure: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    if (arg === '--port') { args.port = Number(argv[++i]); continue; }
    if (arg === '--host') { args.host = String(argv[++i] || '127.0.0.1'); continue; }
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

function preparePreviewPayload(file, bytes) {
  if (!isMaestroPreviewFile(file)) return { bytes, format: inferFormat(file), binary: isBinaryFormat(file) };
  const converted = maestroPdbDataFromText(bytes.toString('utf8'));
  if (!converted) return { bytes, format: inferFormat(file), binary: isBinaryFormat(file) };
  return { bytes: Buffer.from(converted, 'utf8'), format: 'pdb', binary: false };
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
      viewer: config.format === 'sdf' ? 'grid-or-molstar' : 'molstar',
      ready: !!liveSummary
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
    'contacts',
    'reset_camera',
    'hide_waters',
    'show_waters',
    'show_surface',
    'color_by_chain',
    'render_panel',
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
  return null;
}

async function prepareAction(action) {
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
  const preview = preparePreviewPayload(structurePath, sourceBytes);
  const config = {
    label: basename(structurePath),
    format: preview.format,
    binary: preview.binary,
    byteCount: st.size,
    showPanelControls: true,
    defaultLayoutState: { left: 'hidden', right: 'hidden', top: 'hidden', bottom: 'hidden' },
    theme: 'auto',
    canvasBackground: 'auto'
  };
  const dataBase64 = preview.bytes.toString('base64');
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
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
