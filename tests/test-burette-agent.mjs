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
  // Real Mol* keeps the component name on the atom table; older shapes put it on
  // residues. Both are exercised so reading it cannot regress to one of them.
  const compIdsOnAtoms = options.compIdsOnAtoms === true;
  const atomCompIds = omitCompIds
    ? [undefined, undefined, undefined, undefined, undefined, undefined]
    : ['GLY', 'GLY', 'ALA', 'ALA', 'HEM', 'HEM'];
  const residueCompIds = omitCompIds ? [undefined, undefined, undefined] : ['GLY', 'ALA', 'HEM'];
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
        type_symbol: col(['N', 'C', 'N', 'C', 'C', 'N']),
        ...(compIdsOnAtoms ? { label_comp_id: col(atomCompIds), auth_comp_id: col(atomCompIds) } : {})
      },
      residues: {
        label_comp_id: col(compIdsOnAtoms ? [undefined, undefined, undefined] : residueCompIds),
        auth_comp_id: col(compIdsOnAtoms ? [undefined, undefined, undefined] : residueCompIds),
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

function fakeSpcWaterStructure() {
  const model = {
    modelNum: 0,
    atomicHierarchy: {
      atoms: {
        id: col([1, 2, 3]),
        label_atom_id: col(['OW', 'HW1', 'HW2']),
        auth_atom_id: col(['OW', 'HW1', 'HW2']),
        type_symbol: col(['O', 'H', 'H'])
      },
      residues: {
        label_comp_id: col(['SPC']),
        auth_comp_id: col(['SPC']),
        label_seq_id: col([1]),
        auth_seq_id: col([1]),
        pdbx_PDB_ins_code: col([undefined])
      },
      chains: {
        label_entity_id: col(['1']),
        label_asym_id: col(['W']),
        auth_asym_id: col(['W'])
      },
      residueAtomSegments: { index: col([0, 0, 0]) },
      chainAtomSegments: { index: col([0, 0, 0]) }
    },
    entities: {
      getEntityIndex: id => id === '1' ? 0 : undefined,
      data: { type: col(['non-polymer']), id: col(['1']), rowCount: 1 }
    }
  };
  return {
    units: [{ id: 1, elements: [0, 1, 2], model, conformation: { position: (i, out) => { out[0] = i; out[1] = 0; out[2] = 0; } } }]
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
  btoa: value => Buffer.from(value, 'binary').toString('base64'),
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

const screenshotValues = {
  value: {
    resolution: { name: 'viewport', params: {} },
    format: { name: 'png', params: {} },
    transparent: false,
    axes: { name: 'off', params: {} },
    illumination: { extraIterations: 1, targetIterationTimeMs: 300 }
  },
  next(value) { this.value = value; }
};
const screenshotCropParams = { value: { auto: true, relativePadding: 0.1 }, next(value) { this.value = value; } };
const screenshotRelativeCrop = { value: { x: 0, y: 0, width: 1, height: 1 }, next(value) { this.value = value; } };
const assemblyAction = {
  definition: {
    display: { name: 'Assembly Symmetry' },
    params: { serverUrl: { defaultValue: 'https://data.rcsb.org/graphql' } }
  }
};
const structureCell = { transform: { ref: 's0' }, obj: { data: fakeStructure(), label: 'fake.pdb' } };
const stateCells = new Map([['s0', structureCell]]);
const snapshotEntries = [
  { name: 'Overview', key: 'overview', snapshot: { id: 'story-1' } },
  { name: 'Pocket', key: 'pocket', snapshot: { id: 'story-2' } }
];
const snapshotManager = {
  state: { entries: snapshotEntries, current: 'story-1', isPlaying: false, nextSnapshotDelayInMs: 1500 },
  applyNext: async direction => {
    snapshotManager.state.current = direction > 0 ? 'story-2' : 'story-1';
  },
  setCurrent: id => {
    snapshotManager.state.current = id;
    return snapshotEntries.find(entry => entry.snapshot.id === id)?.snapshot;
  },
  play: async () => { snapshotManager.state.isPlaying = true; },
  stop: async () => { snapshotManager.state.isPlaying = false; },
  serialize: async ({ type }) => new Blob([type === 'molx' ? 'molx-session' : '{"session":true}'], {
    type: type === 'molx' ? 'application/zip' : 'application/json'
  })
};
const appliedThemes = [];
const viewer = {
  plugin: {
    query: { structure: { registry: { list: [{ referencesCurrent: true, label: 'Current Selection' }] } } },
    state: {
      data: {
        cells: stateCells,
        actions: { fromCell: cell => cell === structureCell ? [assemblyAction] : [] },
        applyAction: (action, params, ref) => async () => {
          assert.equal(action, assemblyAction);
          stateCells.set('symmetry', {
            transform: { ref: 'symmetry' },
            obj: { label: 'Global Symmetry', description: 'Icosahedral (I)' }
          });
          interactions.push({ action: 'assemblySymmetry', params, ref });
        }
      },
      setSnapshot: async snapshot => interactions.push({ action: 'setSnapshot', snapshot })
    },
    runTask: async task => typeof task === 'function' ? task() : task,
    managers: {
      structure: {
        hierarchy: { current: { structures: [{ cell: structureCell }] } },
        selection: { entries: selectionEntries, clear: () => selectionEntries.clear() },
        component: {
          applyTheme: async params => appliedThemes.push(params)
        },
        measurement: {
          addLabel: async (loci, options) => {
            measurementLabels.push({ loci, options });
            return { selection: { ref: 'label-selection-ref' }, representation: { ref: 'label-representation-ref' } };
          }
        }
      },
      camera: { reset: () => { interactions.push({ action: 'reset' }); } },
      snapshot: snapshotManager
    },
    helpers: {
      viewportScreenshot: {
        behaviors: { values: screenshotValues, cropParams: screenshotCropParams, relativeCrop: screenshotRelativeCrop },
        getSizeAndViewport: () => ({ viewport: { width: 640, height: 360 } }),
        getImageDataUri: async () => `data:image/${screenshotValues.value.format.name};base64,from-helper`
      }
    }
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

context.window.BuretteAgent.attach({ viewer, plugin: viewer.plugin, config: { label: 'fake.pdb', format: 'pdb' } });
context.window.BuretteAgent.notifyStructureLoaded({ prepared: { label: 'fake.pdb', format: 'pdb' } });

const capabilities = await context.window.BuretteAgent.run({ command: 'capabilities' });
assert.equal(capabilities.ok, true);
assert.equal(capabilities.result.hasViewer, true);
assert.equal(capabilities.result.hasStructureInteractivity, true);

const summary = await context.window.BuretteAgent.run({ command: 'summary', args: { includeLigands: true } });
assert.equal(summary.ok, true);
assert.equal(summary.result.counts.atoms, 6);
assert.equal(summary.result.counts.ligands, 1);
assert.equal(summary.result.structures[0].chains.length, 2);
assert.equal(summary.result.structures[0].ligands[0].label_comp_id, 'HEM');
assert.equal(summary.result.structures[0].ligands[0].category, 'small_molecule');

const selected = await context.window.BuretteAgent.run({ command: 'selectResidues', args: { selector: { auth_asym_id: 'A', beg_auth_seq_id: 1, end_auth_seq_id: 2 } } });
assert.equal(selected.ok, true);
assert.equal(selected.result.counts.residues, 2);
assert.ok(selected.result.selectionId.startsWith('sel-'));
assert.ok(interactions.some(x => x.action === 'select'));

interactions.length = 0;
const selectedAtomRange = await context.window.BuretteAgent.run({
  command: 'selectResidues',
  args: { selector: { atom_index: [1, 2, 3] }, granularity: 'atom' }
});
assert.equal(selectedAtomRange.ok, true);
assert.equal(selectedAtomRange.result.counts.atoms, 3);
assert.deepEqual(
  interactions.filter(x => x.action === 'select' && x.elements).map(x => x.elements.atom_index),
  [1, 2, 3],
);
assert.ok(interactions.every(x => !Array.isArray(x.elements?.atom_index)));

const focus = await context.window.BuretteAgent.run({ command: 'focusSelection', args: { selection: 'last' } });
assert.equal(focus.ok, true);
assert.ok(interactions.some(x => x.action === 'focus'));
assert.equal(interactions.findLast(x => x.action === 'focus')?.focusOptions?.optimizeDirection, true);
assert.equal(interactions.findLast(x => x.action === 'focus')?.focusOptions?.zoomOut, true);

const lig = await context.window.BuretteAgent.run({ command: 'focusLigand', args: { selector: { label_comp_id: 'HEM' }, showNeighborhood: true, radiusA: 4 } });
assert.equal(lig.ok, true);
assert.equal(lig.result.ligand.label_comp_id, 'HEM');
assert.ok(lig.result.neighborhood.residues.some(r => r.auth_asym_id === 'A'));
assert.equal(interactions.findLast(x => x.action === 'focus')?.focusOptions?.extraRadius, 4);

viewer.plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data = fakeStructure({ omitAuthIds: true });
context.window.BuretteAgent.attach({ viewer, plugin: viewer.plugin, config: { label: 'fake-label-only.pdb', format: 'pdb' } });
context.window.BuretteAgent.notifyStructureLoaded({ prepared: { label: 'fake-label-only.pdb', format: 'pdb' } });
const selectedViaAuthFallback = await context.window.BuretteAgent.run({ command: 'selectResidues', args: { selector: { auth_asym_id: 'A', beg_auth_seq_id: 1, end_auth_seq_id: 2 } } });
assert.equal(selectedViaAuthFallback.ok, true);
assert.equal(selectedViaAuthFallback.result.counts.residues, 2);
const ligandViaAuthFallback = await context.window.BuretteAgent.run({ command: 'focusLigand', args: { selector: { label_comp_id: 'HEM', auth_asym_id: 'B', auth_seq_id: 100 } } });
assert.equal(ligandViaAuthFallback.ok, true);
assert.equal(ligandViaAuthFallback.result.ligand.label_asym_id, 'B');
viewer.plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data = fakeStructure({ remapAuthIds: true });
context.window.BuretteAgent.attach({ viewer, plugin: viewer.plugin, config: { label: 'fake-remapped-auth.pdb', format: 'pdb' } });
context.window.BuretteAgent.notifyStructureLoaded({ prepared: { label: 'fake-remapped-auth.pdb', format: 'pdb' } });
const ligandViaLabelAlias = await context.window.BuretteAgent.run({ command: 'focusLigand', args: { selector: { label_comp_id: 'HEM', auth_asym_id: 'B', auth_seq_id: 100 } } });
assert.equal(ligandViaLabelAlias.ok, true);
assert.equal(ligandViaLabelAlias.result.ligand.label_asym_id, 'B');
viewer.plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data = fakeStructure({ omitCompIds: true });
context.window.BuretteAgent.attach({ viewer, plugin: viewer.plugin, config: { label: 'fake-no-comp-id.pdb', format: 'pdb' } });
context.window.BuretteAgent.notifyStructureLoaded({ prepared: { label: 'fake-no-comp-id.pdb', format: 'pdb' } });
const ligandViaResidueAddress = await context.window.BuretteAgent.run({ command: 'focusLigand', args: { selector: { label_comp_id: 'HEM', auth_asym_id: 'B', auth_seq_id: 100 }, showNeighborhood: true, radiusA: 4 } });
assert.equal(ligandViaResidueAddress.ok, true);
assert.equal(ligandViaResidueAddress.result.ligand.auth_asym_id, 'B');
assert.ok(ligandViaResidueAddress.result.neighborhood.residues.length > 0);

// Real Mol* carries the component name on the atom table and leaves the residue
// one without it. Read from residues only, every atom reached classify() with an
// empty name, so ions were filed as ligands and no comp-id selector matched.
viewer.plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data = fakeStructure({ compIdsOnAtoms: true });
context.window.BuretteAgent.attach({ viewer, plugin: viewer.plugin, config: { label: 'fake-atom-comp-id.pdb', format: 'pdb' } });
context.window.BuretteAgent.notifyStructureLoaded({ prepared: { label: 'fake-atom-comp-id.pdb', format: 'pdb' } });
const summaryFromAtomTable = await context.window.BuretteAgent.run({ command: 'summary', args: { includeLigands: true } });
assert.equal(summaryFromAtomTable.ok, true);
assert.equal(summaryFromAtomTable.result.structures[0].ligands[0].label_comp_id, 'HEM');
const ligandFromAtomTable = await context.window.BuretteAgent.run({ command: 'focusLigand', args: { selector: { label_comp_id: 'HEM' } } });
assert.equal(ligandFromAtomTable.ok, true);
assert.equal(ligandFromAtomTable.result.ligand.auth_seq_id, 100);

viewer.plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data = fakeStructure();
context.window.BuretteAgent.attach({ viewer, plugin: viewer.plugin, config: { label: 'fake.pdb', format: 'pdb' } });
context.window.BuretteAgent.notifyStructureLoaded({ prepared: { label: 'fake.pdb', format: 'pdb' } });
const ligByCompAlias = await context.window.BuretteAgent.run({ command: 'focusLigand', args: { selector: { comp_id: 'HEM' } } });
assert.equal(ligByCompAlias.ok, true);
assert.equal(ligByCompAlias.result.ligand.auth_seq_id, 100);

const ligWithMissingNeighborhood = await context.window.BuretteAgent.run({
  command: 'focusLigand',
  args: { selector: { comp_id: 'HEM' }, showNeighborhood: true, target: { auth_asym_id: 'Z' } }
});
assert.equal(ligWithMissingNeighborhood.ok, true);
assert.equal(ligWithMissingNeighborhood.result.ligand.label_comp_id, 'HEM');
assert.equal(ligWithMissingNeighborhood.result.neighborhood.ok, false);
assert.equal(ligWithMissingNeighborhood.result.neighborhood.error.code, 'SELECTION_EMPTY');

viewer.plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data = fakeSpcWaterStructure();
context.window.BuretteAgent.attach({ viewer, plugin: viewer.plugin, config: { label: 'fake-spc-water.pdb', format: 'pdb' } });
context.window.BuretteAgent.notifyStructureLoaded({ prepared: { label: 'fake-spc-water.pdb', format: 'pdb' } });
const spcWater = await context.window.BuretteAgent.run({ command: 'selectResidues', args: { selector: { kind: 'water' } } });
assert.equal(spcWater.ok, true);
assert.equal(spcWater.result.counts.atoms, 3);
assert.equal(spcWater.result.counts.residues, 1);

const label = await context.window.BuretteAgent.run({
  command: 'labelSelection',
  args: { selection: 'last', text: 'HEM A:100', textSize: 0.42 }
});
assert.equal(label.ok, true);
assert.equal(label.result.label, 'HEM A:100');
assert.equal(label.result.labels[0].selectionRef, 'label-selection-ref');
assert.equal(measurementLabels.length, 1);
assert.equal(measurementLabels[0].options.labelParams.customText, 'HEM A:100');
assert.equal(measurementLabels[0].options.labelParams.textSize, 0.42);
assert.equal(measurementLabels[0].options.reprTags[0], 'burette-agent-label');

const shot = await context.window.BuretteAgent.run({
  command: 'screenshot',
  args: { width: 640, height: 360, format: 'jpeg', quality: 0.8, transparent: true, autoCrop: false }
});
assert.equal(shot.ok, true);
assert.equal(shot.result.dataUri, 'data:image/jpeg;base64,from-helper');
assert.equal(shot.result.mimeType, 'image/jpeg');
assert.equal(shot.result.width, 640);
assert.equal(shot.result.height, 360);
assert.equal(screenshotValues.value.format.name, 'png');

const symmetry = await context.window.BuretteAgent.run({ command: 'showAssemblySymmetry' });
assert.equal(symmetry.ok, true);
assert.equal(symmetry.result.objects[0].label, 'Global Symmetry');
assert.equal(symmetry.result.objects[0].description, 'Icosahedral (I)');

viewer.plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data = fakeStructure();
const scalar = await context.window.BuretteAgent.run({
  command: 'colorScalarField',
  args: { mode: 'fukui-fplus', values: [-0.5, -0.2, 0, 0.1, 0.3, 0.8], provenance: { method: 'GFN2-xTB' } }
});
assert.equal(scalar.ok, true);
assert.equal(scalar.result.atomCount, 6);
assert.equal(scalar.result.scale.center, 0);
assert.equal(scalar.result.provenance.method, 'GFN2-xTB');
assert.ok(appliedThemes.length >= 3);

const storyBefore = await context.window.BuretteAgent.run({ command: 'observeStory' });
assert.equal(storyBefore.ok, true);
assert.equal(storyBefore.result.count, 2);
assert.equal(storyBefore.result.currentIndex, 0);
const storyNext = await context.window.BuretteAgent.run({ command: 'controlStory', args: { action: 'next' } });
assert.equal(storyNext.ok, true);
assert.equal(storyNext.result.currentIndex, 1);
const session = await context.window.BuretteAgent.run({ command: 'exportSession', args: { type: 'molx' } });
assert.equal(session.ok, true);
assert.equal(session.result.mimeType, 'application/zip');
assert.equal(Buffer.from(session.result.dataBase64, 'base64').toString(), 'molx-session');

const mvs = await context.window.BuretteAgent.run({
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

const bad = await context.window.BuretteAgent.run({ command: 'selectResidues', args: { selector: { auth_asym_id: 'Z' } } });
assert.equal(bad.ok, false);
assert.equal(bad.error.code, 'SELECTION_EMPTY');

console.log('burette-agent tests passed');
