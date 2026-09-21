import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateMolecularArtifact } from '../plugins/burette-agent/mcp/lib/validation.mjs';

const manifest = { version: 1, title: 'Expected', blocks: [{ type: 'markdown', body: '# Expected\n\nNotes.' }] };
const snapshot = { version: 1, status: 'ready', datasets: { ligand: [{ id: 'L1', score: -1 }] } };
const validate = blocks => validateMolecularArtifact({ manifest: { ...manifest, blocks }, snapshot });

test('reports accept a whole heading line and reject prefix collisions', () => {
  for (const body of ['# Expected', ' \n# Expected\r\nNotes', '# Expected  \nNotes']) {
    assert.equal(validate([{ type: 'markdown', body }]).ok, true);
  }
  for (const body of ['# ExpectedButDifferent', '# Expected extra', '## Expected']) {
    assert.equal(validate([{ type: 'markdown', body }]).ok, false);
  }
});

test('blocks validate shape and references before a report is accepted', () => {
  assert.equal(validate([...manifest.blocks, { type: 'table', dataset: 'ligand' }, { type: 'chart', dataset: 'ligand' }]).ok, true);
  for (const block of [null, {}, { type: 'unknown' }, { type: 'markdown', body: '' },
    { type: 'table' }, { type: 'table', dataset: 'missing' }, { type: 'chart', dataset: '__proto__' },
    { type: 'markdown', body: 'Notes', dataset: 'missing' }]) {
    const result = validate([...manifest.blocks, block]);
    assert.equal(result.ok, false, JSON.stringify(block));
    assert.match(result.errors.join(' '), /manifest.blocks/);
  }
  assert.equal(validate(Array(101).fill(manifest.blocks[0])).ok, false);
});
