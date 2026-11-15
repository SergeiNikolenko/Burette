import { molstarPatchPlugin } from './molstar-source.mjs';

// Mol* links the pick variant of a program on its first pick and waits for the
// GPU compiler. A hover right after new geometry appears (focus surroundings,
// interactions) therefore blocks the page for as long as the shaders compile.
// A hover pick now starts the link and is retried on the next tick; clicks and
// direct picks still wait, because their result must be exact.
export function patchMolstarHoverPickCanvas(source) {
  const before = '    function asyncIdentify(target) {\n      if (graphics.isContextLost)\n        return;\n      shaderManager.finalize(["pick"], true);\n';
  if (source.split(before).length !== 2) {
    throw new Error('Mol* Canvas3D changed; review non-blocking hover picking before vendoring.');
  }
  return source.replace(before, '    function asyncIdentify(target, whenLinked) {\n      if (graphics.isContextLost)\n        return;\n'
    + '      if (whenLinked && !shaderManager.finalize(["pick"], false))\n        return null;\n      shaderManager.finalize(["pick"], true);\n');
}

export function patchMolstarHoverPickEvents(source) {
  const before = '    if (xyChanged) {\n      this.pickData = this.canvasAsyncIdentify(this.getTarget());\n';
  if (source.split(before).length !== 2) {
    throw new Error('Mol* interaction events changed; review non-blocking hover picking before vendoring.');
  }
  return source.replace(before, '    if (xyChanged) {\n      const pickData = this.canvasAsyncIdentify(this.getTarget(), true);\n'
    + '      if (pickData === null)\n        return;\n      this.pickData = pickData;\n');
}

export const molstarHoverPickEventsPlugin = molstarPatchPlugin(
  'molstar-hover-pick-events',
  '@molstar/graphics/canvas3d/helper/interaction-events',
  patchMolstarHoverPickEvents,
);
