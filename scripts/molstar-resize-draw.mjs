import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Resizing a WebGL canvas clears its drawing buffer. The host must redraw in
// the same animation callback, even if Mol*'s animation loop already ran in
// that frame. Expose its existing draw primitive without ticking animations,
// committing models, or resuming/scheduling another animation loop.
export function patchMolstarResizeDraw(source) {
  const before = '            requestDraw,\n            tick,';
  if (source.split(before).length !== 2) {
    throw new Error('Mol* Canvas3D changed; review atomic resize drawing before vendoring.');
  }
  return source.replace(before, '            requestDraw,\n            draw,\n            tick,');
}

export const molstarResizeDrawPlugin = {
  name: 'molstar-atomic-resize-draw',
  setup(build) {
    build.onLoad({ filter: /molstar\/lib\/mol-canvas3d\/canvas3d\.js$/u }, async ({ path }) => {
      const { version } = JSON.parse(await readFile(resolve(dirname(path), '../../package.json'), 'utf8'));
      if (version !== '5.11.0') throw new Error('Review atomic resize drawing before upgrading Mol* from 5.11.0.');
      return { contents: patchMolstarResizeDraw(await readFile(path, 'utf8')), loader: 'js' };
    });
  },
};
