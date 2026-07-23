#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, watch } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEXT_FILE_READ_LIMIT = 12 * 1024 * 1024;
const DEV_FILE_SIZE_LIMIT = 75 * 1024 * 1024;
const NATIVE_COMPUTE_REQUEST_LIMIT = 12 * 1024 * 1024;
const NATIVE_COMPUTE_TIMEOUT_MS = 10 * 60 * 1000;
const MODEL_REQUEST_LIMIT = 36 * 1024 * 1024;
const MODEL_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_CHEMICAL_SPACE_KNN_CACHE_ENTRIES = 4;
const chemicalSpaceKnnCache = new Map();
const AMBER_NC_PREVIEW_FRAME_LIMIT = 100;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const STRUCTURE_EXTENSIONS = new Set([
  'pdb', 'ent', 'pdbqt', 'pqr', 'xpdb',
  'cif', 'mmcif', 'mcif', 'bcif', 'mmtf',
  'sdf', 'sd', 'smi', 'smiles', 'csv', 'tsv', 'dwar',
  'mol', 'mol2', 'xyz', 'gro', 'mae', 'maegz', 'cms', 'dtr',
  'xtc', 'trr', 'dcd', 'nctraj', 'nc', 'ncdf', 'netcdf', 'ncrst', 'lammpstrj',
  'top', 'psf', 'prmtop', 'tpr',
]);
const AMBER_NC_EXTENSIONS = new Set(['nc', 'ncdf', 'netcdf', 'ncrst']);
const TOPOLOGY_PREVIEW_EXTENSIONS = new Set(['pdb', 'ent', 'pdbqt', 'pqr', 'xpdb']);
const TRAJECTORY_COORDINATE_EXTENSIONS = new Set(['xtc', 'trr', 'dcd', 'nctraj', 'nc', 'ncdf', 'netcdf', 'ncrst', 'lammpstrj']);
const TRAJECTORY_MODEL_EXTENSIONS = new Set(['pdb', 'ent', 'pdbqt', 'pqr', 'xpdb', 'mmcif', 'cif', 'mcif', 'gro']);
const TRAJECTORY_TOPOLOGY_EXTENSIONS = new Set(['top', 'psf', 'prmtop', 'tpr']);
const TRAJECTORY_PAIR_EXTENSIONS = new Set([
  ...TRAJECTORY_COORDINATE_EXTENSIONS,
  ...TRAJECTORY_MODEL_EXTENSIONS,
  ...TRAJECTORY_TOPOLOGY_EXTENSIONS,
]);
const TEXT_EXTENSIONS = new Set([
  ...STRUCTURE_EXTENSIONS,
  'md', 'markdown', 'mdx', 'txt', 'log', 'err',
  'sh', 'bash', 'zsh', 'py', 'rs', 'js', 'jsx', 'mjs', 'cjs',
  'ts', 'tsx', 'json', 'yaml', 'yml', 'toml', 'html', 'htm', 'css', 'xml',
]);
const STATIC_MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);
const RUNTIME_ASSET_PATHS = new Set([
  'viewer-runtime.css',
  'viewer-bootstrap.js',
  'viewer-shell.js',
  'trajectory-smoothing.js',
  'molstar.css',
  'molstar.js',
  'burette-agent.js',
  'viewer.js',
  'grid-viewer.js',
  'grid-ui.js',
  'grid.css',
  'openchemlib/openchemlib.js',
  'rdkit/RDKit_minimal.js',
  'rdkit/RDKit_minimal.wasm',
]);
const RUNTIME_ASSET_NAMES = new Set([...RUNTIME_ASSET_PATHS].filter((path) => !path.includes('/')));
const APP_ICONS = {
  'default-app': resolve(scriptDir, '..', 'apps', 'desktop', 'src-tauri', 'icons', 'icon.png'),
  finder: '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/FinderIcon.icns',
  maestro: '/Applications/SchrodingerSuites2026-1/Maestro.app/Contents/Resources/Maestro.icns',
  chimerax: '/Applications/ChimeraX-1.10.app/Contents/Resources/chimerax-icon.icns',
  pymol: '/Applications/PyMOL.app/Contents/Resources/pymol.icns',
  avogadro2: '/Applications/Avogadro2.app/Contents/Resources/avogadro.icns',
  datawarrior: '/Applications/DataWarrior.app/Contents/Resources/datawarrior.icns',
  vesta: '/Applications/VESTA.app/Contents/Resources/VESTA.icns',
};
const runtimeAssetRoots = runtimeAssetRootCandidates();

