import { molstarPatchPlugin, molstarSourcePlugin } from './molstar-source.mjs';
import { molstarV3000ChargesPlugin } from './molstar-v3000-charges.mjs';
import { molstarMolV3000Plugin } from './molstar-mol-v3000.mjs';
import { molstarStatePreconditionPlugin } from './molstar-state-precondition.mjs';
import { molstarDcdTimePlugin } from './molstar-dcd-time.mjs';
import { molstarCubeUnitsPlugin } from './molstar-cube-units.mjs';
import { molstarXyzLatticePlugin } from './molstar-xyz-lattice.mjs';
import { molstarCubeDatasetsPlugin } from './molstar-cube-datasets.mjs';
import { molstarCubeUiHistoryPlugin } from './molstar-cube-ui-history.mjs';
import { patchMolstarResizeDraw } from './molstar-resize-draw.mjs';
import { patchMolstarHoverPickCanvas, molstarHoverPickEventsPlugin } from './molstar-hover-pick.mjs';
import { patchMolstarCameraParams, molstarCameraSettingsPlugin } from './molstar-camera-controls.mjs';
import { molstarSurfaceLoopPlugin } from './molstar-surface-loop.mjs';
import { molstarSurfaceFieldCachePlugin } from './molstar-surface-field-cache.mjs';
import { molstarRmsdPrecisionPlugin } from './molstar-rmsd-precision.mjs';
import { molstarAnisotropExportPlugin } from './molstar-anisotrop-export.mjs';
import { molstarPickReadbackPlugin } from './molstar-pick-readback.mjs';

import { molstarLegacySnapshotPlugin } from './molstar-legacy-snapshot.mjs';

// Bun uses the first matching onLoad handler, so compose adaptations of the
// same module before registering it.
const molstarCanvasPlugin = molstarPatchPlugin('molstar-canvas-controls', '@molstar/graphics/canvas3d/canvas3d',
  source => patchMolstarCameraParams(patchMolstarHoverPickCanvas(patchMolstarResizeDraw(source))));

export const molstarBuildPlugins = [
  molstarSourcePlugin, molstarXyzLatticePlugin, molstarCubeUiHistoryPlugin, molstarCubeDatasetsPlugin, molstarCubeUnitsPlugin,
  molstarV3000ChargesPlugin, molstarMolV3000Plugin, molstarStatePreconditionPlugin, molstarDcdTimePlugin,
  molstarCanvasPlugin, molstarCameraSettingsPlugin, molstarHoverPickEventsPlugin, molstarSurfaceFieldCachePlugin, molstarSurfaceLoopPlugin, molstarLegacySnapshotPlugin,
  molstarPickReadbackPlugin, molstarAnisotropExportPlugin, molstarRmsdPrecisionPlugin,
];
