// Inline height is a content budget, not a fixed aspect ratio. Inspect only the
// active, locally owned renderer; camera motion must not make the chat jump.
export function workspaceContentHeight(state = {}, width, document) {
  // Reserve usable canvas from the first frame, before the model is available.
  // Placement keeps this budget stable through parsing and host mode changes.
  const clamp = height => Math.round(Math.max(480, Math.min(720, height)));
  const chrome = 56; // Tab bar; placement floats inside the scene.
  if (state.activeSurface?.kind === 'ketcher') {
    const atoms = state.chemicalEditor?.structure?.atomCount || 0;
    const components = state.chemicalEditor?.structure?.componentCount || 1;
    return clamp(480 + Math.min(240, atoms * 2 + (components - 1) * 40));
  }
  const active = state.activeDocument;
  if (!active?.ready) return 480;
  for (const frame of document.querySelectorAll('iframe')) {
    if (!frame.getBoundingClientRect().width || !frame.getBoundingClientRect().height) continue;
    let viewer;
    try {
      viewer = frame.contentWindow;
      if (viewer?.BuretteConfig?.documentId !== active.id) continue;
    } catch { continue; } // Unrelated sandboxed file previews are not measurable.
    if (active.renderer === 'grid2d') {
      const grid = viewer.document.getElementById('grid');
      if (grid) {
        // scrollY cancels scrolling; virtual spacers retain the complete row
        // extent. The cap leaves large collections scrollable inside the card.
        const top = grid.getBoundingClientRect().top + viewer.scrollY;
        return clamp(chrome + top + grid.scrollHeight + 16);
      }
    }
    const structures = viewer?.BuretteViewer?.plugin?.managers?.structure?.hierarchy?.current?.structures;
    if (structures?.length) {
      const atoms = structures.reduce((total, entry) => total + (entry.cell?.obj?.data?.elementCount || 0), 0);
      // More structural detail gets more canvas. This uses loaded model counts,
      // not file bytes, zoom, rotation, or the current iframe height.
      return clamp(chrome + 360 + Math.log2(1 + atoms / 40) * 28);
    }
  }
  return clamp(chrome + Math.min(360, width * 0.45));
}