function usage() {
  console.error(`Usage:
  node scripts/agent-shell-server.mjs --dist <dir> --session-dir <dir> --allow <dir> --host 127.0.0.1 --port 5177
`);
}

function parseArgs(args) {
  const out = { allow: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dist') {
      out.dist = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--session-dir') {
      out.sessionDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--allow') {
      out.allow.push(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--host') {
      out.host = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--port') {
      out.port = Number(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }
  return out;
}

function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value) fail(`Missing value for ${flag}`);
  return value;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: { message } }, null, 2));
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}
if (!args.dist || !args.sessionDir || !args.host || !Number.isInteger(args.port) || args.port <= 0) {
  usage();
  fail('Missing required --dist, --session-dir, --host, or --port.');
}

const distRoot = resolve(args.dist);
const sessionDir = resolve(args.sessionDir);
const fileAllowRoots = args.allow.map((item) => resolve(item));
const allowRoots = Array.from(new Set([
  distRoot,
  sessionDir,
  ...defaultAssetAllowRoots(),
  ...fileAllowRoots,
].map((item) => resolve(item))));
const indexPath = resolve(distRoot, 'index.html');
if (!existsSync(indexPath)) fail(`Missing prebuilt agent shell index: ${indexPath}`);

await mkdir(sessionDir, { recursive: true });

const server = createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    sendJson(res, 500, { error: error?.message || String(error) });
  });
});

server.listen(args.port, args.host, () => {
  console.log(JSON.stringify({
    ok: true,
    mode: 'browser-agent-shell-static',
    host: args.host,
    port: args.port,
    distRoot,
    sessionDir,
  }, null, 2));
});

