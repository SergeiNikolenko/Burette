import { App } from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'burette-local-viewer', version: '0.1.0' }, {}, { autoResize: false });
let session;
let started = false;
let displayMode = 'inline';
let revision = 0;
let lastAction = null;
let completed = null;
const executed = new Map();
const status = document.getElementById('status');

async function exchange(input) {
  const result = await app.callServerTool({ name: 'burette.inline_viewer_exchange', arguments: { ...session, ...input } });
  if (result.isError || !result._meta?.payload) throw new Error(result.content?.[0]?.text || 'Local viewer exchange failed.');
  return result._meta.payload;
}

async function loadScript(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Bundled viewer script failed to load.'));
      document.body.appendChild(script);
    });
  } finally { URL.revokeObjectURL(url); }
}

async function start() {
  const packed = Uint8Array.from(atob(document.getElementById('burette-assets').textContent), c => c.charCodeAt(0));
  const assets = JSON.parse(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  const chunks = [];
  let offset = 0;
  do {
    const payload = await exchange({ source: true, offset });
    chunks.push(Uint8Array.from(atob(payload.dataBase64), c => c.charCodeAt(0)));
    window.BuretteConfig = payload.config;
    offset = payload.nextOffset;
  } while (offset !== null);
  window.BuretteDataBytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let cursor = 0;
  for (const chunk of chunks) { window.BuretteDataBytes.set(chunk, cursor); cursor += chunk.length; }
  for (const name of ['molstar.css', 'viewer-runtime.css']) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = URL.createObjectURL(new Blob([assets[name]], { type: 'text/css' }));
    if (name === 'molstar.css') window.BuretteMolstarCSSURL = link.href;
    document.head.appendChild(link);
  }
  for (const name of ['molstar.js', 'viewer-shell.js', 'burette-agent.js', 'trajectory-smoothing.js', 'molstar-preset-preview-controller.js', 'superposition-panel.js', 'viewer.js']) await loadScript(assets[name]);
  await poll();
}

async function poll() {
  try {
    const summary = await window.BuretteAgent.run({ command: 'summary' });
    const ready = summary.ok === true && summary.result?.counts?.atoms > 0;
    const state = { ready, revision, displayMode, counts: summary.result?.counts || null, camera: window.BuretteViewer?.plugin?.canvas3d?.camera?.getSnapshot(), lastAction };
    const result = await exchange({ state, ...(completed ? { completed } : {}) });
    completed = null;
    for (const item of result.actions) {
      if (executed.has(item.actionId)) { completed = executed.get(item.actionId); continue; }
      try {
        const outcome = item.action.type === 'set_display_mode'
          ? await app.requestDisplayMode({ mode: item.action.mode })
          : await window.BuretteViewerActions.run(item.action);
        if (item.action.type === 'set_display_mode') displayMode = outcome.mode;
        revision += 1;
        completed = { actionId: item.actionId, result: outcome };
      } catch (error) { completed = { actionId: item.actionId, error: error.message }; }
      executed.set(item.actionId, completed);
      lastAction = completed;
    }
  } catch (error) {
    // Loading is not readiness; the next heartbeat retries after Mol* attaches.
    status.dataset.transportError = error.message;
  }
  setTimeout(poll, 1000);
}

app.onhostcontextchanged = context => {
  if (context.displayMode) displayMode = context.displayMode;
  window.BuretteHandleResize?.();
};
app.ontoolresult = async result => {
  if (started || !result._meta?.session) return;
  started = true;
  session = result._meta.session;
  try { await start(); } catch (error) { status.textContent = `Burette could not load: ${error.message}`; }
};
await app.connect();
