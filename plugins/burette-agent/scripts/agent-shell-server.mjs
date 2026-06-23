#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, watch } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEXT_FILE_READ_LIMIT = 12 * 1024 * 1024;
const DEV_FILE_SIZE_LIMIT = 75 * 1024 * 1024;
const AMBER_NC_PREVIEW_FRAME_LIMIT = 100;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const STRUCTURE_EXTENSIONS = new Set([
  'pdb', 'ent', 'pdbqt', 'pqr', 'xpdb',
  'cif', 'mmcif', 'mcif', 'bcif', 'mmtf',
  'sdf', 'sd', 'smi', 'smiles', 'csv', 'tsv',
  'mol', 'mol2', 'xyz', 'gro', 'mae', 'maegz', 'cms', 'dtr',
  'nc', 'ncdf', 'netcdf', 'ncrst',
]);
const AMBER_NC_EXTENSIONS = new Set(['nc', 'ncdf', 'netcdf', 'ncrst']);
const TOPOLOGY_PREVIEW_EXTENSIONS = new Set(['pdb', 'ent', 'pdbqt', 'pqr', 'xpdb']);
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
const allowRoots = Array.from(new Set([distRoot, sessionDir, ...fileAllowRoots].map((item) => resolve(item))));
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
  if (url.pathname === '/__burette/dev-files') {
    await handleDevFiles(res, method, url);
    return;
  }
  if (url.pathname.startsWith('/@fs/')) {
    await handleFsFile(res, method, url);
    return;
  }
  await handleStatic(res, method, url);
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

async function handleFsFile(res, method, url) {
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const filePath = filePathFromFsUrl(url);
  if (!filePath || !isAllowed(filePath)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  const extension = fileExtension(filePath);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  if (info.size > DEV_FILE_SIZE_LIMIT || !STRUCTURE_EXTENSIONS.has(extension)) {
    sendJson(res, 400, { error: 'Unsupported file' });
    return;
  }
  const bytes = await readFile(filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Cache-Control', 'no-cache');
  res.end(method === 'HEAD' ? undefined : bytes);
}

async function handleStatic(res, method, url) {
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const cleanPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const candidate = resolve(distRoot, cleanPath || 'index.html');
  const filePath = isWithin(candidate, distRoot) && existsSync(candidate)
    ? candidate
    : indexPath;
  const info = await stat(filePath);
  if (!info.isFile()) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  const bytes = await readFile(filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', STATIC_MIME_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream');
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Cache-Control', filePath === indexPath ? 'no-cache' : 'public, max-age=31536000, immutable');
  res.end(method === 'HEAD' ? undefined : bytes);
}

function filePathFromFsUrl(url) {
  const rawPath = decodeURIComponent(url.pathname.slice('/@fs/'.length));
  if (!rawPath) return null;
  return resolve(rawPath.startsWith('/') ? rawPath : `/${rawPath}`);
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

async function readJsonBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk.toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, value) {
  const body = `${JSON.stringify(value)}\n`;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(body);
}
