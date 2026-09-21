import { createSelectionContext } from '../../../apps/burette-public-plugin/lib/hosted-context';
import { createWorkspaceAssets } from './native-workspace-assets.mjs';
import { createWorkspaceTransport } from './native-workspace-transport.mjs';
import { prepareWorkspacePreview } from './native-workspace-preview.mjs';
import { createViewerLifetime } from './local-viewer-lifetime.mjs';
import { createWorkspacePlacement } from './native-workspace-placement.mjs';
import { createWorkspaceCheckpoint } from './native-workspace-checkpoint.mjs';
import { showWorkspaceOpening, showWorkspaceFailure } from './native-workspace-loading.mjs';

export async function startNativeWorkspace(app, initialResult) {
  const status = document.getElementById('status');
  const root = document.getElementById('root');
  root.inert = true;
  document.documentElement.dataset.theme = app.getHostContext()?.theme || 'light';
  const placement = createWorkspacePlacement(app, status);
  let session, assets, transport, checkpoint;
  let started = false;
  const paintedDocuments = new Set();
  let runtimeLoaded = false;
  let startupFailed = false;
  let latestState;
  function reveal() {
    if (!startupFailed && runtimeLoaded && latestState?.ready && !latestState.error &&
      (latestState.activeDocument?.renderer !== 'molstar' || paintedDocuments.has(latestState.activeDocument.id))) {
      root.inert = false;
      status.hidden = true;
    }
  }
  function fail(message) {
    startupFailed = true;
    root.inert = true;
    showWorkspaceFailure(status, message);
  }
  let contextSignature = '';
  let contextQueue = Promise.resolve();
  const gridSelections = new Map();
  const workers = new Set();
  const NativeWorker = window.Worker;
  class WorkspaceWorker extends NativeWorker {
    constructor(...args) { super(...args); workers.add(this); }
    terminate() { workers.delete(this); super.terminate(); }
  }
  const lifetime = createViewerLifetime({
    dispose({ terminal }) {
      placement.dispose();
      checkpoint?.dispose();
      for (const frame of document.querySelectorAll('iframe')) {
        try { void frame.contentWindow?.BuretteViewerActions?.run({ type: 'dispose_viewer' }); } catch {}
      }
      window.BuretteMcpWorkspace?.unmount?.();
      for (const worker of workers) worker.terminate();
      transport?.dispose();
      assets?.dispose();
      gridSelections.clear();
      if (terminal) for (const key of Object.keys(localStorage)) if (key.endsWith(`.mcp-${session?.sessionId}`)) localStorage.removeItem(key);
    },
    clearContext: () => contextQueue.then(() => app.updateModelContext({ content: [] })).catch(() => {}),
    persist: () => session ? exchange({ close: true }).catch(() => {}) : Promise.resolve(),
    requestTeardown: () => app.requestTeardown(),
    showClosed() {
      document.body.replaceChildren(status);
      status.hidden = false;
      status.textContent = 'Burette workspace closed.';
      document.body.dataset.closed = 'true';
      void app.sendSizeChanged({ height: 48 }).catch(() => {});
    },
  });
  async function exchange(input) {
    if (input.state) input = { ...input, state: { ...input.state, displayMode: placement.mode,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    } };
    const result = await app.callServerTool({ name: 'burette.inline_viewer_exchange', arguments: JSON.parse(JSON.stringify({ ...session, ...input })) });
    if (result.isError || !result._meta?.payload) throw new Error(result.content?.[0]?.text || 'Workspace exchange failed.');
    return result._meta.payload;
  }
  function observe(state) {
    if (lifetime.closed) return;
    if (state.closed) { void lifetime.close(); return; }
    placement.observe(state);
    latestState = state;
    reveal();
    if (state.error) fail(state.error);
    const selection = state.scene?.selection?.counts;
    const editor = state.chemicalEditor;
    const grid = gridSelections.get(state.activeDocument?.id);
    const context = selection?.atoms > 0 && state.activeDocument?.ready
      ? { ...createSelectionContext(selection, state.activeDocument.id, { kind: 'attachment', fileName: state.activeDocument.title }), presentation: { composerAttachmentLayout: 'card', composerLabel: `Burette · ${state.activeDocument.title}` } }
      : editor?.phase === 'ready' && editor.selectedAtomCount > 0
        ? { content: [{ type: 'text', text: `Burette · Ketcher. ${editor.selectedAtomCount} selected atoms in the current sketch. Atom indexes: ${editor.selectedAtoms.join(', ')}${editor.selectionTruncated ? ' (bounded sample)' : ''}.` }],
          structuredContent: { burette: { chemicalEditor: { surfaceId: editor.surfaceId, structureRevision: editor.structureRevision, selectedAtoms: editor.selectedAtoms, selectedAtomCount: editor.selectedAtomCount, selectionTruncated: editor.selectionTruncated } } },
          presentation: { composerAttachmentLayout: 'card', composerLabel: 'Burette · Ketcher selection' },
        } : state.activeDocument?.ready && grid?.selectedCount > 0
          ? { content: [{ type: 'text', text: `Burette · ${state.activeDocument.title}. ${grid.selectedCount} selected collection rows. Source indexes (zero-based): ${grid.selectedSourceIndexes.join(', ')}${grid.selectionTruncated ? ' (bounded sample)' : ''}.` }],
            structuredContent: { burette: { collectionSelection: { documentId: state.activeDocument.id, ...grid } } },
            presentation: { composerAttachmentLayout: 'card', composerLabel: `Burette · ${state.activeDocument.title}` },
          } : { content: [] };
    const signature = JSON.stringify(context);
    if (signature !== contextSignature && app.getHostCapabilities()?.updateModelContext) {
      contextSignature = signature;
      contextQueue = contextQueue.then(() => app.updateModelContext(lifetime.closed ? { content: [] } : context)).catch(() => { contextSignature = ''; });
    }
  }
  async function load(result) {
    if (started || lifetime.closed || !result._meta?.session) return;
    started = true;
    session = result._meta.session;
    try {
      const mounted = await exchange({});
      if (mounted.closed) { await lifetime.close(); return; }
      placement.update(app.getHostContext());
      // Mount where the host placed this view. Expansion is an explicit user
      // or agent action, never a startup side effect repeated after a resize.
      if (lifetime.closed) return;
      const { manifest } = await exchange({ asset: { manifest: true } });
      showWorkspaceOpening(status);
      assets = createWorkspaceAssets({ manifest, exchange, isClosed: () => lifetime.closed });
      checkpoint = await createWorkspaceCheckpoint({ exchange, sessionId: session.sessionId });
      const descriptor = { ...result.structuredContent, ...(checkpoint.restored ? { view: 'auto' } : {}), documents: mounted.documents || result.structuredContent.documents };
      transport = createWorkspaceTransport({ descriptor, assets, exchange, isClosed: () => lifetime.closed, observe,
        setDisplayMode: placement.set,
        decorateState: checkpoint.update,
      });
      window.BuretteMcpWorkspace = { ...assets, placement, sessionId: session.sessionId, get closed() { return lifetime.closed; },
        firstFrame(documentId) { if (!lifetime.closed) { paintedDocuments.add(documentId); reveal(); } },
        theme: app.getHostContext()?.theme || 'light',
        initialPaths: !checkpoint.restored && descriptor.view === 'auto' ? descriptor.documents.map(item => item.path) : [],
        restore: checkpoint.restored, storage: checkpoint.storage, authorizedPaths: descriptor.documents.map(item => item.path),
        fetch: transport.fetch, Worker: WorkspaceWorker, preparePreview: prepareWorkspacePreview,
      };
      window.fetch = transport.fetch;
      window.Worker = WorkspaceWorker;
      window.__BURETTE_WEB_ASSETS_BASE__ = '/__burette/runtime/';
      document.documentElement.dataset.theme = app.getHostContext()?.theme || 'light';
      for (const path of manifest.styles) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = await assets.asset(path);
        await new Promise((resolve, reject) => {
          link.onload = resolve;
          link.onerror = () => reject(new Error(`Could not load workspace styles: ${path}`));
          document.head.appendChild(link);
        });
      }
      if (lifetime.closed) return;
      await assets.importModule(manifest.entry);
      runtimeLoaded = true;
      if (!lifetime.closed) reveal();
    } catch (error) {
      if (lifetime.closed) return;
      fail(`Burette could not load: ${error.message}`);
      await exchange({ state: { ready: false, error: error.message } }).catch(() => {});
    }
  }
  app.onhostcontextchanged = context => {
    if (lifetime.closed) return;
    placement.update(context);
    if (context.theme === 'light' || context.theme === 'dark') {
      document.documentElement.dataset.theme = context.theme;
      if (window.BuretteMcpWorkspace) window.BuretteMcpWorkspace.theme = context.theme;
      window.dispatchEvent(new Event('burette-host-theme'));
    }
  };
  app.onteardown = async () => { await checkpoint?.flush(); await lifetime.detach(); return {}; };
  window.addEventListener('message', event => {
    if (lifetime.closed) return;
    if (![...document.querySelectorAll('iframe')].some(frame => frame.contentWindow === event.source)) return;
    if (event.data?.source === 'burette-viewer' && event.data.body?.type === 'error') {
      fail(String(event.data.body.message || 'The molecular scene could not load.').slice(0, 1000));
      return;
    }
    if (event.data?.source !== 'burette-grid' || event.data.body?.type !== 'gridMenuStateChanged') return;
    const body = event.data.body;
    if (typeof body.documentId !== 'string' || !Number.isSafeInteger(body.selectedCount) || body.selectedCount < 0) return;
    gridSelections.set(body.documentId, { selectedCount: body.selectedCount,
      selectedSourceIndexes: Array.isArray(body.selectedSourceIndexes) ? body.selectedSourceIndexes.filter(Number.isSafeInteger).slice(0, 256) : [],
      selectionTruncated: body.selectionTruncated === true || body.selectedSourceIndexes?.length > 256,
    });
    if (transport) observe(transport.state());
  });
  window.addEventListener('pagehide', event => { if (!event.persisted) void lifetime.detach(); });
  await load(initialResult);
}
