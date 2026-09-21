const textEncoder = new TextEncoder();
const snapshotOptions = { data: true, behavior: false, animation: false, startAnimation: false, structureSelection: true, componentManager: true, camera: true, cameraTransition: { name: 'instant', params: {} }, canvas3d: true, canvas3dContext: false, interactivity: true, image: false };

export async function createWorkspaceCheckpoint({ exchange, sessionId }) {
  const stored = await exchange({ checkpoint: { key: 'workspace' } });
  // Native hosts may omit null-valued metadata fields: { value: null } arrives
  // as {} on the first mount. A heartbeat response is still a protocol error,
  // not an empty checkpoint; never discard a nonempty unexpected response.
  if (!stored || Array.isArray(stored) || typeof stored !== 'object'
    || (!Object.hasOwn(stored, 'value') && Object.keys(stored).length > 0)
    || (stored.value != null && typeof stored.value !== 'string')) {
    throw new Error('Unexpected workspace restoration response. Reload the existing Burette pane.');
  }
  const values = stored.value ? JSON.parse(stored.value) : {};
  const restored = Boolean(values[`burette.molecule.session.mcp-${sessionId}`]);
  const frames = new Map();
  let initialized = restored;
  let timer, pending = Promise.resolve(), disposed = false, warning = null;
  function report(error) { warning = String(error?.message || error).slice(0, 256); }
  function saveWorkspace() {
    clearTimeout(timer);
    if (!initialized) return pending;
    const value = JSON.stringify(values);
    pending = pending.catch(() => {}).then(() => exchange({ checkpoint: { key: 'workspace', value } })).catch(report);
    return pending;
  }
  const storage = {
    getItem: key => values[key] ?? null,
    setItem(key, value) { values[key] = value; clearTimeout(timer); timer = setTimeout(saveWorkspace, 200); },
    removeItem(key) { delete values[key]; clearTimeout(timer); timer = setTimeout(saveWorkspace, 200); },
  };
  async function sync(frame, record) {
    if (disposed || record.busy || !frame.isConnected) return;
    const plugin = frame.contentWindow?.BuretteViewer?.plugin;
    if (!plugin?.canvas3d || !plugin.managers.structure.hierarchy.current.structures.length || plugin.behaviors.state.isBusy.value) return;
    if (record.plugin !== plugin) { record.plugin = plugin; record.restored = false; record.signature = null; }
    record.busy = true;
    try {
      record.key ||= [...new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(record.path)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (!record.restored) {
        const saved = await exchange({ checkpoint: { key: record.key } });
        if (disposed || !frame.isConnected) return;
        if (saved.value) {
          const bytes = Uint8Array.from(atob(saved.value), character => character.charCodeAt(0));
          const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
          const snapshot = JSON.parse(await new Response(stream).text());
          await plugin.state.setSnapshot(snapshot);
          frame.contentWindow?.postMessage?.({ source: 'burette-host', body: { type: 'setViewerTheme', value: window.BuretteMcpWorkspace?.theme || 'light' } }, '*');
        }
        record.restored = true;
      }
      // Mol* creates a fresh snapshot id even when nothing changed. Exclude it
      // from the equality key so observation does not rewrite unchanged scenes.
      const snapshot = plugin.state.getSnapshot(snapshotOptions);
      snapshot.id = 'burette-resume';
      const serialized = JSON.stringify(snapshot);
      if (serialized === record.signature) return;
      if (textEncoder.encode(serialized).length > 16 * 1024 * 1024) throw new Error('Scene is too large to checkpoint (16 MiB).');
      const bytes = new Uint8Array(await new Response(new Blob([serialized]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      if (bytes.length > 512 * 1024) throw new Error('Compressed scene is too large to checkpoint (512 KiB).');
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
      await exchange({ checkpoint: { key: record.key, value: btoa(binary) } });
      record.signature = serialized;
      record.savedAt = new Date().toISOString();
    } catch (error) { report(error); record.restored = true; }
    finally { record.busy = false; }
  }
  function update(state) {
    if (disposed) return state;
    if (state.ready && !initialized) { initialized = true; void saveWorkspace(); }
    const active = state.activeDocument;
    const activeFrame = active?.path ? [...document.querySelectorAll('iframe.viewer-iframe[data-document-id]')].find(frame => frame.dataset.documentId === active.id) : null;
    if (active?.ready && activeFrame && frames.get(activeFrame)?.path !== active.path) frames.set(activeFrame, { path: active.path, restored: false });
    for (const [frame, record] of frames) {
      if (!frame.isConnected) { frames.delete(frame); continue; }
      if (!record.busy) record.pending = sync(frame, record);
    }
    const record = frames.get(activeFrame);
    const restoring = active?.renderer === 'molstar' && record && !record.restored;
    return { ...state, ready: state.ready && !restoring, persistence: { restoring: Boolean(restoring), savedAt: record?.savedAt || null, warning } };
  }
  return { storage, restored, update, async flush() {
      await Promise.all([...frames].map(([frame, record]) => record.busy ? record.pending : sync(frame, record)));
      await saveWorkspace();
    },
    dispose() { disposed = true; clearTimeout(timer); frames.clear(); },
  };
}
