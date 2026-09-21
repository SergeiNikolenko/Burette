import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

test('short grids keep filters accessible and only scrolling condenses controls', async () => {
  const source = await readFile(new URL('../PreviewExtension/Web/grid-viewer.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function updateGridToolbarCondensed()');
  const code = source.slice(start, source.indexOf('\n  function hasMoreRows', start));
  const states = [];
  const window = { innerHeight: 184 };
  let top = 0;
  const update = runInNewContext(`${code}\nupdateGridToolbarCondensed`, {
    window, scrollTop: () => top,
    document: { getElementById: () => ({ classList: { toggle: (_, value) => states.push(value) } }) },
  });
  update();
  window.innerHeight = 620;
  update();
  top = 25;
  update();
  assert.deepEqual(states, [false, false, true]);
});

test('ready RDKit grids have no footer, while actionable status can appear and clear', async () => {
  const source = await readFile(new URL('../PreviewExtension/Web/grid-viewer.js', import.meta.url), 'utf8');
  const start = source.indexOf('    let footerText;');
  const code = source.slice(start, source.indexOf('    updateGridRail();', start));
  const footer = {};
  const state = { cardRenderer: 'rdkit' };
  const context = { state, cfg: {}, total: 2, included: 2, scrollable: 2, visible: 2,
    hasMoreRows: () => false, effectiveMolecularGrid: () => true,
    document: { getElementById: id => { assert.equal(id, 'footer'); return footer; } },
  };
  const update = () => runInNewContext(`{${code}}`, context);
  update();
  assert.deepEqual(footer, { textContent: '', hidden: true });
  state.smartsError = 'Invalid pattern';
  update();
  assert.deepEqual(footer, { textContent: 'SMARTS error: Invalid pattern', hidden: false });
  state.smartsError = null;
  state.dirty = true;
  update();
  assert.equal(footer.hidden, false);
  assert.match(footer.textContent, /Unsaved changes/);
  state.dirty = false;
  update();
  assert.deepEqual(footer, { textContent: '', hidden: true });
});
