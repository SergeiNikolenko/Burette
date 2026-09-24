// Agent-facing behaviour the shared desktop shell does not provide inside the
// native widget: xyzrender observation, capture and control, and measured dock
// visibility. The transport injects this object; it never talks to the host.
const molstarOnly = new Set(['focus_ligand', 'select_residues', 'focus_selection', 'reset_camera', 'clear_selection', 'set_molstar_style', 'color_by_chain', 'set_scene_motion', 'set_scene_wiggle', 'rotate_camera', 'query_atoms', 'query_groups', 'named_selection', 'select_atoms', 'measure_geometry', 'list_scene_layers', 'patch_scene_layers']);
const maxCaptureSide = 1024;
const maxCaptureBytes = 1024 * 1024;
const renderTimeoutMs = 30000;

const done = (command, result) => ({ status: 'completed', result: { ok: true, command, result } });
const failure = (command, code, message, details) => ({ status: 'failed', result: { ok: false, command, error: { code, message, ...(details ? { details } : {}) } } });

// Size of the root <svg> element in CSS pixels, from width/height or viewBox.
export function svgSize(svg) {
  const tag = /<svg\b[^>]*>/iu.exec(svg)?.[0] || '';
  const attribute = name => new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'iu').exec(tag)?.[1]?.trim();
  const length = value => /^\d+(?:\.\d+)?(?:px)?$/u.test(value || '') ? Number.parseFloat(value) : 0;
  const box = attribute('viewBox')?.split(/[\s,]+/u).map(Number);
  const width = length(attribute('width')) || (box?.length === 4 ? box[2] : 0);
  const height = length(attribute('height')) || (box?.length === 4 ? box[3] : 0);
  return { svgBytes: new TextEncoder().encode(svg).length, width: Math.round(width) || null, height: Math.round(height) || null };
}

// Vector output is drawn at up to 1024 px per side on white, then reduced
// until the PNG fits the 1 MiB capture limit.
async function rasterizeSvg(svg) {
  const size = svgSize(svg);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The SVG could not be decoded.'));
      image.src = url;
    });
    const width = size.width || image.naturalWidth || maxCaptureSide;
    const height = size.height || image.naturalHeight || maxCaptureSide;
    const scale = Math.min(maxCaptureSide / width, maxCaptureSide / height);
    for (const factor of [1, 0.75, 0.5, 0.35]) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.min(maxCaptureSide, Math.floor(width * scale * factor)));
      canvas.height = Math.max(1, Math.min(maxCaptureSide, Math.floor(height * scale * factor)));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUri = canvas.toDataURL('image/png');
      const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
      if (Math.floor(base64.length * 3 / 4) <= maxCaptureBytes) return { dataUri, width: canvas.width, height: canvas.height };
    }
    throw new Error('The rendered PNG exceeds 1 MiB even at reduced size.');
  } finally { URL.revokeObjectURL(url); }
}

