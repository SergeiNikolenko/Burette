import { molstarPatchPlugin } from './molstar-source.mjs';

export function patchMolstarPickReadback(source) {
  const before = `    if (!this.buffers.synchronous) {
      const status = this.buffers.check();
      if (status === AsyncPickStatus.Pending)
        return "pending";
      if (status === AsyncPickStatus.Failed) {
        this.dirty = true;
        return "pending";
      }
    }`;
  const after = `    // Hover may have started an asynchronous read even on a synchronous backend.
    const status = this.buffers.check();
    if (status === AsyncPickStatus.Pending)
      return "pending";
    if (status === AsyncPickStatus.Failed) {
      this.dirty = true;
      return "pending";
    }`;
  if (source.split(before).length !== 2) {
    throw new Error('Mol* picking readback changed; review pending clicks before vendoring.');
  }
  return source.replace(before, after);
}

export const molstarPickReadbackPlugin = molstarPatchPlugin(
  'molstar-pick-readback',
  '@molstar/graphics/canvas3d/helper/pick-helper',
  patchMolstarPickReadback,
);
