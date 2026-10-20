// Reuse the existing drawing buffer while the viewport moves. Resizing a WebGL
// buffer reallocates render/picking targets and can stall WebKit's shared thread.
// CSS keeps the last projection's vertical scale and center; chrome stays live.
const sessions = new WeakMap();
const SETTLE_MS = 200;
const presentation = { width: 'auto', height: '100%', maxWidth: 'none', position: 'absolute', left: '50%', top: '0px', transform: 'translateX(-50%)', pointerEvents: 'none' };

function restore(viewer, session) {
  if (viewer.plugin.handleResize === session.deferResize) viewer.plugin.handleResize = session.handleResize;
  for (const [property, value] of Object.entries(presentation)) {
    if (session.canvas.style[property] === value) session.canvas.style[property] = session.style[property];
  }
}

export const BuretteResizeInteraction = {
  touch(viewer, finish, held = false) {
    const plugin = viewer?.plugin;
    const canvas = plugin?.canvas3dContext?.canvas;
    if (!canvas?.width || !canvas.height || !canvas.style || typeof plugin.handleResize !== 'function') return false;
    let session = sessions.get(viewer);
    if (!session) {
      session = { canvas, style: {}, handleResize: plugin.handleResize, deferResize() {}, samples: [], timer: 0, finish };
      for (const property of Object.keys(presentation)) session.style[property] = canvas.style[property];
      sessions.set(viewer, session);
      // Mol* also resizes through its input observer and layout subscription.
      // Both must defer with our scheduler, or they still clear/reallocate the
      // buffer between compositor frames. Restore the method before the draw.
      plugin.handleResize = session.deferResize;
      Object.assign(canvas.style, presentation);
    }
    clearTimeout(session.timer);
    if (held) return true;
    session.timer = setTimeout(() => {
      sessions.delete(viewer);
      const restoreStartedAt = performance.now();
      restore(viewer, session);
      const samples = session.samples.sort((a, b) => a - b);
      session.finish({ frames: samples.length, p95Ms: samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)] ?? 0, maxMs: samples.at(-1) ?? 0 }, restoreStartedAt);
    }, SETTLE_MS);
    return true;
  },
  release(viewer) {
    const session = sessions.get(viewer);
    if (session) this.touch(viewer, session.finish);
  },
  record(viewer, ms) {
    const session = sessions.get(viewer);
    if (session && Number.isFinite(ms) && ms >= 0) {
      if (session.samples.length === 120) session.samples.shift();
      session.samples.push(ms);
    }
  },
  dispose(viewer) {
    const session = sessions.get(viewer);
    if (!session) return;
    clearTimeout(session.timer);
    restore(viewer, session);
    sessions.delete(viewer);
  },
};