async function handleRequest(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  const url = new URL(req.url || '/', `http://${args.host}:${args.port}`);
  if (url.pathname === '/healthz') {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (url.pathname.startsWith('/__burette/agent-session/')) {
    await handleAgentSession(req, res, method, url);
    return;
  }
  if (url.pathname.startsWith('/__burette/app-icon/')) {
    await handleAppIcon(res, method, url);
    return;
  }
  if (url.pathname === '/__burette/read-file') {
    await handleReadFile(res, method, url);
    return;
  }
  if (url.pathname === '/__burette/read-text-file') {
    await handleReadTextFile(res, method, url);
    return;
  }
  if (url.pathname === '/__burette/file-bundle') {
    await handleFileBundle(res, method, url);
    return;
  }
  if (url.pathname === '/__burette/trajectory-preview') {
    await handleTrajectoryPreview(res, method, url);
    return;
  }
  if (url.pathname === '/__burette/trajectory-pair') {
    await handleTrajectoryPair(res, method, url);
    return;
  }
  if (url.pathname === '/__burette/dev-files') {
    await handleDevFiles(res, method, url);
    return;
  }
  if (url.pathname === '/__burette/rdkit-wasm') {
    await handleRdkitWasm(res, method);
    return;
  }
  if (url.pathname === '/__burette/native-compute') {
    await handleNativeCompute(req, res, method);
    return;
  }
  if (url.pathname === '/__burette/chemical-space-representation') {
    await handleChemicalSpaceRepresentation(req, res, method);
    return;
  }
  if (url.pathname.startsWith('/__burette/runtime/')) {
    await handleRuntimeAsset(res, method, url);
    return;
  }
  await handleStatic(res, method, url);
}

async function handleChemicalSpaceRepresentation(req, res, method) {
  if (method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  try {
    const python = molecularRepresentationPython();
    if (!python) {
      throw new Error('Metal model runtime is not installed. Configure BURRETE_CHEMICAL_SPACE_MODEL_PYTHON.');
    }
    const body = await readJsonBody(req, MODEL_REQUEST_LIMIT);
    const repoRoot = resolve(scriptDir, '..');
    const script = resolve(repoRoot, 'compute', 'models', 'chemical_space_representations.py');
    const modelRoot = resolve(homedir(), 'Library', 'Application Support', 'Burrete', 'chemical-space-models');
    const payload = await runJsonWorker(
      python,
      [script],
      JSON.stringify(body),
      MODEL_REQUEST_TIMEOUT_MS,
      {
        HF_HOME: String(process.env.HF_HOME || '').trim() || resolve(modelRoot, 'huggingface'),
        PYTORCH_ENABLE_MPS_FALLBACK: '0',
        UNIMOL_WEIGHT_DIR: String(process.env.UNIMOL_WEIGHT_DIR || '').trim() || resolve(modelRoot, 'unimol'),
      },
    );
    if (payload.ok !== true || !payload.result) {
      throw new Error(typeof payload.error === 'string' ? payload.error : 'Metal model worker failed');
    }
    sendJson(res, 200, payload.result);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

function molecularRepresentationPython() {
  const repoRoot = resolve(scriptDir, '..');
  return [
    String(process.env.BURRETE_CHEMICAL_SPACE_MODEL_PYTHON || '').trim(),
    resolve(homedir(), 'Library', 'Application Support', 'Burrete', 'model-python', 'bin', 'python'),
    resolve(repoRoot, '.venv-chemical-space', 'bin', 'python'),
  ].filter(Boolean).find((candidate) => existsSync(candidate)) || null;
}

async function handleAgentSession(req, res, method, url) {
  const fileName = decodeURIComponent(url.pathname.replace('/__burette/agent-session/', '').replace(/^\/+/, ''));
  if (!['actions.json', 'observe.json', 'session.json', 'events'].includes(fileName)) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  if (fileName === 'events') {
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    const sendActionsEvent = () => {
      res.write(`event: actions\ndata: ${JSON.stringify({ file: 'actions.json', at: new Date().toISOString() })}\n\n`);
    };
    sendActionsEvent();
    const watcher = watch(sessionDir, (_eventType, changedFileName) => {
      if (changedFileName === 'actions.json') sendActionsEvent();
    });
    req.on('close', () => watcher.close());
    return;
  }
  const filePath = resolve(sessionDir, fileName);
  if (!isWithin(filePath, sessionDir)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  if (method === 'GET') {
    const fallback = fileName === 'actions.json'
      ? { apiVersion: 'burette-agent-control/v1', actions: [] }
      : {};
    const value = existsSync(filePath) ? JSON.parse(await readFile(filePath, 'utf8')) : fallback;
    sendJson(res, 200, value);
    return;
  }
  if (method === 'PUT') {
    if (fileName === 'session.json') {
      sendJson(res, 405, { error: 'session.json is read-only' });
      return;
    }
    const body = await readJsonBody(req);
    await writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`);
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 405, { error: 'Method not allowed' });
}

async function handleAppIcon(res, method, url) {
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const iconId = decodeURIComponent(url.pathname.replace('/__burette/app-icon/', '').replace(/^\/+/, '')).replace(/\.png$/u, '');
  const iconPath = APP_ICONS[iconId];
  if (!iconPath || !existsSync(iconPath)) {
    sendJson(res, 404, { error: 'Icon not found' });
    return;
  }
  const cacheDir = resolve(sessionDir, 'app-icons');
  const outputPath = resolve(cacheDir, `${iconId}.png`);
  if (!existsSync(outputPath)) {
    await mkdir(cacheDir, { recursive: true });
    const result = spawnSync('/usr/bin/sips', ['-s', 'format', 'png', iconPath, '--out', outputPath], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || '').trim() || `sips exited with status ${result.status}`);
    }
  }
  await sendStaticFile(res, method, outputPath, true);
}

async function handleReadFile(res, method, url) {
  if (method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const filePath = allowedPathFromQuery(url);
  if (!filePath) {
    sendJson(res, 400, { error: 'Missing, forbidden, or unsupported path' });
    return;
  }
  const info = await stat(filePath);
  if (!info.isFile() || info.size > DEV_FILE_SIZE_LIMIT || !STRUCTURE_EXTENSIONS.has(fileExtension(filePath))) {
    sendJson(res, 400, { error: 'Unsupported file' });
    return;
  }
  const bytes = await readFile(filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Cache-Control', 'no-cache');
  res.end(bytes);
}

async function handleReadTextFile(res, method, url) {
  if (method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const filePath = allowedPathFromQuery(url, { allowText: true });
  if (!filePath) {
    sendJson(res, 400, { error: 'Missing, forbidden, or unsupported path' });
    return;
  }
  const info = await stat(filePath);
  if (!info.isFile() || info.size > DEV_FILE_SIZE_LIMIT) {
    sendJson(res, 400, { error: 'Unsupported file' });
    return;
  }
  const maxBytes = textFileReadLimit(url.searchParams.get('maxBytes'));
  const extension = fileExtension(filePath);
  const bytes = readableTextBytes(await readFile(filePath), extension);
  if (looksBinary(bytes)) {
    sendJson(res, 400, { error: `${filePath} is not a text file` });
    return;
  }
  const truncated = bytes.length > maxBytes;
  const readableBytes = truncated ? bytes.subarray(0, maxBytes) : bytes;
  sendJson(res, 200, {
    id: `browser-agent-shell-${filePath}-${info.mtimeMs}`,
    path: filePath,
    title: basename(filePath) || 'Text file',
    extension,
    language: languageForTextExtension(extension),
    byteCount: info.size,
    content: readableBytes.toString('utf8'),
    truncated,
    modifiedAt: Math.max(0, Math.floor(info.mtimeMs)),
  });
}

async function handleFileBundle(res, method, url) {
  if (method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const filePath = allowedPathFromQuery(url, { allowText: true });
  if (!filePath) {
    sendJson(res, 400, { error: 'Missing, forbidden, or unsupported path' });
    return;
  }
  sendJson(res, 200, {
    kind: 'single',
    primaryPath: filePath,
    inputPath: filePath,
    attachments: [],
  });
}

async function handleTrajectoryPreview(res, method, url) {
  if (method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const filePath = allowedPathFromQuery(url);
  if (!filePath) {
    sendJson(res, 400, { error: 'Missing, forbidden, or unsupported path' });
    return;
  }
  if (!AMBER_NC_EXTENSIONS.has(fileExtension(filePath))) {
    sendJson(res, 404, { error: 'No trajectory preview converter is available for this file type' });
    return;
  }
  try {
    const preview = await createAmberNcPreview(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'chemical/x-pdb; charset=us-ascii');
    res.setHeader('Content-Length', String(preview.bytes.length));
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Burrete-Source-Byte-Count', String(preview.sourceByteCount));
    res.setHeader('X-Burrete-Trajectory-Topology', preview.topologyPath);
    res.setHeader('X-Burrete-Trajectory-Frame-Count', String(preview.frameCount));
    res.end(preview.bytes);
  } catch (error) {
    sendJson(res, 400, { error: error?.message || String(error) });
  }
}

async function handleTrajectoryPair(res, method, url) {
  if (method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const rawPath = url.searchParams.get('path');
  if (!rawPath) {
    sendJson(res, 400, { error: 'Missing path' });
    return;
  }
  const filePath = resolve(rawPath);
  if (!isAllowed(filePath) || !TRAJECTORY_PAIR_EXTENSIONS.has(fileExtension(filePath))) {
    sendJson(res, 400, { error: 'Missing, forbidden, or unsupported path' });
    return;
  }
  try {
    const pair = await createTrajectoryPairPayload(filePath);
    if (!pair) {
      sendJson(res, 404, { error: 'No matching trajectory pair found.' });
      return;
    }
    sendJson(res, 200, pair);
  } catch (error) {
    sendJson(res, 400, { error: error?.message || String(error) });
  }
}

async function createTrajectoryPairPayload(filePath) {
  const extension = fileExtension(filePath);
  const files = [];
  await collectDevFiles(dirname(filePath), files);
  const candidates = Array.from(new Set([filePath, ...files]))
    .filter((candidate) => isAllowed(candidate) && TRAJECTORY_PAIR_EXTENSIONS.has(fileExtension(candidate)));
  const coordinatePath = TRAJECTORY_COORDINATE_EXTENSIONS.has(extension)
    ? filePath
    : preferredTrajectoryCandidate(candidates, TRAJECTORY_COORDINATE_EXTENSIONS, filePath);
  if (!coordinatePath) return null;
  const modelCandidates = candidates.filter((candidate) => candidate !== coordinatePath);
  const modelPath = preferredTrajectoryCandidate(modelCandidates, TRAJECTORY_MODEL_EXTENSIONS, filePath)
    || preferredTrajectoryCandidate(modelCandidates, TRAJECTORY_TOPOLOGY_EXTENSIONS, filePath);
  if (!modelPath) return null;
  const [coordinateInfo, modelInfo] = await Promise.all([stat(coordinatePath), stat(modelPath)]);
  if (!coordinateInfo.isFile() || !modelInfo.isFile()) return null;
  if (coordinateInfo.size > DEV_FILE_SIZE_LIMIT || modelInfo.size > DEV_FILE_SIZE_LIMIT) return null;
  const [coordinateBytes, modelBytes] = await Promise.all([readFile(coordinatePath), readFile(modelPath)]);
  const coordinate = trajectorySource(coordinatePath, coordinateBytes);
  const model = trajectorySource(modelPath, modelBytes);
  return {
    label: `${basename(coordinatePath)} + ${basename(modelPath)}`,
    byteCount: coordinateInfo.size + modelInfo.size,
    sourcePath: filePath,
    sourceExtension: extension,
    docking: {
      activePose: null,
      sceneMode: null,
      receptor: model.source,
      ligands: [coordinate.source],
    },
    payloads: {
      receptor: { dataBase64: model.dataBase64 },
      ligands: [{ dataBase64: coordinate.dataBase64 }],
    },
  };
}

function preferredTrajectoryCandidate(candidates, formats, sourcePath) {
  const matches = candidates.filter((candidate) => formats.has(fileExtension(candidate)));
  if (!matches.length) return null;
  const sourceStem = trajectoryStem(sourcePath);
  return matches
    .map((candidate) => ({ candidate, score: trajectoryCandidateScore(candidate, sourceStem) }))
    .sort((left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate))[0]?.candidate || null;
}

function trajectoryCandidateScore(path, sourceStem) {
  const extension = fileExtension(path);
  const stem = trajectoryStem(path);
  let score = stem === sourceStem ? 20 : sourceStem.startsWith(stem) || stem.startsWith(sourceStem) ? 12 : 0;
  if (extension === 'gro') score += 8;
  if (extension === 'pdb') score += 7;
  if (extension === 'tpr') score += 4;
  if (extension === 'xtc') score += 8;
  return score;
}

function trajectoryStem(path) {
  return basename(path).replace(/\.[^.]+$/u, '').replace(/_(centered|aligned|fit|reimaged|realmd|realmotion).*$/u, '');
}

function trajectorySource(path, bytes) {
  const extension = fileExtension(path);
  return {
    source: {
      path,
      format: trajectoryMolstarFormat(extension),
      binary: TRAJECTORY_COORDINATE_EXTENSIONS.has(extension) || extension === 'tpr',
      label: basename(path),
    },
    dataBase64: bytes.toString('base64'),
  };
}

function trajectoryMolstarFormat(extension) {
  if (extension === 'cif' || extension === 'mcif') return 'mmcif';
  if (extension === 'ent' || extension === 'pqr' || extension === 'xpdb') return 'pdb';
  if (extension === 'nc' || extension === 'ncdf' || extension === 'netcdf' || extension === 'ncrst') return 'nctraj';
  return extension;
}

async function createAmberNcPreview(trajectoryPath) {
  const trajectoryInfo = await stat(trajectoryPath);
  const candidates = await amberNcTopologyCandidates(trajectoryPath);
  const errors = [];
  for (const topologyPath of candidates) {
    const outputPath = resolve(sessionDir, `${safeFileStem(basename(trajectoryPath))}.amber-preview.pdb`);
    try {
      const frameCount = runAmberNcExtractor(topologyPath, trajectoryPath, outputPath);
      return {
        bytes: await readFile(outputPath),
        topologyPath,
        frameCount,
        sourceByteCount: trajectoryInfo.size,
      };
    } catch (error) {
      errors.push(`${basename(topologyPath)}: ${error?.message || String(error)}`);
    }
  }
  const details = errors.length ? ` Tried: ${errors.join('; ')}` : '';
  throw new Error(`Amber NetCDF trajectory requires a matching PDB topology/reference file in the same folder.${details}`);
}

async function amberNcTopologyCandidates(trajectoryPath) {
  const folder = dirname(trajectoryPath);
  const stem = basename(trajectoryPath).replace(/\.[^.]+$/u, '');
  const preferredNames = [
    'reference.pdb',
    `${stem}.pdb`,
    'topology.pdb',
    'structure.pdb',
    'system.pdb',
    'top.pdb',
  ];
  const preferred = preferredNames.map((name) => resolve(folder, name));
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const discovered = entries
    .filter((entry) => entry.isFile() && TOPOLOGY_PREVIEW_EXTENSIONS.has(fileExtension(entry.name)))
    .map((entry) => resolve(folder, entry.name))
    .sort((left, right) => left.localeCompare(right));
  const unique = Array.from(new Set([...preferred, ...discovered]));
  const candidates = [];
  for (const candidate of unique) {
    if (!isAllowed(candidate)) continue;
    const info = await stat(candidate).catch(() => null);
    if (info?.isFile()) candidates.push(candidate);
  }
  return candidates;
}

function runAmberNcExtractor(topologyPath, trajectoryPath, outputPath) {
  const extractor = resolve(scriptDir, 'amber_nc_preview_extract.py');
  if (!existsSync(extractor)) throw new Error(`Missing Amber NetCDF extractor: ${extractor}`);
  const result = spawnSync('python3', [
    extractor,
    topologyPath,
    trajectoryPath,
    '--frames',
    String(AMBER_NC_PREVIEW_FRAME_LIMIT),
    '--output',
    outputPath,
  ], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim();
    throw new Error(details || `extractor exited with status ${result.status}`);
  }
  const match = String(result.stdout || '').match(/frames=(\d+)/u);
  return match ? Number(match[1]) : countPdbModelsFromFile(outputPath);
}

function countPdbModelsFromFile(path) {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const matches = text.match(/^MODEL\b/gmu);
  return matches?.length ?? 0;
}

function safeFileStem(value) {
  return String(value || 'trajectory').replace(/[^A-Za-z0-9._-]+/gu, '_').slice(0, 80) || 'trajectory';
}

async function handleDevFiles(res, method, url) {
  if (method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const root = url.searchParams.get('root');
  const source = root ? resolve(root) : fileAllowRoots[0];
  if (!source) {
    sendJson(res, 200, { files: [] });
    return;
  }
  if (!isAllowed(source)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  const files = [];
  await collectDevFiles(source, files);
  sendJson(res, 200, { files: Array.from(new Set(files)).sort((left, right) => left.localeCompare(right)) });
}

async function handleStatic(res, method, url) {
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const cleanPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (cleanPath.startsWith('@fs/')) {
    await handleFsStatic(res, method, cleanPath);
    return;
  }
  const candidate = resolve(distRoot, cleanPath || 'index.html');
  const filePath = isWithin(candidate, distRoot) && existsSync(candidate)
    ? candidate
    : indexPath;
  const relativePath = relative(distRoot, filePath);
  const noCache = filePath === indexPath || relativePath === 'index.js' || relativePath === 'boot-overlay.js';
  await sendStaticFile(res, method, filePath, noCache);
}

async function handleRdkitWasm(res, method) {
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  for (const root of runtimeAssetRoots) {
    const candidate = resolve(root, 'rdkit', 'RDKit_minimal.wasm');
    if (isWithin(candidate, root) && existsSync(candidate)) {
      await sendStaticFile(res, method, candidate, false);
      return;
    }
  }
  sendJson(res, 404, { error: 'Not found' });
}

async function handleNativeCompute(req, res, method) {
  const runtime = nativeComputeRuntime();
  if (method === 'GET') {
    sendJson(res, 200, {
      available: Boolean(runtime),
      provider: runtime ? 'nativeMetalDevBridge' : null,
      operations: runtime ? ['generate3d', 'generateEnsemble', 'optimizeGeometry', 'semiempiricalRm1', 'alignPoses', 'chemicalSpace'] : [],
    });
    return;
  }
  if (method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  try {
    if (!runtime) throw new Error('Native Metal dev runtime is unavailable in this Browser shell.');
    const body = await readJsonBody(req, NATIVE_COMPUTE_REQUEST_LIMIT);
    const originalInput = JSON.stringify(body);
    if (Buffer.byteLength(originalInput, 'utf8') > NATIVE_COMPUTE_REQUEST_LIMIT) {
      throw new Error('Native compute request exceeds 12 MiB');
    }
    const cacheKey = chemicalSpaceCacheKey(body);
    if (cacheKey) {
      const cached = chemicalSpaceKnnCache.get(cacheKey);
      if (cached) {
        chemicalSpaceKnnCache.delete(cacheKey);
        chemicalSpaceKnnCache.set(cacheKey, cached);
        chemicalSpacePayload(body).knnCache = cached;
      }
    }
    const response = await runNativeCompute(runtime, JSON.stringify(body));
    sendJson(res, 200, cacheChemicalSpaceKnn(response, cacheKey));
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

function chemicalSpacePayload(body) {
  const chemicalSpace = body && typeof body === 'object' ? body.chemicalSpace : null;
  return chemicalSpace && typeof chemicalSpace === 'object' ? chemicalSpace : {};
}

function chemicalSpaceCacheKey(body) {
  if (!body || typeof body !== 'object' || body.operation !== 'chemicalSpace') return null;
  const payload = chemicalSpacePayload(body);
  const options = payload.options && typeof payload.options === 'object' ? payload.options : {};
  const records = Array.isArray(payload.records) ? payload.records : [];
  const neighbors = Number(options.neighbors);
  const suppliedKnn = payload.knnCache && typeof payload.knnCache === 'object'
    ? createHash('sha256').update(JSON.stringify(payload.knnCache)).digest('hex')
    : 'compute';
  return records.length > 0 && Number.isSafeInteger(neighbors) && neighbors > 0
    ? `${createHash('sha256').update(JSON.stringify(records)).digest('hex')}:${neighbors}:${suppliedKnn}`
    : null;
}

function cacheChemicalSpaceKnn(response, cacheKey) {
  if (!cacheKey || !response || typeof response !== 'object') return response;
  const result = response.result;
  if (!result || typeof result !== 'object' || result.embedding === undefined || result.knnCache === undefined) {
    return response;
  }
  chemicalSpaceKnnCache.set(cacheKey, result.knnCache);
  while (chemicalSpaceKnnCache.size > MAX_CHEMICAL_SPACE_KNN_CACHE_ENTRIES) {
    const oldestKey = chemicalSpaceKnnCache.keys().next().value;
    if (oldestKey === undefined) break;
    chemicalSpaceKnnCache.delete(oldestKey);
  }
  return { ...response, result: result.embedding };
}

function nativeComputeRuntime() {
  const repoRoot = resolve(scriptDir, '..');
  const runtimeRoots = [
    String(process.env.BURRETE_DEV_COMPUTE_RUNTIME_ROOT || '').trim(),
    resolve(repoRoot, 'target', 'debug', 'ComputeMetal'),
    resolve(repoRoot, 'target', 'release', 'ComputeMetal'),
  ].filter(Boolean);
  const runtimeRoot = runtimeRoots.find((candidate) => existsSync(resolve(candidate, 'current.json')));
  if (!runtimeRoot) return null;
  const executables = [
    String(process.env.BURRETE_DEV_COMPUTE_BACKEND || '').trim(),
    resolve(dirname(dirname(runtimeRoot)), 'MacOS', 'burrete-compute-dev-backend'),
    resolve(repoRoot, 'target', 'debug', 'burrete-compute-dev-backend'),
    resolve(repoRoot, 'target', 'release', 'burrete-compute-dev-backend'),
  ].filter(Boolean);
  const executable = executables.find((candidate) => existsSync(candidate));
  return executable ? { executable, runtimeRoot } : null;
}

function runNativeCompute(runtime, input) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(runtime.executable, ['--runtime-root', runtime.runtimeRoot], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdoutChunks = [];
    const stderrChunks = [];
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error('Native Metal dev backend timed out'));
    }, NATIVE_COMPUTE_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      if (code !== 0) {
        rejectPromise(new Error(stderr || `Native Metal dev backend exited with ${signal || code}`));
        return;
      }
      try {
        const payload = JSON.parse(stdout);
        if (!payload || typeof payload !== 'object') throw new Error('Native Metal dev backend returned an invalid response');
        resolvePromise(payload);
      } catch (error) {
        rejectPromise(error);
      }
    });
    child.stdin.end(input);
  });
}

function runJsonWorker(command, commandArgs, input, timeoutMs, environment = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, {
      env: { ...process.env, ...environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error('Metal model worker timed out'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      if (code !== 0) {
        rejectPromise(new Error(stderr || `Metal model worker exited with ${signal || code}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        rejectPromise(error);
      }
    });
    child.stdin.end(input);
  });
}

async function handleRuntimeAsset(res, method, url) {
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const assetPath = decodeURIComponent(url.pathname.slice('/__burette/runtime/'.length)).replace(/^\/+/, '');
  if (!RUNTIME_ASSET_PATHS.has(assetPath) || assetPath.includes('\\')) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  for (const root of runtimeAssetRoots) {
    const candidate = resolve(root, assetPath);
    if (isWithin(candidate, root) && existsSync(candidate)) {
      await sendStaticFile(res, method, candidate, false);
      return;
    }
  }
  sendJson(res, 404, { error: 'Not found' });
}

async function handleFsStatic(res, method, cleanPath) {
  const runtimeAssetPath = findRuntimeAssetPath(cleanPath);
  if (runtimeAssetPath) {
    await sendStaticFile(res, method, runtimeAssetPath, false);
    return;
  }
  const filePath = resolve(`/${cleanPath.slice('@fs/'.length)}`);
  if (!isAllowed(filePath)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile() || info.size > DEV_FILE_SIZE_LIMIT) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  await sendStaticFile(res, method, filePath, false, info);
}

async function sendStaticFile(res, method, filePath, noCache, knownInfo = null) {
  const info = knownInfo ?? await stat(filePath);
  if (!info.isFile()) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  const bytes = await readFile(filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', STATIC_MIME_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream');
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Cache-Control', noCache ? 'no-cache' : 'public, max-age=31536000, immutable');
  res.end(method === 'HEAD' ? undefined : bytes);
}

function runtimeAssetRootCandidates() {
  return Array.from(new Set([
    resolve(scriptDir, '..', 'PreviewExtension', 'Web'),
    resolve(scriptDir, '..', 'preview-web'),
    resolve(scriptDir, '..', '..', 'PreviewExtension', 'Web'),
    resolve(scriptDir, '..', '..', '..', 'PreviewExtension', 'Web'),
  ]));
}

function findRuntimeAssetPath(cleanPath) {
  if (!cleanPath.includes('/PreviewExtension/Web/')) return null;
  const assetName = basename(cleanPath);
  if (!RUNTIME_ASSET_NAMES.has(assetName)) return null;
  for (const root of runtimeAssetRoots) {
    const candidate = resolve(root, assetName);
    if (isWithin(candidate, root) && existsSync(candidate)) return candidate;
  }
  return null;
}

async function collectDevFiles(path, files) {
  let info;
  try {
    info = await stat(path);
  } catch (_) {
    return;
  }
  if (info.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      await collectDevFiles(join(path, entry.name), files);
    }
    return;
  }
  if (!info.isFile() || info.size > DEV_FILE_SIZE_LIMIT) return;
  if (!TEXT_EXTENSIONS.has(fileExtension(path))) return;
  files.push(path);
}

