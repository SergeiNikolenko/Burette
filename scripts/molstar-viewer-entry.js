import * as ViewerLib from 'molstar/lib/apps/viewer/lib.js';
import * as ViewerExtensions from 'molstar/lib/apps/viewer/extensions.js';
import * as ViewerApp from 'molstar/lib/apps/viewer/app.js';
import * as ViewerPresets from 'molstar/lib/apps/viewer/presets.js';
import { BuretteSuperposition } from './molstar-superposition-facade.js';
import { BuretteStory } from './molstar-story-facade.js';
import { BuretteSelection } from './molstar-selection-facade.js';
import { BuretteTrajectoryPlayback } from './molstar-trajectory-playback.js';
import { BuretteResizeInteraction } from './molstar-resize-interaction.js';
import { BuretteIndexedTrajectory } from './molstar-indexed-trajectory.js';
import { BuretteGeometry } from './molstar-geometry.js';
import { BuretteGeometryMeasurement } from './molstar-geometry-measurement.js';

globalThis.molstar = Object.assign(
  {},
  globalThis.molstar || {},
  ViewerLib,
  ViewerExtensions,
  ViewerApp,
  ViewerPresets,
  { BuretteSuperposition, BuretteStory, BuretteSelection, BuretteTrajectoryPlayback, BuretteIndexedTrajectory, BuretteResizeInteraction, BuretteGeometryMeasurement, BuretteGeometry },
);

export * from 'molstar/lib/apps/viewer/lib.js';
export * from 'molstar/lib/apps/viewer/extensions.js';
export * from 'molstar/lib/apps/viewer/app.js';
export * from 'molstar/lib/apps/viewer/presets.js';
export { BuretteSuperposition } from './molstar-superposition-facade.js';