export function createWorkspaceAgent({ root = document, displayMode = () => null, rasterize = rasterizeSvg, now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const renders = new Map();
  const requested = new Set();
  let serial = 0;

  async function until(condition, timeoutMs) {
    const deadline = now() + timeoutMs;
    for (;;) {
      if (condition()) return true;
      if (now() >= deadline) return false;
      await sleep(100);
    }
  }
  const settledRender = path => until(() => renders.get(path)?.status !== 'rendering', renderTimeoutMs);

  /** Marks documents that the model asked to open with xyzrender. */
  function request(paths, view) {
    for (const path of paths) {
      if (view === 'xyzrender') requested.add(path);
      else requested.delete(path);
    }
  }

  /** Wraps one xyzrender endpoint call and records its outcome per document path. */
  async function xyzrender(path, body, run) {
    const id = ++serial;
    const previous = renders.get(path);
    const pending = { ...previous, serial: id, status: 'rendering', preset: body.preset || previous?.preset || 'default', controls: body.controls || previous?.controls || null, error: undefined, startedAt: now() };
    renders.set(path, pending);
    try {
      const result = await run();
      if (renders.get(path)?.serial === id) {
        renders.set(path, { ...pending, status: 'ready', svg: result.svg, output: svgSize(result.svg), preset: result.preset || pending.preset,
          controls: result.xyzrenderControls || pending.controls, elapsedMs: result.elapsedMs ?? null });
      }
      return result;
    } catch (error) {
      // A failed update leaves the previous SVG on screen; keep it for capture.
      if (renders.get(path)?.serial === id) renders.set(path, { ...pending, status: 'failed', error: String(error?.message || error).slice(0, 512) });
      throw error;
    }
  }

  function describe(document) {
    if (!document?.path) return undefined;
    const record = renders.get(document.path);
    const wanted = requested.has(document.path);
    if (!record && !wanted) return undefined;
    const controls = record?.controls ? Object.fromEntries(Object.entries(record.controls).filter(([, value]) => value !== null && value !== undefined)) : undefined;
    const details = { ...(wanted ? { requested: 'xyzrender' } : {}),
      ...(record ? { preset: record.preset, controls, output: record.output ?? null, elapsedMs: record.elapsedMs ?? null, ...(record.error ? { error: record.error } : {}) } : {}) };
    if (document.renderer === 'xyzrender-external') return { status: record?.status || 'rendering', ...details };
    if (record?.status === 'rendering') return { status: 'rendering', renderer: document.renderer, ...details };
    const shown = document.renderer === 'molstar' ? 'Mol*' : document.renderer || 'another renderer';
    if (record?.status === 'failed') return { status: 'fallback', renderer: document.renderer, reason: `xyzrender failed, so the document is shown in ${shown}.`, ...details };
    if (!record) return { status: 'fallback', renderer: document.renderer, reason: `Burette did not offer xyzrender for this document (for example a protein above 1500 atoms, an SDF collection or a source over 512 KiB), so it is shown in ${shown}.`, ...details };
    return { status: 'available', renderer: document.renderer, reason: `The document is shown in ${shown}; set_xyzrender_view {renderer:"xyzrender"} shows the SVG again.`, ...details };
  }

  function docks() {
    const measured = {};
    for (const area of ['right', 'bottom']) {
      const panel = root.querySelector(`aside.dock-panel[data-area="${area}"]`);
      const box = (root.getElementById?.(`${area}-dock`) || panel)?.getBoundingClientRect?.();
      const open = panel?.dataset?.open === 'true';
      const width = Math.round(box?.width || 0), height = Math.round(box?.height || 0);
      measured[area] = { open, visible: open && width >= 24 && height >= 24, width, height };
    }
    return measured;
  }

  /** Adds renderer status and measured docks to an observation. */
  function decorate(state) {
    const measured = docks();
    const visible = Object.keys(measured).filter(area => measured[area].visible).map(area => `dock:${area}`);
    const withRenderer = document => {
      const externalRenderer = describe(document);
      return externalRenderer ? { ...document, externalRenderer } : document;
    };
    return { ...state, docks: measured,
      ...(Array.isArray(state.documents) ? { documents: state.documents.map(withRenderer) } : {}),
      ...(state.activeDocument ? { activeDocument: withRenderer(state.activeDocument) } : {}),
      ...(Array.isArray(state.panels) ? { panels: [...state.panels.filter(panel => !String(panel).startsWith('dock:')), ...visible] } : {}),
    };
  }

  function activeFrame(active) {
    return [...root.querySelectorAll('iframe.viewer-iframe[data-document-id]')].find(frame => frame.dataset.documentId === active.id) || null;
  }

  async function capture(active) {
    await settledRender(active.path);
    const record = renders.get(active.path);
    if (!record?.svg) {
      return failure('capture_scene', 'XYZRENDER_NOT_RENDERED', record?.error ? `xyzrender has no SVG to capture: ${record.error}` : 'xyzrender has not produced an SVG for the active document yet. Observe activeDocument.externalRenderer.status and retry.');
    }
    try {
      const image = await rasterize(record.svg);
      return done('capture_scene', { images: [{ role: 'scene', dataUri: image.dataUri }], renderer: 'xyzrender', documentId: active.id,
        preset: record.preset, output: record.output, note: 'Rasterized from the current xyzrender SVG; on-screen pan and zoom are not applied.' });
    } catch (error) {
      return failure('capture_scene', 'XYZRENDER_CAPTURE_FAILED', `Could not rasterize the xyzrender SVG: ${String(error?.message || error).slice(0, 256)}`);
    }
  }

  async function setView(action, current) {
    const fail = (code, message) => failure('set_xyzrender_view', code, message);
    let active = current().activeDocument;
    if (!active?.path || !active.id) return fail('NO_DOCUMENT', 'No active document is open.');
    const target = action.renderer === 'molstar' ? 'molstar' : action.renderer === 'xyzrender' ? 'xyzrender-external' : null;
    if (!target && active.renderer !== 'xyzrender-external') return fail('XYZRENDER_INACTIVE', 'The active document is not shown with xyzrender. Send set_xyzrender_view {renderer:"xyzrender"} first, or open the file with view "xyzrender".');
    if (target && active.renderer !== target) {
      const button = activeFrame(active)?.contentDocument?.querySelector(`[data-buret-renderer="${target}"]`);
      if (!button || button.disabled) {
        return fail('RENDERER_UNAVAILABLE', target === 'molstar' ? 'Mol* is not available for this document.'
          : `xyzrender is not available for ${active.title || 'this document'}. It renders XYZ, SDF/MOL, SMILES, PDB and mmCIF sources up to 512 KiB and at most 1500 atoms.`);
      }
      const before = renders.get(active.path)?.serial || 0;
      request([active.path], target === 'xyzrender-external' ? 'xyzrender' : 'auto');
      button.click();
      const path = active.path;
      const switched = await until(() => {
        const document = current().activeDocument;
        const record = renders.get(path);
        return document?.path === path && document.renderer === target && document.ready === true
          || target === 'xyzrender-external' && record?.serial > before && record.status === 'failed';
      }, renderTimeoutMs);
      const record = renders.get(path);
      if (target === 'xyzrender-external' && record?.serial > before && record.status === 'failed') return fail('XYZRENDER_FAILED', `xyzrender failed: ${record.error}`);
      if (!switched) return fail('RENDERER_SWITCH_TIMEOUT', `The document did not switch to ${target === 'molstar' ? 'Mol*' : 'xyzrender'} within 30 s. Observe it before retrying.`);
      active = current().activeDocument;
    }
    if (action.preset !== undefined || action.controls !== undefined) {
      await settledRender(active.path);
      const base = renders.get(active.path);
      const frame = activeFrame(active);
      if (!frame?.contentWindow) return fail('NO_VIEWER', 'The active xyzrender view is not mounted.');
      const before = base?.serial || 0;
      // The viewer resets omitted controls to defaults, so send the merged set.
      const controls = action.controls ? { ...(base?.controls || {}), ...action.controls } : undefined;
      frame.contentWindow.postMessage({ source: 'burette-host', body: { type: 'setXyzrenderControls', documentId: frame.dataset.documentId,
        ...(action.preset ? { preset: action.preset } : {}), ...(controls ? { controls } : {}) } }, '*');
      if (!await until(() => (renders.get(active.path)?.serial || 0) > before, 3000)) return fail('XYZRENDER_NOT_STARTED', 'The xyzrender view did not start a new render. Observe the document and retry.');
      await settledRender(active.path);
      const record = renders.get(active.path);
      if (record?.status !== 'ready') return fail('XYZRENDER_FAILED', record?.status === 'failed' ? `xyzrender failed: ${record.error}` : 'xyzrender did not finish within 30 s.');
    }
    const document = current().activeDocument;
    return done('set_xyzrender_view', { documentId: document?.id ?? null, renderer: document?.renderer ?? null, externalRenderer: describe(document) ?? null });
  }

  /** Returns a local executor for actions the shell cannot run, otherwise null. */
  function intercept(action, current) {
    if (action.type === 'set_xyzrender_view') return () => setView(action, current);
    const active = current().activeDocument;
    if (active?.renderer !== 'xyzrender-external') return null;
    if (action.type === 'observe_scene') {
      return async () => done('observe_scene', { renderer: 'xyzrender', documentId: active.id, title: active.title, externalRenderer: describe(active) ?? { status: 'rendering' },
        note: 'The active document is an xyzrender SVG. Mol* selection, camera and layer queries do not apply; use set_xyzrender_view or capture_scene.' });
    }
    if (action.type === 'capture_scene') return () => capture(active);
    if (molstarOnly.has(action.type)) {
      return async () => failure(action.type, 'XYZRENDER_ACTIVE', `${action.type} controls Mol*, but the active document is an xyzrender SVG. Use set_xyzrender_view for preset and controls, or set_xyzrender_view {renderer:"molstar"} first.`);
    }
    return null;
  }

  /** Confirms that a dock change is visible before the action is acknowledged. */
  async function settlePanel(action, completed) {
    if (completed.status !== 'completed' || completed.result?.ok === false) return completed;
    await until(() => docks()[action.area].visible === action.open, 2500);
    const dock = docks()[action.area];
    if (dock.visible === action.open) return { ...completed, result: { ...completed.result, result: { ...completed.result?.result, visible: dock.visible, width: dock.width, height: dock.height } } };
    const mode = displayMode();
    return failure('set_workspace_panel', 'PANEL_NOT_RENDERED',
      `The ${action.area} dock is ${dock.open ? 'open' : 'closed'} in workspace state but ${dock.visible ? 'still visible' : 'not visible'} (${dock.width}x${dock.height} px, ${mode || 'unknown'} placement).`
      + (action.open ? ` ${action.area === 'bottom' ? 'The bottom dock needs about 180 px below the 3D view' : 'The right dock needs about 260 px beside the 3D view'}; use set_display_mode fullscreen for the side pane, then retry.` : ''),
      { dock, displayMode: mode });
  }

  return { request, xyzrender, decorate, intercept, settlePanel };
}
