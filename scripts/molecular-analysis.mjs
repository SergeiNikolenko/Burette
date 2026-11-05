import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parsePDB } from 'molstar/lib/commonjs/mol-io/reader/pdb/parser.js';
import { CIF } from 'molstar/lib/commonjs/mol-io/reader/cif.js';
import { trajectoryFromPDB } from 'molstar/lib/commonjs/mol-model-formats/structure/pdb.js';
import { trajectoryFromMmCIF } from 'molstar/lib/commonjs/mol-model-formats/structure/mmcif.js';
import { Structure, StructureElement, StructureProperties, Unit } from 'molstar/lib/commonjs/mol-model/structure.js';
import { OrderedSet } from 'molstar/lib/commonjs/mol-data/int.js';
import { tmAlign } from 'molstar/lib/commonjs/mol-model/structure/structure/util/tm-align.js';

const MAX_ATOMS = 20000;
const MAX_PAIRS = 5000000;
const RESULT_LIMIT = 500;
const radii = { C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, F: 1.47, CL: 1.75, BR: 1.85, I: 1.98 };
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const distanceSquared = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

async function loadDocument(document) {
  if ((await stat(document.path)).size > 16 * 1024 * 1024) fail('INPUT_LIMIT', 'A structure source exceeds 16 MiB.');
  const bytes = await readFile(document.path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (document.sha256 && document.sha256 !== sha256) fail('SOURCE_CHANGED', 'The immutable structure source digest changed.');
  const text = bytes.toString('utf8');
  let trajectory;
  if (['pdb', 'ent'].includes(document.format)) {
    const parsed = await parsePDB(text).run();
    if (parsed.isError) fail('INVALID_STRUCTURE', String(parsed.message));
    trajectory = await trajectoryFromPDB(parsed.result).run();
  } else if (['cif', 'mmcif'].includes(document.format)) {
    const parsed = await CIF.parseText(text).run();
    if (parsed.isError || parsed.result.blocks.length !== 1) fail('INVALID_STRUCTURE', 'Provide one valid mmCIF data block.');
    trajectory = await trajectoryFromMmCIF(parsed.result.blocks[0]).run();
  } else fail('UNSUPPORTED_FORMAT', 'Autonomous analysis supports PDB and mmCIF sources.');
  if (trajectory.frameCount !== 1) fail('AMBIGUOUS_MODEL', 'Select a single coordinate model before autonomous analysis.');
  const structure = Structure.ofModel(trajectory.representative);
  if (!structure.elementCount || structure.elementCount > 200000) fail('INPUT_LIMIT', 'A structure must contain 1–200,000 atoms.');
  const atoms = [], location = StructureElement.Location.create(structure);
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) continue;
    location.unit = unit;
    for (let index = 0; index < unit.elements.length; index++) {
      location.element = unit.elements[index];
      const position = [0, 0, 0];
      unit.conformation.position(location.element, position);
      if (position.some(value => !Number.isFinite(value))) fail('INVALID_STRUCTURE', 'Atom coordinates must be finite.');
      atoms.push({ unit, index, position, chain: StructureProperties.chain.auth_asym_id(location),
        labelChain: StructureProperties.chain.label_asym_id(location), residue: StructureProperties.residue.auth_seq_id(location),
        insertionCode: StructureProperties.residue.pdbx_PDB_ins_code(location) || '',
        component: StructureProperties.atom.label_comp_id(location), name: StructureProperties.atom.label_atom_id(location),
        element: StructureProperties.atom.type_symbol(location).toUpperCase(),
        polymer: StructureProperties.entity.type(location) === 'polymer' });
    }
  }
  return { documentId: document.id, sha256, structure, atoms };
}

function select(loaded, selection) {
  const document = loaded.find(value => value.documentId === selection?.documentId);
  if (!document) fail('INVALID_SELECTION', 'Select an authorized documentId.');
  const atoms = document.atoms.filter(atom => (selection.chain == null || atom.chain === selection.chain)
    && (!selection.residues || selection.residues.includes(atom.residue)) && !['H', 'D', 'T'].includes(atom.element));
  if (!atoms.length || atoms.length > MAX_ATOMS) fail('SELECTION_LIMIT', `A selection must contain 1–${MAX_ATOMS} heavy atoms.`);
  if (selection.chain != null && new Set(atoms.map(atom => atom.labelChain)).size > 1) fail('AMBIGUOUS_CHAIN', 'Author chain ID maps to multiple label chains.');
  if (selection.residues && atoms.some(atom => atom.insertionCode)) fail('AMBIGUOUS_RESIDUE', 'Numeric residue selection includes insertion codes; use an unambiguous chain selection.');
  if (selection.residues?.some(residue => !atoms.some(atom => atom.residue === residue))) fail('INVALID_SELECTION', 'A requested author residue is absent from the selection.');
  return { document, atoms };
}

