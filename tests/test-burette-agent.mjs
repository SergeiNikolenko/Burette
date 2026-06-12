#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { resolve } from 'node:path';

function col(values) {
  return { value: i => values[i], array: values, rowCount: values.length };
}

function fakeStructure(options = {}) {
  const omitAuthIds = options.omitAuthIds === true;
  const remapAuthIds = options.remapAuthIds === true;
  const omitCompIds = options.omitCompIds === true;
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
        label_comp_id: col(omitCompIds ? [undefined, undefined, undefined] : ['GLY', 'ALA', 'HEM']),
        auth_comp_id: col(omitCompIds ? [undefined, undefined, undefined] : ['GLY', 'ALA', 'HEM']),
        label_seq_id: col([1, 2, 100]),
        auth_seq_id: col(omitAuthIds ? [undefined, undefined, undefined] : remapAuthIds ? [10, 20, 300] : [1, 2, 100]),
        pdbx_PDB_ins_code: col([undefined, undefined, undefined])
      },
      chains: {
        label_entity_id: col(['1', '2']),
        label_asym_id: col(['A', 'B']),
        auth_asym_id: col(omitAuthIds ? [undefined, undefined] : remapAuthIds ? ['X', 'Y'] : ['A', 'B'])
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
const selectionEntries = new Map();
const measurementLabels = [];
const context = {
  console,
  setTimeout,
  clearTimeout,
  Date,
  performance: { now: () => Date.now() },
  TextDecoder,
  Uint8Array,
  atob: value => Buffer.from(value, 'base64').toString('binary'),
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
      structure: {
        hierarchy: { current: { structures: [{ cell: { transform: { ref: 's0' }, obj: { data: fakeStructure(), label: 'fake.pdb' } } }] } },
        selection: { entries: selectionEntries },
        measurement: {
          addLabel: async (loci, options) => {
            measurementLabels.push({ loci, options });
            return { selection: { ref: 'label-selection-ref' }, representation: { ref: 'label-representation-ref' } };
          }
        }
      },
      camera: { reset: () => { interactions.push({ action: 'reset' }); } }
    },
    helpers: { viewportScreenshot: { getImageDataUri: async () => 'data:image/png;base64,from-helper' } }
  },
  structureInteractivity(payload) {
    interactions.push(payload);
    if (payload.action === 'select' && payload.elements) {
      selectionEntries.set('s0', { selection: { elements: [{ indices: { size: 2 } }] } });
    }
  },
  loadMvsData: async (data, format, options) => {
    interactions.push({ action: 'loadMvsData', data, format, options });
  }
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
assert.equal(summary.result.structures[0].ligands[0].label_comp_id, 'HEM');
assert.equal(summary.result.structures[0].ligands[0].category, 'small_molecule');

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
assert.equal(interactions.findLast(x => x.action === 'focus')?.focusOptions?.extraRadius, 4);

viewer.plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data = fakeStructure({ omitAuthIds: true });
context.window.BurreteAgent.attach({ viewer, plugin: viewer.plugin, config: { label: 'fake-label-only.pdb', format: 'pdb' } });
context.window.BurreteAgent.notifyStructureLoaded({ prepared: { label: 'fake-label-only.pdb', format: 'pdb' } });
const selectedViaAuthFallback = await context.window.BurreteAgent.run({ command: 'selectResidues', args: { selector: { auth_asym_id: 'A', beg_auth_seq_id: 1, end_auth_seq_id: 2 } } });
assert.equal(selectedViaAuthFallback.ok, true);
assert.equal(selectedViaAuthFallback.result.counts.residues, 2);
const ligandViaAuthFallback = await context.window.BurreteAgent.run({ command: 'focusLigand', args: { selector: { label_comp_id: 'HEM', auth_asym_id: 'B', auth_seq_id: 100 } } });
assert.equal(ligandViaAuthFallback.ok, true);
assert.equal(ligandViaAuthFallback.result.ligand.label_asym_id, 'B');
viewer.plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data = fakeStructure({ remapAuthIds: true });
context.window.BurreteAgent.attach({ viewer, plugin: viewer.plugin, config: { label: 'fake-remapped-auth.pdb', format: 'pdb' } });
context.window.BurreteAgent.notifyStructureLoaded({ prepared: { label: 'fake-remapped-auth.pdb', format: 'pdb' } });
const ligandViaLabelAlias = await context.window.BurreteAgent.run({ command: 'focusLigand', args: { selector: { label_comp_id: 'HEM', auth_asym_id: 'B', auth_seq_id: 100 } } });
assert.equal(ligandViaLabelAlias.ok, true);
assert.equal(ligandViaLabelAlias.result.ligand.label_asym_id, 'B');
viewer.plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data = fakeStructure({ omitCompIds: true });
context.window.BurreteAgent.attach({ viewer, plugin: viewer.plugin, config: { label: 'fake-no-comp-id.pdb', format: 'pdb' } });
context.window.BurreteAgent.notifyStructureLoaded({ prepared: { label: 'fake-no-comp-id.pdb', format: 'pdb' } });
const ligandViaResidueAddress = await context.window.BurreteAgent.run({ command: 'focusLigand', args: { selector: { label_comp_id: 'HEM', auth_asym_id: 'B', auth_seq_id: 100 }, showNeighborhood: true, radiusA: 4 } });
assert.equal(ligandViaResidueAddress.ok, true);
assert.equal(ligandViaResidueAddress.result.ligand.auth_asym_id, 'B');
assert.ok(ligandViaResidueAddress.result.neighborhood.residues.length > 0);

