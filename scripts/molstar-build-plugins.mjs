import { molstarPatchPlugin, molstarSourcePlugin } from './molstar-source.mjs';
import { molstarStatePreconditionPlugin } from './molstar-state-precondition.mjs';
import { molstarDcdTimePlugin } from './molstar-dcd-time.mjs';
import { patchMolstarResizeDraw } from './molstar-resize-draw.mjs';
import { patchMolstarCameraParams, molstarCameraSettingsPlugin } from './molstar-camera-controls.mjs';
import { molstarSurfaceLoopPlugin } from './molstar-surface-loop.mjs';
import { molstarSurfaceFieldCachePlugin } from './molstar-surface-field-cache.mjs';

// Bun uses the first matching onLoad handler, so compose adaptations of the
// same module before registering it.
const molstarCanvasPlugin = molstarPatchPlugin('molstar-canvas-controls', '@molstar/graphics/canvas3d/canvas3d',
  source => patchMolstarCameraParams(patchMolstarResizeDraw(source)));

export const molstarBuildPlugins = [molstarSourcePlugin, molstarStatePreconditionPlugin, molstarDcdTimePlugin, molstarCanvasPlugin, molstarCameraSettingsPlugin, molstarSurfaceFieldCachePlugin, molstarSurfaceLoopPlugin];
