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
    canvasBackground: 'auto'
  };
  const dataBase64 = bytes.toString('base64');
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
