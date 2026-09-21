import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceContentHeight } from '../plugins/burette-agent/ui/native-workspace-sizing.mjs';

function fixture(renderer, contentWindow) {
  const state = { activeDocument: { id: 'active', renderer, ready: true } };
  const frame = { contentWindow: { BuretteConfig: { documentId: 'active' }, ...contentWindow }, getBoundingClientRect: () => ({ width: 736, height: 320 }) };
  const document = { querySelectorAll: () => [frame] };
  return { state, frame, document, height: () => workspaceContentHeight(state, 736, document) };
}

test('actual grid content sets height, scrolling cancels out, and large collections stay bounded', () => {
  const grid = { scrollHeight: 210, getBoundingClientRect: () => ({ top: 110 }) };
  const f = fixture('grid2d', { scrollY: 0, document: { getElementById: () => grid } });
  assert.equal(f.height(), 392);
  f.frame.contentWindow.scrollY = 80;
  grid.getBoundingClientRect = () => ({ top: 30 });
  assert.equal(f.height(), 392);
  grid.scrollHeight = 5000;
  assert.equal(f.height(), 600);
  grid.scrollHeight = 20;
  assert.equal(f.height(), 320);
});

test('loaded scene detail gives proteins more room than small molecules without zoom feedback', () => {
  const data = { elementCount: 15 };
  const f = fixture('molstar', { BuretteViewer: { plugin: { managers: { structure: { hierarchy: { current: { structures: [{ cell: { obj: { data } } }] } } } } } } });
  const small = f.height();
  data.elementCount = 6000;
  const protein = f.height();
  assert.ok(small >= 320 && small < 340, 'small cards reserve room for the rail and host menu');
  assert.ok(protein > small && protein <= 600);
  f.frame.getBoundingClientRect = () => ({ width: 736, height: protein });
  assert.equal(f.height(), protein, 'host height cannot feed back into scene height');
  f.frame.contentWindow.BuretteConfig.documentId = 'inactive';
  assert.notEqual(f.height(), protein, 'ignore a renderer belonging to another tab');
});

test('empty and small sketches stay compact while larger sketches grow within a bound', () => {
  const state = { activeSurface: { kind: 'ketcher' }, chemicalEditor: { structure: { atomCount: 0 } } };
  const height = () => workspaceContentHeight(state, 736, {});
  assert.equal(height(), 360);
  state.chemicalEditor.structure.atomCount = 13;
  assert.equal(height(), 386);
  state.chemicalEditor.structure.atomCount = 300;
  assert.equal(height(), 520);
});