function identity(atom) {
  return { chain: atom.chain, residue: atom.residue, insertionCode: atom.insertionCode, component: atom.component, atom: atom.name };
}

function contactResult(first, second, cutoff) {
  if (first.atoms.length * second.atoms.length > MAX_PAIRS) fail('COMPUTATION_LIMIT', 'Contact search exceeds 5,000,000 atom pairs.');
  let count = 0;
  const contacts = [];
  for (const a of first.atoms) for (const b of second.atoms) {
    const distance = distanceSquared(a.position, b.position);
    if (distance <= cutoff ** 2) {
      count++;
      if (contacts.length < RESULT_LIMIT) contacts.push({ first: identity(a), second: identity(b), distanceAngstrom: Math.sqrt(distance) });
    }
  }
  return { atomContactCount: count, contacts, returnedCount: contacts.length, truncated: count > contacts.length,
    method: { name: 'Closest heavy-atom Euclidean contacts', cutoffAngstrom: cutoff } };
}

function sasa(atoms, probeRadius, samples) {
  const points = Array.from({ length: samples }, (_, index) => {
    const y = 1 - 2 * (index + 0.5) / samples;
    const radial = Math.sqrt(1 - y * y), angle = index * Math.PI * (3 - Math.sqrt(5));
    return [Math.cos(angle) * radial, y, Math.sin(angle) * radial];
  });
  const spheres = atoms.map(atom => {
    if (!Object.hasOwn(radii, atom.element)) fail('UNSUPPORTED_ELEMENT', `No declared SASA radius for ${atom.element}.`);
    return { position: atom.position, radius: radii[atom.element] + probeRadius };
  });
  const cellWidth = 2 * Math.max(...spheres.map(sphere => sphere.radius)), cells = new Map();
  const cell = position => position.map(value => Math.floor(value / cellWidth));
  spheres.forEach((sphere, index) => {
    const key = cell(sphere.position).join(',');
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(index);
  });
  let total = 0, comparisons = 0;
  for (let index = 0; index < spheres.length; index++) {
    const sphere = spheres[index], coordinates = cell(sphere.position), neighbors = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const other of cells.get([coordinates[0] + dx, coordinates[1] + dy, coordinates[2] + dz].join(',')) || []) {
        if (other !== index && distanceSquared(sphere.position, spheres[other].position) < (sphere.radius + spheres[other].radius) ** 2) neighbors.push(spheres[other]);
      }
    }
    comparisons += neighbors.length * samples;
    if (comparisons > 100000000) fail('COMPUTATION_LIMIT', 'SASA exceeds 100,000,000 candidate sample comparisons.');
    let accessible = 0;
    for (const point of points) {
      const position = point.map((value, axis) => sphere.position[axis] + value * sphere.radius);
      if (!neighbors.some(other => distanceSquared(position, other.position) < other.radius ** 2)) accessible++;
    }
    total += 4 * Math.PI * sphere.radius ** 2 * accessible / samples;
  }
  return total;
}

function buriedArea(first, second, probeRadius, samples) {
  const firstSasaSquareAngstrom = sasa(first.atoms, probeRadius, samples);
  const secondSasaSquareAngstrom = sasa(second.atoms, probeRadius, samples);
  const complexSasaSquareAngstrom = sasa([...first.atoms, ...second.atoms], probeRadius, samples);
  const totalSasaLossSquareAngstrom = firstSasaSquareAngstrom + secondSasaSquareAngstrom - complexSasaSquareAngstrom;
  return { firstSasaSquareAngstrom, secondSasaSquareAngstrom, complexSasaSquareAngstrom, totalSasaLossSquareAngstrom,
    interfaceAreaSquareAngstrom: totalSasaLossSquareAngstrom / 2,
    method: { name: 'Shrake–Rupley', radii: 'Bondi element radii (explicit table)', radiiAngstrom: radii,
      probeRadiusAngstrom: probeRadius, sphereSamples: samples, sphereSampling: 'Midpoint Fibonacci sphere, y axis',
      areaConvention: 'Interface area is half the total SASA loss of both partners' } };
}

