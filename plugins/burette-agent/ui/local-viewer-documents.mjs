const tabActions = new Set(['activate_tab', 'close_tab', 'close_other_tabs', 'close_all_tabs', 'move_tab']);

/** Native document lifecycle: one renderer, lazy source reads, retained scene state. */
export function createViewerDocuments({ documents, exchange, changed }) {
  const available = new Map(documents.map(document => [document.id, document]));
  let tabs = [...documents];
  let activeId = tabs[0]?.id || null;
  let busy = false;
  const loaded = new Map();
  let disposed = false;

  function requireOpen() {
    if (disposed) throw new Error('Viewer is closed.');
  }

  async function source(id) {
    requireOpen();
    if (loaded.has(id)) return loaded.get(id);
    if (!available.has(id)) throw new Error('Unknown document tab.');
    let offset = 0;
    let document;
    do {
      const payload = await exchange({ source: true, documentId: id, offset });
      requireOpen();
      if (payload.closed) throw new Error('Viewer is closed.');
      if (!document) document = { config: payload.config, bytes: new Uint8Array(payload.config.byteCount) };
      document.bytes.set(Uint8Array.from(atob(payload.dataBase64), c => c.charCodeAt(0)), offset);
      offset = payload.nextOffset ?? null;
    } while (offset !== null);
    loaded.set(id, document);
    return document;
  }

  async function activate(id) {
    requireOpen();
    if (!available.has(id)) throw new Error('Unknown document tab.');
    if (id === activeId && tabs.some(tab => tab.id === id)) return;
    if (busy) throw new Error('A document switch is already in progress.');
    busy = true;
    changed();
    const previousId = activeId;
    const previous = loaded.get(previousId);
    let replacing = false;
    try {
      const next = await source(id);
      if (previous) {
        const snapshot = window.BuretteViewer.plugin.state.getSnapshot({ data: true, structureSelection: true, camera: true, canvas3d: true, cameraTransition: { name: 'instant' } });
        const snapshotBytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
        const retainedBytes = [...loaded.entries()].reduce((sum, [key, value]) => sum + (key === previousId ? 0 : value.snapshotBytes || 0), snapshotBytes);
        if (retainedBytes > 48 * 1024 * 1024) throw new Error('Retained tab scenes exceed 48 MiB. Close unused tabs before switching.');
        previous.snapshot = snapshot;
        previous.snapshotBytes = snapshotBytes;
        previous.config = { ...window.BuretteConfig };
      }
      replacing = true;
      const outcome = await window.BuretteViewerActions.run({ type: 'replace_document', ...next });
      requireOpen();
      if (!outcome?.ok) throw new Error(outcome?.error?.message || 'The document could not be rendered.');
      activeId = id;
      if (!tabs.some(tab => tab.id === id)) tabs.push(available.get(id));
    } catch (error) {
      if (!disposed && replacing && previous?.snapshot) {
        try {
          const restored = await window.BuretteViewerActions.run({ type: 'replace_document', ...previous });
          if (!restored?.ok) throw new Error('Scene restoration failed.');
        } catch (restoreError) {
          activeId = null;
          throw new Error(`${error.message} Previous scene could not be restored: ${restoreError.message}`);
        }
      }
      throw error;
    } finally { busy = false; changed(); }
  }

  async function act(action) {
    requireOpen();
    if (!tabActions.has(action.type)) throw new Error('Unsupported tab action.');
    if (busy) throw new Error('A document switch is already in progress.');
    const id = action.tabId || activeId;
    if (action.type === 'activate_tab') await activate(id);
    else if (action.type === 'move_tab') {
      const index = tabs.findIndex(tab => tab.id === id);
      if (index < 0 || !Number.isInteger(action.toIndex) || action.toIndex < 0 || action.toIndex >= tabs.length) throw new Error('Invalid tab move.');
      tabs.splice(action.toIndex, 0, ...tabs.splice(index, 1));
    } else {
      if (action.type !== 'close_all_tabs' && !tabs.some(tab => tab.id === id)) throw new Error('Unknown open tab.');
      const keep = action.type === 'close_tab' ? tabs.filter(tab => tab.id !== id)
        : action.type === 'close_other_tabs' ? tabs.filter(tab => tab.id === id) : [];
      if (keep.length && !keep.some(tab => tab.id === activeId)) await activate(keep[0].id);
      if (!keep.length) {
        await window.BuretteViewerActions.run({ type: 'dispose_viewer' });
        activeId = null;
      }
      for (const tab of tabs) if (!keep.some(item => item.id === tab.id)) loaded.delete(tab.id);
      tabs = keep;
    }
    changed();
    return { ok: true, command: action.type, result: { tabs, activeId } };
  }

  return {
    get tabs() { return tabs; },
    get activeId() { return activeId; },
    get busy() { return busy; },
    get closed() { return documents.filter(document => !tabs.some(tab => tab.id === document.id)); },
    handles: type => tabActions.has(type),
    source,
    activate,
    act,
    dispose() {
      disposed = true;
      tabs = [];
      activeId = null;
      loaded.clear();
    },
  };
}