function allowedPathFromQuery(url, options = {}) {
  const rawPath = url.searchParams.get('path');
  if (!rawPath) return null;
  const filePath = resolve(rawPath);
  if (!isAllowed(filePath)) return null;
  const extension = fileExtension(filePath);
  if (options.allowText ? !TEXT_EXTENSIONS.has(extension) : !STRUCTURE_EXTENSIONS.has(extension)) return null;
  return filePath;
}

function defaultAssetAllowRoots() {
  return [
    resolve(scriptDir, '..', 'preview-web'),
    resolve(scriptDir, '..', 'PreviewExtension', 'Web'),
    resolve(scriptDir, '..', '..', '..', 'PreviewExtension', 'Web'),
    resolve(process.cwd(), 'PreviewExtension', 'Web'),
  ].filter((path) => existsSync(path));
}

function isAllowed(path) {
  return allowRoots.some((root) => isWithin(path, root));
}

function isWithin(path, root) {
  const relation = relative(root, path);
  return relation === '' || (relation && !relation.startsWith('..') && !relation.startsWith('/'));
}

function fileExtension(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.mae.gz')) return 'maegz';
  const extension = extname(lower).replace(/^\./u, '');
  return extension;
}

function textFileReadLimit(value) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return TEXT_FILE_READ_LIMIT;
  return Math.min(parsed, TEXT_FILE_READ_LIMIT);
}