function traceLoci(selection) {
  const elements = new Map(), residueKeys = new Set();
  const trace = selection.atoms.filter(atom => atom.polymer && atom.name === 'CA' && atom.element === 'C');
  if (new Set(trace.map(atom => atom.labelChain)).size > 1) fail('AMBIGUOUS_CHAIN', 'TM-align requires one polymer chain per partner.');
  for (const atom of trace) {
    const key = `${atom.labelChain}:${atom.residue}:${atom.insertionCode}`;
    if (residueKeys.has(key)) fail('AMBIGUOUS_RESIDUE', 'TM-align requires one C-alpha atom per residue; resolve alternate conformations first.');
    residueKeys.add(key);
    if (!elements.has(atom.unit)) elements.set(atom.unit, []);
    elements.get(atom.unit).push(atom.index);
  }
  const loci = StructureElement.Loci(selection.document.structure, [...elements].map(([unit, indices]) => ({ unit, indices: OrderedSet.ofSortedArray(Int32Array.from(indices)) })));
  const count = StructureElement.Loci.size(loci);
  if (count < 3) fail('INVALID_SELECTION', 'TM-align requires at least three polymer C-alpha atoms per partner.');
  return { loci, count };
}

function align(first, second) {
  const a = traceLoci(first), b = traceLoci(second), dpCells = (a.count + 1) * (b.count + 1);
  if (dpCells > 1000000) fail('COMPUTATION_LIMIT', 'TM-align exceeds 1,000,000 dynamic-programming cells.');
  const result = tmAlign(a.loci, b.loci);
  if (result.alignedLength < 3 || [result.rmsd, result.tmScoreA, result.tmScoreB, ...result.bTransform].some(value => !Number.isFinite(value))) fail('ALIGNMENT_FAILED', 'TM-align did not return a finite alignment of at least three residues.');
  return { alignedCount: result.alignedLength, rmsdAngstrom: result.rmsd,
    tmScores: { referenceNormalized: result.tmScoreA, movingNormalized: result.tmScoreB },
    transform: { movingDocumentId: second.document.documentId, referenceDocumentId: first.document.documentId,
      matrix: Array.from(result.bTransform), convention: 'Column-major 4×4; moving coordinates onto reference' },
    method: { name: 'Mol* TM-align', version: '5.11.0', atomSelection: 'Polymer C-alpha', referenceResidues: a.count, movingResidues: b.count, dpCells } };
}

export async function runMolecularAnalysis({ documents, action }) {
  const loaded = await Promise.all(documents.map(loadDocument));
  const sources = loaded.map(({ documentId, sha256 }) => ({ documentId, sha256 }));
  if (action.type === 'inspect') {
    const inventory = loaded.map(document => {
      const chains = new Map();
      for (const atom of document.atoms) {
        const key = `${atom.chain}|${atom.labelChain}`;
        if (!chains.has(key)) chains.set(key, { chain: atom.chain, labelChain: atom.labelChain, atomCount: 0, polymer: atom.polymer });
        chains.get(key).atomCount++;
      }
      return { documentId: document.documentId, atomCount: document.atoms.length, chains: [...chains.values()].slice(0, 100),
        chainCount: chains.size, truncated: chains.size > 100 };
    });
    return { type: action.type, sources, inventory };
  }
  const first = select(loaded, action.selection), second = select(loaded, action.target);
  if (first.document === second.document) {
    const ids = new Set(first.atoms.map(atom => `${atom.unit.id}:${atom.index}`));
    if (second.atoms.some(atom => ids.has(`${atom.unit.id}:${atom.index}`))) fail('OVERLAPPING_SELECTIONS', 'Partner selections must be atom-disjoint.');
  }
  let result;
  if (action.type === 'contacts') result = contactResult(first, second, action.cutoff ?? 4);
  else if (action.type === 'buried_area') result = buriedArea(first, second, action.probeRadius ?? 1.4, action.samples ?? 240);
  else if (action.type === 'align') result = align(first, second);
  else fail('UNSUPPORTED_ACTION', 'Unsupported autonomous molecular analysis.');
  return { type: action.type, sources, partnerAtomCounts: [first.atoms.length, second.atoms.length], ...result };
}
