import { OrderedSet } from 'molstar/lib/mol-data/int.js';
import { SIFTSMapping } from 'molstar/lib/mol-model-props/sequence/sifts-mapping.js';
import {
  QueryContext,
  StructureElement,
  StructureProperties,
  StructureSelection,
} from 'molstar/lib/mol-model/structure.js';
import {
  alignAndSuperpose,
  superpose,
} from 'molstar/lib/mol-model/structure/structure/util/superposition.js';
import { alignAndSuperposeWithSIFTSMapping } from 'molstar/lib/mol-model/structure/structure/util/superposition-sifts-mapping.js';
import { tmAlign } from 'molstar/lib/mol-model/structure/structure/util/tm-align.js';
import { StructureSelectionQueries } from 'molstar/lib/mol-plugin-state/helpers/structure-selection-query.js';

const DEFAULT_TM_ALIGN_MAX_DP_CELLS = 1_000_000;

function chainId(location) {
  const auth = String(StructureProperties.chain.auth_asym_id(location) || '').trim();
  const label = String(StructureProperties.chain.label_asym_id(location) || '').trim();
  const entity = String(StructureProperties.chain.label_entity_id(location) || '').trim();
  const operator = String(StructureProperties.unit.operator_name(location) || '').trim();
  const model = String(StructureProperties.unit.model_num(location) || '').trim();
  return [model, entity, label, auth, operator].join('|');
}

function polymerChains(structure) {
  if (!structure?.units?.length) return [];
  const location = StructureElement.Location.create(structure);
  const groups = new Map();
  for (const unit of structure.units) {
    location.unit = unit;
    const elements = unit.elements;
    for (let index = 0; index < elements.length; index += 1) {
      location.element = elements[index];
      if (StructureProperties.entity.type(location) !== 'polymer') continue;
      const id = chainId(location);
      let group = groups.get(id);
      if (!group) {
        const authChainId = String(StructureProperties.chain.auth_asym_id(location) || '').trim();
        const labelChainId = String(StructureProperties.chain.label_asym_id(location) || '').trim();
        group = {
          id,
          authChainId,
          labelChainId,
          entityId: String(StructureProperties.chain.label_entity_id(location) || '').trim(),
          operatorName: String(StructureProperties.unit.operator_name(location) || '').trim(),
          modelNumber: Number(StructureProperties.unit.model_num(location) || 0),
          atomCount: 0,
          residueKeys: new Set(),
          elements: [],
        };
        groups.set(id, group);
      }
      let unitEntry = group.elements.find(entry => entry.unit === unit);
      if (!unitEntry) {
        unitEntry = { unit, indices: [] };
        group.elements.push(unitEntry);
      }
      unitEntry.indices.push(index);
      group.atomCount += 1;
      group.residueKeys.add(StructureProperties.residue.key(location));
    }
  }
  return Array.from(groups.values()).map(group => {
    const elements = group.elements.map(({ unit, indices }) => ({
      unit,
      indices: OrderedSet.ofSortedArray(Int32Array.from(indices)),
    }));
    const displayChain = group.authChainId || group.labelChainId || '(blank)';
    return {
      id: group.id,
      label: `Chain ${displayChain} · ${group.residueKeys.size} residues`,
      authChainId: group.authChainId,
      labelChainId: group.labelChainId,
      entityId: group.entityId,
      operatorName: group.operatorName,
      modelNumber: group.modelNumber,
      residueCount: group.residueKeys.size,
      atomCount: group.atomCount,
      loci: StructureElement.Loci(structure, elements),
    };
  }).sort((left, right) => right.residueCount - left.residueCount || left.label.localeCompare(right.label));
}

function remappedSelectionLoci(entry, traceOnly = true) {
  const root = entry?.root;
  const loci = entry?.loci;
  if (!root || !loci || StructureElement.Loci.isEmpty(loci)) {
    throw new Error('Superposition needs a non-empty polymer-chain selection.');
  }
  const selectionStructure = StructureElement.Loci.toStructure(loci);
  const query = traceOnly ? StructureSelectionQueries.trace.query : StructureSelectionQueries.polymer.query;
  const selected = StructureSelection.toLociWithSourceUnits(query(new QueryContext(selectionStructure)));
  return StructureElement.Loci.remap(selected, root);
}

