import { renderViewerHeader, disposeViewerHeader } from './local-viewer-header';
import { createLocalViewerContext } from './local-viewer-context';
import { createViewerDocuments } from './local-viewer-documents.mjs';
import { renderViewerTabs, disposeViewerTabs } from './local-viewer-tabs';
import { createViewerLifetime } from './local-viewer-lifetime.mjs';

export async function startLocalViewer(app, initialResult) {
  let session;
  let started = false;
  let displayMode = 'inline';
  let revision = 0;
  let lastAction = null;
  let completed = null;
  const executed = new Map();
  const status = document.getElementById('status');
  let displayPending = false;
  let selection = null;
  let contextSignature = '';
  let requestedDisplayMode = 'inline';
  let initialDisplayRequested = false;
  let summaryCache;
  let summaryStructures = [];
  let documents;
  let documentCatalog = [];
  let viewerInitialized = false;
  const assetUrls = [];
  const lifetime = createViewerLifetime({
    dispose: () => {
      documents?.dispose();
      selection = null;
      summaryCache = undefined;
      summaryStructures = [];
      window.BuretteViewerDisposed = true;
      void window.BuretteViewerActions?.run({ type: 'dispose_viewer' });
      window.BuretteDataBytes = null;
      window.BuretteDataBase64 = null;
      for (const url of assetUrls) URL.revokeObjectURL(url);
      assetUrls.length = 0;
    },
    clearContext: () => app.updateModelContext({ content: [] }).catch(() => {}),
    persist: () => session ? exchange({ close: true }).catch(() => {}) : Promise.resolve(),
    requestTeardown: () => app.requestTeardown(),
    showClosed: (message = 'Burette viewer closed.') => {
      document.body.dataset.empty = 'true';
      document.body.dataset.closed = 'true';
      disposeViewerHeader();
      disposeViewerTabs();
      document.body.replaceChildren(status);
      status.className = '';
      status.textContent = message;
      void app.sendSizeChanged({ height: 48 }).catch(() => {});
    },
  });

  async function requestInitialPlacement() {
    if (initialDisplayRequested) return;
    initialDisplayRequested = true;
    if (requestedDisplayMode !== displayMode) {
      if (app.getHostContext()?.availableDisplayModes?.includes(requestedDisplayMode)) {
        try { displayMode = (await app.requestDisplayMode({ mode: requestedDisplayMode })).mode; }
        catch (error) { status.textContent = `Could not open the side pane: ${error.message}`; }
      } else {
        status.textContent = 'This host does not support the requested side-pane display mode.';
      }
    }
    updateHeader();
    // Do not reserve a blank molecular canvas in chat while the side pane opens.
    if (displayMode === 'inline') await app.sendSizeChanged({ height: requestedDisplayMode === 'inline' ? 520 : 48 });
  }

  window.addEventListener('burette-selection-changed', event => {
    if (lifetime.closed) return;
    selection = event.detail.selection;
    revision += 1;
  });

  function updateHeader() {
    if (lifetime.closed) return;
    document.body.dataset.displayMode = displayMode;
    document.body.dataset.empty = String(Boolean(documents && !documents.activeId));
    if (documents) renderViewerTabs({ tabs: documents.tabs, closed: documents.closed, activeId: documents.activeId, busy: documents.busy || !viewerInitialized, act: action => {
      void (async () => {
        if (action.type === 'inspect_tab') {
          const document = documentCatalog.find(item => item.id === action.tabId);
          await window.BuretteViewerActions.run({ type: 'render_panel', panel: { kind: 'markdown', title: document.label,
            content: `Path: ${document.path || document.label}\nFormat: ${document.format}\nSize: ${document.byteCount} bytes\nSHA-256: ${document.sha256 || 'unavailable'}` } });
        } else {
          await documents.act(action);
          if (!documents.activeId) await lifetime.close({ notifyHost: true });
        }
      })().catch(error => { status.classList.remove('hidden'); status.textContent = error.message; });
    } });
    renderViewerHeader({
      expanded: displayMode === 'fullscreen',
      canExpand: !displayPending && Boolean(app.getHostContext()?.availableDisplayModes?.includes(displayMode === 'inline' ? 'fullscreen' : 'inline')),
      onToggle: async () => {
        displayPending = true;
        updateHeader();
        try {
          const result = await app.requestDisplayMode({ mode: displayMode === 'inline' ? 'fullscreen' : 'inline' });
          displayMode = result.mode;
          revision += 1;
        } catch (error) { status.classList.remove('hidden'); status.textContent = error.message; }
        finally { displayPending = false; updateHeader(); window.BuretteHandleResize?.(); }
      },
    });
  }

  async function exchange(input) {
    let result;
    try {
      // Viewer results contain optional undefined fields; native proxies require JSON values.
      const args = JSON.parse(JSON.stringify({ ...session, ...input }));
      result = await app.callServerTool({ name: 'burette.inline_viewer_exchange', arguments: args });
    } catch (error) {
      throw new Error(`${input.source ? `Source chunk at byte ${input.offset ?? 0}` : 'Viewer state exchange'}: ${error.message}`);
    }
    if (result.isError || !result._meta?.payload) throw new Error(result.content?.[0]?.text || 'Local viewer exchange failed.');
    if (result._meta.payload.superseded) void lifetime.supersede();
    return result._meta.payload;
  }

  async function loadScript(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const failed = event => {
          window.removeEventListener('error', failed);
          reject(new Error(`${name}: ${event.error?.stack || event.message || 'Bundled viewer script failed to load.'}`));
        };
        window.addEventListener('error', failed);
        script.src = url;
        script.onload = () => { window.removeEventListener('error', failed); resolve(); };
        script.onerror = failed;
        document.body.appendChild(script);
      });
    } finally { URL.revokeObjectURL(url); }
  }

  async function start() {
    // Authoritative session state is checked before inflating any renderer assets.
    const mounted = await exchange({});
    if (mounted.closed || lifetime.closed) { await lifetime.close(); return; }
    await requestInitialPlacement();
    if (lifetime.closed) return;
    const assetElement = document.getElementById('burette-assets');
    const packed = Uint8Array.from(atob(assetElement.textContent), c => c.charCodeAt(0));
    assetElement.remove();
    const assets = JSON.parse(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
    const initial = await documents.source(documents.activeId);
    if (lifetime.closed) return;
    window.BuretteDataBytes = initial.bytes;
    window.BuretteConfig = initial.config;
    window.BuretteConfig.theme = app.getHostContext()?.theme || 'light';
    document.documentElement.dataset.theme = window.BuretteConfig.theme;
    updateHeader();
    for (const name of ['molstar.css', 'viewer-runtime.css']) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = URL.createObjectURL(new Blob([assets[name]], { type: 'text/css' }));
      assetUrls.push(link.href);
      if (name === 'molstar.css') window.BuretteMolstarCSSURL = link.href;
      document.head.appendChild(link);
      delete assets[name];
    }
    for (const name of ['molstar.js', 'viewer-shell.js', 'burette-agent.js', 'trajectory-smoothing.js', 'molstar-preset-preview-controller.js', 'superposition-panel.js', 'viewer.js']) {
      if (lifetime.closed) return;
      await loadScript(name, assets[name]);
      delete assets[name];
    }
    await poll();
  }

  async function poll() {
    if (lifetime.closed) return;
    let nextDelay = document.hidden ? 5000 : 1000;
    try {
      const plugin = window.BuretteViewer?.plugin;
      const structures = plugin?.managers.structure.hierarchy.current.structures.map(entry => entry.cell.obj?.data) || [];
      if (documents.busy || !documents.activeId) summaryCache = { ok: false, result: null };
      else if (!summaryCache?.ok || structures.length !== summaryStructures.length || structures.some((value, index) => value !== summaryStructures[index])) {
        summaryCache = await window.BuretteAgent.run({ command: 'summary' });
        summaryStructures = structures;
      }
      const summary = summaryCache;
      const ready = Boolean(documents.activeId && !documents.busy && summary.ok === true && summary.result?.counts?.atoms > 0);
      viewerInitialized ||= ready;
      updateHeader();
      const scene = ready ? (await window.BuretteViewerActions.run({ type: 'observe_scene' })).result : null;
      if (lifetime.closed) return;
      const context = createLocalViewerContext({ selection, sessionId: session.sessionId, summary: summary.result,
        scene: { ...scene, displayMode, motion: scene?.motion?.name } });
      context.structuredContent.burette.documentId = documents.activeId;
      if (!documents.activeId) context.content = [{ type: 'text', text: 'Burette: no open documents. No active molecular selection or scene.' }];
      // Observation remains available without attaching an unselected document
      // to the composer. Empty content also clears a previous selection card.
      const activeSelection = context.structuredContent.burette.activeSelection;
      const modelContext = ready && activeSelection?.atoms > 0 ? context : { content: [] };
      const signature = JSON.stringify(modelContext);
      if (signature !== contextSignature && app.getHostCapabilities()?.updateModelContext) {
        try {
          await app.updateModelContext(modelContext);
          if (lifetime.closed) { await app.updateModelContext({ content: [] }); return; }
          contextSignature = signature;
          delete status.dataset.contextError;
        } catch (error) { status.dataset.contextError = error.message; }
      }
      const actionState = lastAction && new TextEncoder().encode(JSON.stringify(lastAction)).byteLength > 8 * 1024
        ? { actionId: lastAction.actionId, error: lastAction.error, result: { ok: lastAction.result?.ok, command: lastAction.result?.command }, truncated: true }
        : lastAction;
      const active = documents.tabs.find(tab => tab.id === documents.activeId);
      const state = { ready, revision, displayMode, activeDocument: active ? { ...active, ready } : null, tabs: documents.tabs, closedTabs: documents.closed, selection: context.structuredContent.burette.activeSelection, counts: summary.result?.counts || null, camera: plugin?.canvas3d?.camera?.getSnapshot(), scene: context.structuredContent.burette.scene, lastAction: actionState };
      const result = await exchange({ state, ...(completed ? { completed } : {}) });
      if (result.closed || lifetime.closed) { await lifetime.close(); return; }
      delete status.dataset.transportError;
      completed = null;
      for (const item of result.actions) {
        if (lifetime.closed) return;
        if (executed.has(item.actionId)) { completed = executed.get(item.actionId); continue; }
        try {
          if (documents.busy) throw new Error('A document switch is already in progress.');
          if (!documents.handles(item.action.type) && item.documentId && item.documentId !== documents.activeId) throw new Error('The active document changed; observe the workspace before retrying.');
          displayPending = item.action.type === 'set_display_mode';
          const outcome = item.action.type === 'set_display_mode'
            ? await app.requestDisplayMode({ mode: item.action.mode })
            : documents.handles(item.action.type) ? await documents.act(item.action)
            : await window.BuretteViewerActions.run(item.action);
          if (item.action.type === 'set_display_mode') displayMode = outcome.mode;
          if (outcome.ok === false) completed = { actionId: item.actionId, result: outcome, error: outcome.error?.message || 'Viewer action failed.' };
          else {
            revision += 1;
            completed = { actionId: item.actionId, result: outcome };
          }
        } catch (error) { completed = { actionId: item.actionId, error: error.message }; }
        finally { displayPending = false; }
        executed.set(item.actionId, completed);
        lastAction = completed;
      }
      if (!documents.activeId) {
        // Acknowledge the last close action before terminating its transport.
        await exchange({ ...(completed ? { completed } : {}) });
        await lifetime.close({ notifyHost: true });
        return;
      }
      if (completed) nextDelay = 0;
    } catch (error) {
      // Loading is not readiness; the next heartbeat retries after Mol* attaches.
      status.dataset.transportError = error.message;
      updateHeader();
    }
    // Acknowledge an executed action immediately, rather than waiting a heartbeat.
    lifetime.schedule(poll, nextDelay);
  }

  app.onhostcontextchanged = context => {
    if (lifetime.closed) return;
    if (context.displayMode) displayMode = context.displayMode;
    if (context.theme) {
      document.documentElement.dataset.theme = context.theme;
      window.postMessage({ source: 'burette-host', body: { type: 'setViewerTheme', value: context.theme } }, '*');
    }
    updateHeader();
    window.BuretteHandleResize?.();
  };
  async function load(result) {
    if (started || lifetime.closed || !result._meta?.session) return;
    started = true;
    session = result._meta.session;
    const hasDocumentIds = Boolean(result.structuredContent?.documents?.length);
    documentCatalog = result.structuredContent?.documents || [{ ...result.structuredContent, id: session.sessionId }];
    documents = createViewerDocuments({ documents: documentCatalog, exchange: input => exchange({ ...input, ...(!hasDocumentIds ? { documentId: undefined } : {}) }), changed: () => {
      if (lifetime.closed) return;
      revision += 1;
      summaryCache = undefined;
      if (documents.busy || !documents.activeId) selection = null;
      document.getElementById('app').hidden = !documents.activeId;
      if (!documents.activeId) { status.classList.remove('hidden'); status.textContent = 'No open documents. Use + to reopen a tab.'; }
      updateHeader();
    } });
    requestedDisplayMode = result.structuredContent?.requestedDisplayMode || 'inline';
    try { await start(); } catch (error) {
      if (lifetime.closed) return;
      status.classList.remove('hidden');
      status.textContent = `Burette could not load: ${error.message}`;
      await exchange({ state: { ready: false, revision, displayMode, error: error.message } }).catch(() => {});
    }
  }
  app.onteardown = async () => { await lifetime.detach(); return {}; };
  window.addEventListener('pagehide', event => { if (!event.persisted) void lifetime.detach(); });
  await load(initialResult);
}
