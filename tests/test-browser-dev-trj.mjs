import assert from 'node:assert/strict';
import { openBrowserDevTextDocument } from '../apps/desktop/src/lib/browser-dev-documents.ts';
import { defaultPreferences } from '../apps/desktop/src/stores/settings-store.ts';

const trajectory = '2\n energy: -5.0\nH 0 0 0\nH 0 0 0.7\n2\n energy: -5.1\nH 0 0 0\nH 0 0 0.8\n';
const document = await openBrowserDevTextDocument('xtb.trj', 'trj', trajectory, defaultPreferences);
const config = JSON.parse(document.runtimePath.match(/window\.BuretteConfig = (\{[^\n]+\});/)[1]);
assert.deepEqual({ renderer: document.renderer, extension: document.extension,
  format: config.molstarFormat, controls: config.trajectoryControls, frames: config.trajectoryFrameCount },
{ renderer: 'molstar', extension: 'trj', format: 'xyz', controls: true, frames: 2 });
console.log('Browser xTB TRJ uses XYZ parser and preserves both trajectory frames');
