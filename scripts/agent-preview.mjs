#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename, extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');
const webRoot = resolve(repoRoot, 'PreviewExtension', 'Web');

function usage() {
  console.error(`Usage: node scripts/agent-preview.mjs <structure-file> [--port 5177] [--host 127.0.0.1]

Starts a tiny localhost-only Burette agent viewer for browser-use/manual QA.
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

function isBinaryFormat(file) {
  return extname(file).toLowerCase() === '.bcif';
}

function js(name, value) {
  return `window.${name} = ${JSON.stringify(value)};\n`;
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
  const bytes = await readFile(structurePath);
  const st = await stat(structurePath);
  const config = {
    label: basename(structurePath),
    format: inferFormat(structurePath),
    binary: isBinaryFormat(structurePath),
    byteCount: st.size,
    showPanelControls: true,
    defaultLayoutState: { left: 'hidden', right: 'hidden', top: 'hidden', bottom: 'hidden' },
    theme: 'auto',
    canvasBackground: 'black'
  };
  const dataBase64 = bytes.toString('base64');
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const tokenCookieName = 'BurreteAgentPreviewToken';

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
      if (url.pathname === '/preview-config.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        res.end(js('BurreteConfig', config));
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

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