function readableTextBytes(bytes, extension) {
  if (extension === 'maegz') return gunzipSync(bytes);
  return bytes;
}

function looksBinary(bytes) {
  const limit = Math.min(bytes.length, TEXT_FILE_READ_LIMIT);
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

function languageForTextExtension(extension) {
  if (extension === 'md' || extension === 'markdown' || extension === 'mdx') return 'markdown';
  if (extension === 'sh' || extension === 'bash' || extension === 'zsh') return 'shell';
  if (extension === 'js' || extension === 'jsx' || extension === 'mjs' || extension === 'cjs') return 'javascript';
  if (extension === 'ts' || extension === 'tsx') return 'typescript';
  if (extension === 'json') return 'json';
  if (extension === 'yaml' || extension === 'yml') return 'yaml';
  if (extension === 'toml') return 'toml';
  if (extension === 'py') return 'python';
  if (extension === 'rs') return 'rust';
  if (extension === 'css') return 'css';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'xml') return 'xml';
  if (extension === 'mae' || extension === 'maegz' || extension === 'cms') return 'maestro';
  return 'text';
}

async function readJsonBody(req, byteLimit = Number.POSITIVE_INFINITY) {
  let raw = '';
  let byteCount = 0;
  for await (const chunk of req) {
    byteCount += Buffer.byteLength(chunk);
    if (byteCount > byteLimit) throw new Error(`Request exceeds ${Math.floor(byteLimit / (1024 * 1024))} MiB`);
    raw += chunk.toString('utf8');
  }
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, value) {
  const body = `${JSON.stringify(value)}\n`;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(body);
}
