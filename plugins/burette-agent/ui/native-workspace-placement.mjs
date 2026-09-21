import { workspaceContentHeight } from './native-workspace-sizing.mjs';

// Placement belongs to the host, not the molecular document lifecycle.
export function createWorkspacePlacement(app, status) {
  const style = document.createElement('style');
  style.textContent = `
    body{display:flex;flex-direction:column;background:#fff;color:#202124}
    html[data-theme="dark"] body{background:#000;color:#eee}
    #root{position:relative;display:flex;flex-direction:column;flex:1;min-height:0;height:auto;box-sizing:border-box}
    #root>.app-shell{width:100%;flex:1;min-height:0;height:auto}
    #status{flex:none;max-height:72px;overflow:auto}
  `;
  document.head.appendChild(style);
  let mode = app.getHostContext()?.displayMode || 'inline';
  let pending = false;
  let lastHeight = 0;
  let hostWidth;
  let snapshot;
  let content = {};
  const listeners = new Set();
  function resize() {
    if (mode !== 'inline') {
      lastHeight = 0;
      document.documentElement.style.removeProperty('height');
      document.body.style.removeProperty('height');
      document.body.style.removeProperty('width');
      document.body.style.removeProperty('margin');
      return;
    }
    const width = hostWidth || window.innerWidth;
    if (!Number.isFinite(width) || width <= 0) return;
    // Keep this inline presentation stable through parsing and first render.
    const height = lastHeight || workspaceContentHeight(content, width, document);
    // Inline cards have a stable content budget. Use the side pane for more room.
    document.documentElement.style.height = `${height}px`;
    document.body.style.height = `${height}px`;
    if (height === lastHeight) return;
    lastHeight = height;
    void app.sendSizeChanged({ height }).catch(() => { lastHeight = 0; });
  }
  const onResize = () => { hostWidth = undefined; resize(); };
  window.addEventListener('resize', onResize);
  function update(context = {}) {
    mode = context.displayMode || mode;
    if (Number.isFinite(context.containerDimensions?.width) && context.containerDimensions.width > 0) hostWidth = context.containerDimensions.width;
    const available = context.availableDisplayModes || app.getHostContext()?.availableDisplayModes || ['inline'];
    const target = mode === 'inline' ? 'fullscreen' : 'inline';
    snapshot = { mode, target, disabled: pending || !available.includes(target) };
    document.body.dataset.displayMode = mode;
    resize();
    for (const listener of listeners) listener();
  }
  async function set(requested) {
    if (pending) throw new Error('A placement change is already pending.');
    if (requested === mode) return { ok: true, mode };
    pending = true;
    update();
    try {
      const result = await app.requestDisplayMode({ mode: requested });
      mode = result.mode;
      return { ok: mode === requested, mode };
    } catch (error) {
      status.hidden = false;
      status.textContent = `Could not change placement: ${error.message}`;
      throw error;
    } finally { pending = false; update(); }
  }
  update(app.getHostContext());
  return { set, update, observe(state) { content = state; resize(); }, getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { window.removeEventListener('resize', onResize); listeners.clear(); },
    get mode() { return mode; },
  };
}
