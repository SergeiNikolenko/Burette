import { createSelectionContext } from '../../../apps/burette-public-plugin/lib/hosted-context';
import { createWorkspaceAssets } from './native-workspace-assets.mjs';
import { createWorkspaceTransport } from './native-workspace-transport.mjs';
import { createWorkspaceAgent } from './native-workspace-agent.mjs';
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
  let loadingDeadline;
  function reveal() {
    if (!startupFailed && runtimeLoaded && latestState?.ready && !latestState.error &&
      (latestState.activeDocument?.renderer !== 'molstar' || paintedDocuments.has(latestState.activeDocument.id))) {
      root.inert = false;
      clearTimeout(loadingDeadline);
      status.hidden = true;
    }
  }
  function fail(message) {
    clearTimeout(loadingDeadline);
    startupFailed = true;
    root.inert = true;
    showWorkspaceFailure(status, message);
  }
  let contextSignature = '';
  let sendingAnnotations = false;
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
      clearTimeout(loadingDeadline);
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
      if (!terminal) {
        root.inert = true;
        showWorkspaceFailure(status, 'The workspace disconnected. Retry to restore this session.');
      }
      if (terminal) for (const key of Object.keys(localStorage)) if (key.endsWith(`.mcp-${session?.sessionId}`)) localStorage.removeItem(key);
    },
    clearContext: () => contextQueue.then(() => app.updateModelContext({ content: [] })).catch(() => {}),
    persist: () => session ? exchange({ close: true }).catch(() => {}) : Promise.resolve(),
    requestTeardown: () => app.requestTeardown(),
    showClosed(message = 'Burette workspace closed.') {
      document.body.replaceChildren(status);
      status.hidden = false;
      status.textContent = message;
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
    if (result._meta.payload.superseded) void lifetime.supersede();
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
    // An annotation batch owns the model context until its message is posted.
    if (sendingAnnotations || signature === contextSignature || !app.getHostCapabilities()?.updateModelContext) return;
    contextSignature = signature;
    contextQueue = contextQueue.then(() => app.updateModelContext(lifetime.closed ? { content: [] } : context)).catch(() => { contextSignature = ''; });
  }
  // Annotate mode posts its batch as one user message: the numbered comments
  // and a single marked-up frame of the view. The details ride in the batch's
  // composer card, which the host delivers with that message.
  async function sendAnnotations({ text, context, image }) {
    if (lifetime.closed) throw new Error('The workspace is closed.');
    const capabilities = app.getHostCapabilities();
    if (!capabilities?.message) throw new Error('This chat does not accept messages from the workspace.');
    const picture = image ? [{ type: 'image', data: image.data, mimeType: image.mimeType }] : [];
    // Hosts that take no images in messages still get the frame as context.
    const inMessage = Boolean(capabilities.message.image);
    sendingAnnotations = true;
    try {
      await contextQueue;
      if (capabilities.updateModelContext) {
        await app.updateModelContext(inMessage ? context : { ...context, content: [...context.content, ...picture] })
          .catch(() => app.updateModelContext(context).catch(() => {}));
      }
      const result = await app.sendMessage({ role: 'user', content: [{ type: 'text', text }, ...(inMessage ? picture : [])] });
      if (result?.isError) throw new Error('The chat rejected the annotations.');
    } finally {
      sendingAnnotations = false;
      contextSignature = '';
    }
  }
  async function load(result) {
    if (started || lifetime.closed || !result._meta?.session) return;
    started = true;
    session = result._meta.session;
    showWorkspaceOpening(status);
    loadingDeadline = setTimeout(() => {
      const error = 'Workspace loading timed out. Retry to restore this session.';
      fail(error);
      void exchange({ state: { ready: false, error } }).catch(() => {});
    }, 45000);
    try {
      const mounted = await exchange({});
      if (mounted.closed) { await lifetime.close(); return; }
      placement.update(app.getHostContext());
      // Apply the opener's requested placement once, never again on resize.
      if (result.structuredContent?.requestedDisplayMode === 'fullscreen' && placement.mode !== 'fullscreen') {
        await placement.set('fullscreen');
      }
      if (lifetime.closed) return;
      const { manifest } = await exchange({ asset: { manifest: true } });
      showWorkspaceOpening(status);
      assets = createWorkspaceAssets({ manifest, exchange, isClosed: () => lifetime.closed });
      checkpoint = await createWorkspaceCheckpoint({ exchange, sessionId: session.sessionId });
      const descriptor = { ...result.structuredContent, ...(checkpoint.restored ? { view: 'auto' } : {}), documents: mounted.documents || result.structuredContent.documents };
      const agent = createWorkspaceAgent({ displayMode: () => placement.mode });
      if (descriptor.view === 'xyzrender') agent.request(descriptor.documents.map(item => item.path), 'xyzrender');
      transport = createWorkspaceTransport({ descriptor, assets, exchange, isClosed: () => lifetime.closed, observe,
        setDisplayMode: placement.set,
        decorateState: state => checkpoint.update(agent.decorate(state)),
        agent,
        // Added files follow the requested view, defaulting to the opener's.
        prepareOpen(paths, view = result.structuredContent?.view === 'xyzrender' ? 'xyzrender' : 'auto') {
          const workspace = window.BuretteMcpWorkspace;
          if (view === 'xyzrender') {
            if (workspace.initialRenderer !== 'xyzrender-external') Object.assign(workspace, { initialRenderer: 'xyzrender-external', initialPaths: [] });
            workspace.initialPaths = [...new Set([...workspace.initialPaths, ...paths])];
          } else workspace.initialPaths = workspace.initialPaths.filter(path => !paths.includes(path));
          agent.request(paths, view);
        },
      });
      window.BuretteMcpWorkspace = { ...assets, placement, sessionId: session.sessionId, get closed() { return lifetime.closed; },
        firstFrame(documentId) { if (!lifetime.closed) { paintedDocuments.add(documentId); reveal(); } },
        theme: app.getHostContext()?.theme || 'light',
        initialPaths: !checkpoint.restored && ['auto', 'xyzrender'].includes(descriptor.view) ? descriptor.documents.map(item => item.path) : [],
        initialRenderer: descriptor.view === 'xyzrender' ? 'xyzrender-external' : undefined,
        restore: checkpoint.restored, storage: checkpoint.storage, authorizedPaths: descriptor.documents.map(item => item.path),
        fetch: transport.fetch, Worker: WorkspaceWorker, preparePreview: prepareWorkspacePreview, sendAnnotations,
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
