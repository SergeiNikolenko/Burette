// Keep layout gestures interactive without freezing the viewport or changing
// molecular state. Full resolution and antialiasing return after geometry stops.
const sessions = new WeakMap();
const SETTLE_MS = 140;

export const BuretteResizeInteraction = {
  touch(viewer, finish) {
    const plugin = viewer?.plugin;
    const canvas = plugin?.canvas3d;
    const context = plugin?.canvas3dContext;
    if (!canvas?.setProps || !context?.setProps) return;
    let session = sessions.get(viewer);
    if (!session) {
      session = { context: { ...context.props }, multiSample: { ...canvas.props.multiSample }, samples: [], timer: 0, finish };
      sessions.set(viewer, session);
      // 'scaled' targets CSS pixels instead of Retina backing pixels. Never
      // increase a resolution the user has already set below that level.
      context.setProps({ resolutionMode: 'scaled', pixelScale: Math.min(1, context.props.pixelScale) });
      canvas.setProps({ multiSample: { mode: 'off' } });
    }
    clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      sessions.delete(viewer);
      const restoreStartedAt = performance.now();
      const restoreContext = {};
      if (context.props.resolutionMode === 'scaled') restoreContext.resolutionMode = session.context.resolutionMode;
      if (context.props.pixelScale === Math.min(1, session.context.pixelScale)) restoreContext.pixelScale = session.context.pixelScale;
      context.setProps(restoreContext);
      if (canvas.props.multiSample.mode === 'off') canvas.setProps({ multiSample: { mode: session.multiSample.mode } });
      const samples = session.samples.sort((a, b) => a - b);
      session.finish({ frames: samples.length, p95Ms: samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)] ?? 0, maxMs: samples.at(-1) ?? 0 }, restoreStartedAt);
    }, SETTLE_MS);
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
    sessions.delete(viewer);
  },
};
