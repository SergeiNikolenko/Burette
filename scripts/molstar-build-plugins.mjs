import { molstarSourcePlugin } from './molstar-source.mjs';
import { molstarV3000ChargesPlugin } from './molstar-v3000-charges.mjs';
import { molstarMolV3000Plugin } from './molstar-mol-v3000.mjs';
import { molstarStatePreconditionPlugin } from './molstar-state-precondition.mjs';
import { molstarDcdTimePlugin } from './molstar-dcd-time.mjs';
import { molstarCubeUnitsPlugin } from './molstar-cube-units.mjs';
import { molstarXyzLatticePlugin } from './molstar-xyz-lattice.mjs';
import { molstarCubeDatasetsPlugin } from './molstar-cube-datasets.mjs';
import { molstarCubeUiHistoryPlugin } from './molstar-cube-ui-history.mjs';
import { molstarResizeDrawPlugin } from './molstar-resize-draw.mjs';
import { molstarSurfaceLoopPlugin } from './molstar-surface-loop.mjs';
import { molstarSurfaceFieldCachePlugin } from './molstar-surface-field-cache.mjs';

export const molstarBuildPlugins = [
  molstarSourcePlugin, molstarXyzLatticePlugin, molstarCubeUiHistoryPlugin, molstarCubeDatasetsPlugin, molstarCubeUnitsPlugin,
  molstarV3000ChargesPlugin, molstarMolV3000Plugin, molstarStatePreconditionPlugin, molstarDcdTimePlugin,
  molstarResizeDrawPlugin, molstarSurfaceFieldCachePlugin, molstarSurfaceLoopPlugin,
];
