import * as ViewerLib from 'molstar/lib/apps/viewer/lib.js';
import * as ViewerExtensions from 'molstar/lib/apps/viewer/extensions.js';
import * as ViewerApp from 'molstar/lib/apps/viewer/app.js';
import * as ViewerPresets from 'molstar/lib/apps/viewer/presets.js';
import { BuretteSuperposition } from './molstar-superposition-facade.js';
import { BuretteSelection } from './molstar-selection-facade.js';
import { BuretteStory } from './molstar-story-facade.js';

globalThis.molstar = Object.assign(
  {},
  globalThis.molstar || {},
  ViewerLib,
  ViewerExtensions,
  ViewerApp,
  ViewerPresets,
  { BuretteSuperposition, BuretteSelection, BuretteStory },
);

export * from 'molstar/lib/apps/viewer/lib.js';
export * from 'molstar/lib/apps/viewer/extensions.js';
export * from 'molstar/lib/apps/viewer/app.js';
export * from 'molstar/lib/apps/viewer/presets.js';
export { BuretteSuperposition } from './molstar-superposition-facade.js';
export { BuretteSelection } from './molstar-selection-facade.js';