viewer.plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data = fakeStructure();
context.window.BurreteAgent.attach({ viewer, plugin: viewer.plugin, config: { label: 'fake.pdb', format: 'pdb' } });
context.window.BurreteAgent.notifyStructureLoaded({ prepared: { label: 'fake.pdb', format: 'pdb' } });
const ligByCompAlias = await context.window.BurreteAgent.run({ command: 'focusLigand', args: { selector: { comp_id: 'HEM' } } });
assert.equal(ligByCompAlias.ok, true);
assert.equal(ligByCompAlias.result.ligand.auth_seq_id, 100);

const ligWithMissingNeighborhood = await context.window.BurreteAgent.run({
  command: 'focusLigand',
  args: { selector: { comp_id: 'HEM' }, showNeighborhood: true, target: { auth_asym_id: 'Z' } }
});
assert.equal(ligWithMissingNeighborhood.ok, true);
assert.equal(ligWithMissingNeighborhood.result.ligand.label_comp_id, 'HEM');
assert.equal(ligWithMissingNeighborhood.result.neighborhood.ok, false);
assert.equal(ligWithMissingNeighborhood.result.neighborhood.error.code, 'SELECTION_EMPTY');

const label = await context.window.BurreteAgent.run({
  command: 'labelSelection',
  args: { selection: 'last', text: 'HEM A:100', textSize: 0.42 }
});
assert.equal(label.ok, true);
assert.equal(label.result.label, 'HEM A:100');
assert.equal(label.result.labels[0].selectionRef, 'label-selection-ref');
assert.equal(measurementLabels.length, 1);
assert.equal(measurementLabels[0].options.labelParams.customText, 'HEM A:100');
assert.equal(measurementLabels[0].options.labelParams.textSize, 0.42);
assert.equal(measurementLabels[0].options.reprTags[0], 'burrete-agent-label');

const shot = await context.window.BurreteAgent.run({ command: 'screenshot' });
assert.equal(shot.ok, true);
assert.equal(shot.result.dataUri, 'data:image/png;base64,from-helper');

const mvs = await context.window.BurreteAgent.run({
  command: 'loadMVS',
  args: {
    json: {
      root: {
        kind: 'root',
        children: []
      }
    },
    options: { replaceExisting: true }
  }
});
assert.equal(mvs.ok, true);
assert.equal(mvs.result.format, 'mvsj');
const loadedMvs = interactions.find(x => x.action === 'loadMvsData');
assert.ok(loadedMvs);
assert.equal(loadedMvs.format, 'mvsj');
assert.equal(JSON.parse(loadedMvs.data).root.kind, 'root');
assert.equal(loadedMvs.options.replaceExisting, true);

const bad = await context.window.BurreteAgent.run({ command: 'selectResidues', args: { selector: { auth_asym_id: 'Z' } } });
assert.equal(bad.ok, false);
assert.equal(bad.error.code, 'SELECTION_EMPTY');

console.log('burette-agent tests passed');