function validatedEntries(entries, minimum = 2) {
  if (!Array.isArray(entries) || entries.length < minimum) {
    throw new Error(`Superposition needs ${minimum} or more entries.`);
  }
  return entries;
}

function alignChains(entries, options = {}) {
  const input = validatedEntries(entries).map(entry => remappedSelectionLoci(entry, options.traceOnly !== false));
  const transforms = options.alignSequences === false ? superpose(input) : alignAndSuperpose(input);
  return transforms.map((transform, index) => ({
    movingIndex: index + 1,
    matrix: transform.bTransform,
    rmsdAngstrom: transform.rmsd,
    matchedCount: StructureElement.Loci.size(input[index + 1]),
    matchedUnit: options.traceOnly === false ? 'atoms' : 'residues',
    alignmentScore: Number.isFinite(transform.alignmentScore) ? transform.alignmentScore : null,
  }));
}

function alignAtoms(locis) {
  const input = validatedEntries(locis).map(loci => {
    if (!loci || StructureElement.Loci.isEmpty(loci)) throw new Error('Atom superposition received an empty selection.');
    return loci;
  });
  const count = StructureElement.Loci.size(input[0]);
  if (count < 3 || input.some(loci => StructureElement.Loci.size(loci) !== count)) {
    throw new Error('Atom superposition needs the same ordered set of at least three atoms from every structure.');
  }
  return superpose(input).map((transform, index) => ({
    movingIndex: index + 1,
    matrix: transform.bTransform,
    rmsdAngstrom: transform.rmsd,
    matchedCount: count,
    matchedUnit: 'atoms',
  }));
}

function alignWithTM(entries, options = {}) {
  const input = validatedEntries(entries).map(entry => remappedSelectionLoci(entry, true));
  const referenceLength = StructureElement.Loci.size(input[0]);
  const maximumCells = Number.isFinite(options.maxDpCells)
    ? Math.max(1, Math.trunc(options.maxDpCells))
    : DEFAULT_TM_ALIGN_MAX_DP_CELLS;
  return input.slice(1).map((moving, index) => {
    const movingLength = StructureElement.Loci.size(moving);
    const dpCells = (referenceLength + 1) * (movingLength + 1);
    if (dpCells > maximumCells) {
      throw new Error(`TM-align needs ${dpCells.toLocaleString()} DP cells; the interactive limit is ${maximumCells.toLocaleString()}.`);
    }
    const result = tmAlign(input[0], moving);
    return {
      movingIndex: index + 1,
      matrix: result.bTransform,
      rmsdAngstrom: result.rmsd,
      matchedCount: result.alignedLength,
      matchedUnit: 'residues',
      tmScores: {
        referenceNormalized: result.tmScoreA,
        movingNormalized: result.tmScoreB,
      },
      dpCells,
    };
  });
}

function canAlignWithSifts(structures) {
  return Array.isArray(structures)
    && structures.length >= 2
    && structures.every(structure => structure?.models?.some(model => SIFTSMapping.Provider.isApplicable(model)));
}

function alignWithSifts(structures) {
  const input = validatedEntries(structures);
  if (!canAlignWithSifts(input)) {
    throw new Error('UniProt superposition needs applicable SIFTS mapping in every structure.');
  }
  const result = alignAndSuperposeWithSIFTSMapping(input, { traceOnly: true });
  if (result.failedPairs.length || result.zeroOverlapPairs.length || result.entries.length !== input.length - 1) {
    const problems = [];
    if (result.zeroOverlapPairs.length) problems.push(`${result.zeroOverlapPairs.length} pair(s) have no UniProt overlap`);
    if (result.failedPairs.length) problems.push(`${result.failedPairs.length} pair(s) failed`);
    if (result.entries.length !== input.length - 1) problems.push('not every moving structure produced a transform');
    throw new Error(`UniProt superposition did not commit: ${problems.join('; ')}.`);
  }
  return result.entries.map(entry => ({
    movingIndex: entry.other,
    matrix: entry.transform.bTransform,
    rmsdAngstrom: entry.transform.rmsd,
    matchedCount: null,
    matchedUnit: 'mapped residues',
  }));
}

export const BuretteSuperposition = Object.freeze({
  version: 1,
  defaultTmAlignMaxDpCells: DEFAULT_TM_ALIGN_MAX_DP_CELLS,
  polymerChains,
  alignChains,
  alignAtoms,
  alignWithTM,
  canAlignWithSifts,
  alignWithSifts,
});
