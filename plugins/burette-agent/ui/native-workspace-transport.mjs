const json = (value, status = 200) => Response.json(value, { status });

export function createWorkspaceTransport({ descriptor, assets, exchange, isClosed, observe, setDisplayMode, decorateState = value => value }) {
  const originals = window.fetch.bind(window);
  const startupIds = new Set();
  const sources = new Map();
  let latest = {};
  let initialAction = descriptor.view === 'ketcher' ? { type: 'open_ketcher' }
    : descriptor.view === 'docking' ? { type: 'open_docking_view', receptorPath: descriptor.documents[0].path, ligandPaths: descriptor.documents.slice(1).map(item => item.path) } : null;
  let pendingStartup;
  let seeded = descriptor.view !== 'ketcher';
  let startupError;
  function documentFor(path) {
    const item = descriptor.documents.find(item => item.path === path);
    if (!item) throw new Error('File is not authorized for this workspace.');
    return item;
  }
  function source(item) {
    // Session snapshots are immutable and bounded to 8 files / 16 MiB total.
    // Share concurrent reads and retain verified bytes across tab revisits.
    if (!sources.has(item.id)) sources.set(item.id, readSource(item).catch(error => {
      sources.delete(item.id);
      throw error;
    }));
    return sources.get(item.id);
  }
  async function readSource(item) {
    const bytes = new Uint8Array(item.byteCount);
    let offset = 0;
    do {
      if (isClosed()) throw new Error('Workspace is closed.');
      const part = await exchange({ source: true, documentId: item.id, offset });
      if (isClosed() || part.closed) throw new Error('Workspace is closed.');
      const chunk = Uint8Array.from(atob(part.dataBase64), c => c.charCodeAt(0));
      if (chunk.length > 192 * 1024 || !chunk.length || offset + chunk.length > bytes.length) throw new Error('Invalid document chunk size.');
      bytes.set(chunk, offset);
      const end = offset + chunk.length;
      if (part.nextOffset != null && part.nextOffset !== end) throw new Error('Invalid document continuation.');
      if (part.nextOffset == null && end !== item.byteCount) throw new Error('Incomplete document source.');
      offset = part.nextOffset;
    } while (offset != null);
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    if (digest !== item.sha256) throw new Error('Document source integrity check failed.');
    return bytes;
  }
  function state() {
    const active = latest.activeDocument?.path ? latest.activeDocument : null;
    return decorateState({ ...latest, mode: 'native-mcp-workspace', transport: 'mcp-app',
      capabilities: { addFiles: true },
      ready: !initialAction && !pendingStartup && seeded && !startupError && Boolean(active?.ready || latest.activeSurface?.ready),
      ...(startupError ? { error: startupError } : {}),
      activeDocument: active ? { ...active, id: latest.viewerAgent?.documentId } : null,
      selection: latest.scene?.selection?.counts ?? null,
      revision: latest.chemicalEditor?.structureRevision ?? 0,
    });
  }
  const tabOperations = { activate_tab: 'focus', close_tab: 'close', move_tab: 'move', close_other_tabs: 'close_others', close_all_tabs: 'close_all' };
  async function actions() {
    if (initialAction) {
      const id = crypto.randomUUID();
      startupIds.add(id);
      pendingStartup = { id, action: initialAction, status: 'queued' };
      initialAction = null;
    }
    if (!pendingStartup && !seeded && latest.chemicalEditor?.phase === 'ready') {
      seeded = true;
      const item = descriptor.documents[0];
      const text = new TextDecoder().decode(await source(item));
      const format = ['smi', 'smiles'].includes(item.format) ? 'smiles' : item.format === 'ket' ? 'ket' : 'mol';
      const content = format === 'mol' ? text.split('$$$$')[0].trimEnd() : text;
      if (new TextEncoder().encode(content).length > 65536) throw new Error('Ketcher seed exceeds 64 KiB.');
      const id = crypto.randomUUID();
      startupIds.add(id);
      pendingStartup = { id, status: 'queued', action: { type: 'control_ketcher', apiVersion: 'burette-ketcher-agent/v1', actionId: id,
        surfaceId: latest.chemicalEditor.surfaceId, expectedRevision: latest.chemicalEditor.structureRevision,
        command: 'set_structure', format, content,
      } };
    }
    if (pendingStartup) return [pendingStartup];
    // Checkpoint restoration can settle without another renderer observation.
    // Keep the local loading cover and the host on the same fresh snapshot.
    const current = state();
    observe(current);
    const reply = await exchange({ state: current });
    if (reply.closed) { observe({ closed: true }); return []; }
    if (reply.documents) descriptor.documents = reply.documents;
    const queued = [];
    for (const item of reply.actions || []) {
      if (item.action.type === 'set_display_mode') {
        await exchange({ completed: { actionId: item.actionId, result: await setDisplayMode(item.action.mode) } });
      } else if (item.action.type === 'open_files') {
        const paths = item.action.paths.filter(path => !latest.tabs?.some(tab => tab.path === path));
        const existing = latest.tabs?.find(tab => tab.path === item.action.paths[0]);
        queued.push({ id: item.actionId, status: 'queued', action: paths.length
          ? { ...item.action, paths }
          : { type: 'manage_tabs', operation: 'focus', tabId: existing.id } });
      } else if (!tabOperations[item.action.type] && !['manage_tabs', 'open_ketcher', 'open_files', 'open_docking_view'].includes(item.action.type)
        && item.documentId !== state().activeDocument?.id) {
        await exchange({ completed: { actionId: item.actionId, error: 'The active document changed before execution.', result: { ok: false, error: { code: 'STALE_TARGET', message: 'Observe the active document again.' } } } });
      } else queued.push({ id: item.actionId, status: 'queued', action: tabOperations[item.action.type]
        ? { ...item.action, type: 'manage_tabs', operation: tabOperations[item.action.type], tabId: item.action.tabId || latest.activeTabId } : item.action });
    }
    return queued;
  }
  async function request(input, init = {}) {
    if (isClosed()) throw new Error('Workspace is closed.');
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (raw.startsWith('blob:') || raw.startsWith('data:')) return originals(input, init);
    const url = new URL(raw, 'https://burette.invalid/');
    const path = url.pathname;
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const body = () => JSON.parse(typeof init.body === 'string' ? init.body : '{}');
    if (url.origin !== 'https://burette.invalid' && url.origin !== location.origin) throw new Error('Network access is not enabled in this workspace.');
    if (path.startsWith('/__burette/runtime/') || path.startsWith('/shell/')) return assets.response(assets.resolve(url.href.replace(url.origin, '')));
    if (path === '/__burette/rdkit-wasm') return assets.response('runtime/rdkit/RDKit_minimal.wasm');
    if (path === '/__burette/trajectory-pair') return json({ error: 'No implicit trajectory pairing in an explicit native workspace.' }, 404);
    if (path === '/__burette/read-file' || path.startsWith('/@fs/') || path === '/__burette/read-text-file') {
      const item = documentFor(path.startsWith('/@fs/') ? decodeURIComponent(path.slice(4)) : url.searchParams.get('path'));
      const bytes = await source(item);
      if (path === '/__burette/read-text-file') return json({ id: item.id, path: item.path, title: item.label, extension: item.format, language: 'text', content: new TextDecoder().decode(bytes), byteCount: bytes.length, truncated: false, modifiedAt: null });
      return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'X-Burette-Source-Bytes': String(bytes.length) } });
    }
    if (path === '/__burette/file-action') {
      const action = body();
      return json(await exchange({ fileAction: { type: action.type, documentId: documentFor(action.path).id, targetId: action.targetId } }));
    }
    if (path === '/__burette/xyzrender') {
      const { path: inputPath, inputDataBase64, inputExtension, preset, orientationRef, activeModel, controls } = body();
      const documentId = inputDataBase64 ? undefined : documentFor(inputPath).id;
      return json(await exchange({ xyzrender: { documentId, inputDataBase64, inputExtension, preset, orientationRef, activeModel, controls } }));
    }
    if (path === '/__burette/dev-files') return json({ files: descriptor.documents.map(item => item.path), truncated: false, scannedEntries: descriptor.documents.length, scannedDirectories: 0 });
    if (path === '/__burette/agent-session/observe.json') {
      if (method === 'PUT') { latest = body(); observe(state()); }
      return json(state());
    }
    if (path === '/__burette/agent-session/actions.json') {
      if (method === 'GET') return json({ actions: await actions() });
      for (const item of body().actions || []) {
        if (!['completed', 'failed'].includes(item.status)) continue;
        if (startupIds.has(item.id)) {
          pendingStartup = null;
          if (item.status === 'failed') {
            startupError = item.result?.error?.message || 'Workspace initialization failed.';
            observe(state());
          }
        } else await exchange({ completed: { actionId: item.id, result: item.result, ...(item.status === 'failed' ? { error: item.result?.error?.message || 'Workspace action failed.' } : {}) } });
      }
      return json({ ok: true });
    }
    return json({ error: `This operation is not available in the native workspace: ${path}` }, 404);
  }
  return { fetch: (input, init) => request(input, init).catch(error => json({ error: error.message }, 400)), state,
    dispose() { latest = {}; initialAction = null; pendingStartup = null; startupIds.clear(); sources.clear(); },
  };
}
