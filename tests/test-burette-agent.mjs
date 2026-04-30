#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { resolve } from 'node:path';

function col(values) {
  return { value: i => values[i], array: values, rowCount: values.length };
}

function fakeStructure() {
  const elements = [0, 1, 2, 3, 4, 5];
  const residueIndex = [0, 0, 1, 1, 2, 2];
  const chainIndex = [0, 0, 0, 0, 1, 1];
  const positions = [
    [0, 0, 0], [1, 0, 0], [8, 0, 0], [9, 0, 0], [2.5, 0, 0], [2.8, 0, 0]
  ];
  const model = {
    modelNum: 0,
    atomicHierarchy: {
      atoms: {
        id: col([1, 2, 3, 4, 5, 6]),
        label_atom_id: col(['N', 'CA', 'N', 'CA', 'C1', 'N1']),
        auth_atom_id: col(['N', 'CA', 'N', 'CA', 'C1', 'N1']),
        type_symbol: col(['N', 'C', 'N', 'C', 'C', 'N'])
      },
      residues: {
        label_comp_id: col(['GLY', 'ALA', 'HEM']),
        auth_comp_id: col(['GLY', 'ALA', 'HEM']),
        label_seq_id: col([1, 2, 100]),
        auth_seq_id: col([1, 2, 100]),
        pdbx_PDB_ins_code: col([undefined, undefined, undefined])
      },
      chains: {
        label_entity_id: col(['1', '2']),
        label_asym_id: col(['A', 'B']),
        auth_asym_id: col(['A', 'B'])
      },
      residueAtomSegments: { index: col(residueIndex) },
      chainAtomSegments: { index: col(chainIndex) }
    },
    entities: {
      getEntityIndex: id => id === '1' ? 0 : 1,
      data: { type: col(['polymer', 'non-polymer']), id: col(['1', '2']), rowCount: 2 }
    }
  };
  return {
    units: [{ id: 1, elements, model, conformation: { position: (i, out) => { out[0] = positions[i][0]; out[1] = positions[i][1]; out[2] = positions[i][2]; } } }]
  };
}

const agentSource = await readFile(resolve('PreviewExtension/Web/burette-agent.js'), 'utf8');
const interactions = [];
const context = {
  console,
  setTimeout,
  clearTimeout,
  Date,
  performance: { now: () => Date.now() },
  window: {
    molstar: { version: '5.7.0-test' },
    dispatchEvent() {},
    CustomEvent: class CustomEvent { constructor(name, init) { this.name = name; this.detail = init?.detail; } }
  },
  document: {
    querySelector() {
      return { toDataURL: () => 'data:image/png;base64,stub' };
    }
  }
};
context.window.window = context.window;
context.window.document = context.document;
vm.createContext(context);
vm.runInContext(agentSource, context, { filename: 'burette-agent.js' });

const viewer = {
  plugin: {
    managers: {
      structure: { hierarchy: { current: { structures: [{ cell: { transform: { ref: 's0' }, obj: { data: fakeStructure(), label: 'fake.pdb' } } }] } } },
      camera: { reset: () => { interactions.push({ action: 'reset' }); } }
    },
    helpers: { viewportScreenshot: { getImageDataUri: async () => 'data:image/png;base64,from-helper' } }
  },
  structureInteractivity(payload) { interactions.push(payload); },
  loadMvsData: async () => {}
};

context.window.BurreteAgent.attach({ viewer, plugin: viewer.plugin, config: { label: 'fake.pdb', format: 'pdb' } });
context.window.BurreteAgent.notifyStructureLoaded({ prepared: { label: 'fake.pdb', format: 'pdb' } });

const capabilities = await context.window.BurreteAgent.run({ command: 'capabilities' });
assert.equal(capabilities.ok, true);
assert.equal(capabilities.result.hasViewer, true);
assert.equal(capabilities.result.hasStructureInteractivity, true);

const summary = await context.window.BurreteAgent.run({ command: 'summary', args: { includeLigands: true } });
assert.equal(summary.ok, true);
assert.equal(summary.result.counts.atoms, 6);
assert.equal(summary.result.counts.ligands, 1);
assert.equal(summary.result.structures[0].chains.length, 2);

const selected = await context.window.BurreteAgent.run({ command: 'selectResidues', args: { selector: { auth_asym_id: 'A', beg_auth_seq_id: 1, end_auth_seq_id: 2 } } });
assert.equal(selected.ok, true);
assert.equal(selected.result.counts.residues, 2);
assert.ok(selected.result.selectionId.startsWith('sel-'));
assert.ok(interactions.some(x => x.action === 'select'));

const focus = await context.window.BurreteAgent.run({ command: 'focusSelection', args: { selection: 'last' } });
assert.equal(focus.ok, true);
assert.ok(interactions.some(x => x.action === 'focus'));

const lig = await context.window.BurreteAgent.run({ command: 'focusLigand', args: { selector: { label_comp_id: 'HEM' }, showNeighborhood: true, radiusA: 4 } });
assert.equal(lig.ok, true);
assert.equal(lig.result.ligand.label_comp_id, 'HEM');
assert.ok(lig.result.neighborhood.residues.some(r => r.auth_asym_id === 'A'));

const shot = await context.window.BurreteAgent.run({ command: 'screenshot' });
assert.equal(shot.ok, true);
assert.equal(shot.result.dataUri, 'data:image/png;base64,from-helper');

const bad = await context.window.BurreteAgent.run({ command: 'selectResidues', args: { selector: { auth_asym_id: 'Z' } } });
assert.equal(bad.ok, false);
assert.equal(bad.error.code, 'SELECTION_EMPTY');

console.log('burette-agent tests passed');
