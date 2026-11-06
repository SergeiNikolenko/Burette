import * as ViewerLib from '@molstar/viewer/lib';
import * as ViewerExtensions from '@molstar/viewer/extensions';
import * as ViewerApp from '@molstar/viewer';
import * as ViewerPresets from '@molstar/viewer/presets';
import { BuretteSuperposition } from './molstar-superposition-facade.js';
import { BuretteStory } from './molstar-story-facade.js';
import { BuretteSelection } from './molstar-selection-facade.js';
import { BuretteTrajectoryPlayback } from './molstar-trajectory-playback.js';
import { BuretteResizeInteraction } from './molstar-resize-interaction.js';
import { BuretteIndexedTrajectory } from './molstar-indexed-trajectory.js';
import { BuretteGeometry } from './molstar-geometry.js';
import { BuretteTopologyScene } from './molstar-topology-scene.js';
import { BuretteGeometryMeasurement } from './molstar-geometry-measurement.js';
import { BuretteVolumeSegmentation } from './molstar-volume-segmentation.js';
import { BuretteSceneExport } from './molstar-scene-export.js';
import { BuretteCalculationOverlay } from './molstar-calculation-overlay.js';

globalThis.molstar = Object.assign(
  {},
  globalThis.molstar || {},
  ViewerLib,
  ViewerExtensions,
  ViewerApp,
  ViewerPresets,
  { BuretteSuperposition, BuretteStory, BuretteSelection, BuretteTrajectoryPlayback, BuretteIndexedTrajectory, BuretteResizeInteraction, BuretteVolumeSegmentation, BuretteGeometryMeasurement, BuretteGeometry, BuretteTopologyScene, BuretteSceneExport, BuretteCalculationOverlay },
);

export * from '@molstar/viewer/lib';
export * from '@molstar/viewer/extensions';
export * from '@molstar/viewer';
export * from '@molstar/viewer/presets';
export { BuretteSuperposition } from './molstar-superposition-facade.js';
