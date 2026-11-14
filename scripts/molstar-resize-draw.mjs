import { molstarPatchPlugin } from './molstar-source.mjs';
import { patchMolstarHoverPickCanvas } from './molstar-hover-pick.mjs';

// Resizing a WebGL canvas clears its drawing buffer. The host must redraw in
// the same animation callback, even if Mol*'s animation loop already ran in
// that frame. Expose its existing draw primitive without ticking animations,
// committing models, or resuming/scheduling another animation loop.
export function patchMolstarResizeDraw(source) {
  const before = '      requestDraw,\n      prepare,';
  if (source.split(before).length !== 2) {
    throw new Error('Mol* Canvas3D changed; review atomic resize drawing before vendoring.');
  }
  return source.replace(before, '      requestDraw,\n      draw,\n      prepare,');
}

// A module takes one loader, so every Canvas3D patch is applied here.
export const molstarResizeDrawPlugin = molstarPatchPlugin(
  'molstar-atomic-resize-draw',
  '@molstar/graphics/canvas3d/canvas3d',
  source => patchMolstarHoverPickCanvas(patchMolstarResizeDraw(source)),
);
