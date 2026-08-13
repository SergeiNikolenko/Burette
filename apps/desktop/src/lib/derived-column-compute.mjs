// Structure-derived column definitions and per-row compute, shared verbatim
// between the app (via the derived-columns hook) and the node golden tests.
// Engines are injected so this module never loads WASM or bundles itself:
// `ocl` is the openchemlib namespace, `rdkit` is an initialized RDKitModule.

export const DERIVED_COLUMN_KINDS = {
  formula: { columnId: "Formula", label: "Molecular Formula", engine: "ocl" },
  "canonical-smiles": { columnId: "CanonicalSMILES", label: "Canonical SMILES", engine: "rdkit" },
  inchi: { columnId: "InChI", label: "InChI", engine: "rdkit" },
  inchikey: { columnId: "InChIKey", label: "InChI-Key", engine: "rdkit" },
  idcode: { columnId: "IDCode", label: "Canonical Code", engine: "ocl" },
  // DataWarrior's Keep Largest Fragment, delivered as a column rather than as a
  // rewrite of the structure: the salt or counter-ion is dropped and the parent
  // compound is what the column carries, leaving the original untouched.
  "largest-fragment": { columnId: "LargestFragment", label: "Largest Fragment", engine: "ocl" },
  "murcko-scaffold": { columnId: "Scaffold", label: "Murcko Scaffold", engine: "ocl" },
  // Reaction columns. A row's reaction comes either as an MDL $RXN block (.rxn,
  // .rdf) or as a reaction SMILES (a CSV column); both are read through the same
  // parts split, so the columns say the same thing whichever way it arrived.
  "reaction-smiles": { columnId: "ReactionSMILES", label: "Reaction SMILES", engine: "ocl" },
  "reaction-reactants": { columnId: "Reactants", label: "Reactants", engine: "ocl" },
  "reaction-catalysts": { columnId: "Catalysts", label: "Catalysts", engine: "ocl" },
  "reaction-products": { columnId: "Products", label: "Products", engine: "ocl" },
  "reaction-transformation": { columnId: "Transformation", label: "Transformation", engine: "ocl" },
};

// Analyse Scaffolds writes a second column beside the scaffold: how many
// molecules of the collection share it. The scaffold alone sorts a series; the
// count is what turns the sorted list into an answer.
export const SCAFFOLD_COUNT_COLUMN = {
  columnId: "ScaffoldCount",
  label: "Scaffold Molecule Count",
};

function oclMoleculeFromRow(ocl, row) {
  const molblock = typeof row.molblock === "string" ? row.molblock.trim() : "";
  if (molblock) return ocl.Molecule.fromMolfile(row.molblock);
  const smiles = typeof row.smiles === "string" ? row.smiles.trim() : "";
  if (smiles) return ocl.Molecule.fromSmiles(smiles);
  throw new Error("Row has no structure");
}

// --- Reactions -------------------------------------------------------------

// An MDL reaction block, as written by .rxn files, by the $RXN payload of an
// .rdf record, and by Ketcher's getRxn().
export function looksLikeRxnBlock(text) {
  return /^\s*\$RXN/u.test(String(text ?? ""));
}

// A reaction SMILES is `reactants>agents>products`, and '>' occurs in SMILES
// nowhere else, so counting the separators identifies one.
export function looksLikeReactionSmiles(text) {
  const value = String(text ?? "").trim();
  if (!value || /\s/u.test(value)) return false;
  const parts = value.split(">");
  return parts.length === 3 && parts[0].trim() !== "" && parts[2].trim() !== "";
}

// Where a row keeps its reaction, or null when the row is a plain molecule.
export function reactionSourceFromRow(row) {
  const molblock = typeof row?.molblock === "string" ? row.molblock : "";
  if (looksLikeRxnBlock(molblock)) return { kind: "rxn", text: molblock };
  const smiles = typeof row?.smiles === "string" ? row.smiles.trim() : "";
  if (looksLikeReactionSmiles(smiles)) return { kind: "smiles", text: smiles };
  return null;
}

function canonicalComponent(ocl, smiles) {
  const value = String(smiles ?? "").trim();
  if (!value) return "";
  return ocl.Molecule.fromSmiles(value).toSmiles();
}

// Reactants, catalysts (the agents over the arrow) and products of a row's
// reaction, canonicalized so a $RXN block and the same reaction written as
// SMILES produce the same column text.
export function reactionPartsFromRow(engines, row) {
  const source = reactionSourceFromRow(row);
  if (!source) throw new Error("Row has no reaction");
  const { ocl } = engines;
  if (source.kind === "rxn") {
    const reaction = ocl.Reaction.fromRxn(source.text);
    const read = (count, get) => {
      const molecules = [];
      for (let index = 0; index < count; index += 1) molecules.push(get(index).toSmiles());
      return molecules.filter(Boolean);
    };
    return {
      reactants: read(reaction.getReactants(), (index) => reaction.getReactant(index)),
      catalysts: read(reaction.getCatalysts(), (index) => reaction.getCatalyst(index)),
      products: read(reaction.getProducts(), (index) => reaction.getProduct(index)),
    };
  }
  const [reactants, catalysts, products] = source.text.split(">");
  const split = (part) => part
    .split(".")
    .map((component) => component.trim())
    .filter(Boolean)
    .map((component) => canonicalComponent(ocl, component));
  return {
    reactants: split(reactants),
    catalysts: split(catalysts),
    products: split(products),
  };
}

export function reactionSmilesFromParts(parts) {
  return `${parts.reactants.join(".")}>${parts.catalysts.join(".")}>${parts.products.join(".")}`;
}

// DataWarrior's Extract Transformation: the reaction reduced to the bonds that
// actually change, plus one shell of neighbours so the answer reads as
// chemistry rather than as loose atoms. It needs mapped atoms, which is what
// openchemlib's reaction centre is computed from; an unmapped reaction says so
// on the row instead of inventing a mapping (atom mapping needs an engine we
// do not ship).
export function reactionTransformation(engines, row) {
  const source = reactionSourceFromRow(row);
  if (!source) throw new Error("Row has no reaction");
  const { ocl } = engines;
  const reaction = source.kind === "rxn"
    ? ocl.Reaction.fromRxn(source.text)
    : ocl.Reaction.fromSmiles(source.text);
  const centre = reaction.getReactionCenterMapNos();
  if (!centre) throw new Error("Reaction has no atom mapping");
  const trim = (molecule) => {
    const copy = molecule.getCompactCopy();
    copy.ensureHelperArrays(ocl.Molecule.cHelperNeighbours);
    const keep = new Set();
    for (let atom = 0; atom < copy.getAllAtoms(); atom += 1) {
      const mapNo = copy.getAtomMapNo(atom);
      if (mapNo && centre[mapNo] === true) keep.add(atom);
    }
    for (const atom of [...keep]) {
      const bonded = copy.getAllConnAtoms(atom);
      for (let index = 0; index < bonded; index += 1) keep.add(copy.getConnAtom(atom, index));
    }
    const doomed = [];
    for (let atom = 0; atom < copy.getAllAtoms(); atom += 1) if (!keep.has(atom)) doomed.push(atom);
    if (doomed.length) copy.deleteAtoms(doomed);
    return copy.toSmiles();
  };
  const collect = (count, get) => {
    const parts = [];
    for (let index = 0; index < count; index += 1) {
      const smiles = trim(get(index));
      if (smiles) parts.push(smiles);
    }
    return parts;
  };
  const reactants = collect(reaction.getReactants(), (index) => reaction.getReactant(index));
  const products = collect(reaction.getProducts(), (index) => reaction.getProduct(index));
  if (reactants.length === 0 || products.length === 0) {
    throw new Error("Reaction has no mapped reaction centre");
  }
  return `${reactants.join(".")}>>${products.join(".")}`;
}

// --- Perform Reaction ------------------------------------------------------
// RDKit's run_reactants, not openchemlib's Reactor. Measured on the three
// fixtures in tests/test-reaction-columns.mjs: RDKit gives the right product
// for amidation, esterification and Suzuki from the SMARTS people actually
// write, while OCL's Reactor needs every transferred atom mapped by hand (with
// the plain template it returned the acid unchanged for esterification, and a
// methyl ester when the product template spelled the carbon out) and returned
// nothing at all for Suzuki.
const MAX_REACTION_PRODUCTS = 1000;

// A product straight out of run_reactants is unsanitized, so its SMILES can
// spell a bond differently from the same molecule read normally. Re-reading it
// makes the column canonical and lets duplicate matches collapse; a product
// that will not re-read is written as it came rather than dropped.
function canonicalProductSmiles(rdkit, smiles) {
  let molecule = null;
  try {
    molecule = rdkit.get_mol(smiles);
    if (!molecule || molecule.is_valid?.() === false) return smiles;
    return molecule.get_smiles() || smiles;
  } catch {
    return smiles;
  } finally {
    try { molecule?.delete?.(); } catch {}
  }
}

export function createReactionRunner(engines, smarts) {
  const trimmed = String(smarts ?? "").trim();
  if (!trimmed) throw new Error("Enter a reaction SMARTS");
  const reaction = engines.rdkit.get_rxn(trimmed);
  if (!reaction) throw new Error("Could not read the reaction SMARTS");
  return reaction;
}

// The row's structure is the first reactant; the co-reactants supply the rest,
// so a collection of acids meets one amine. Several matches usually collapse to
// one product once canonicalized; genuinely different products are written as
// the mixture they describe, which keeps the value a readable SMILES.
export function runReactionOnRow(engines, runner, row, coReactants = []) {
  let reactants = null;
  try {
    reactants = new engines.rdkit.MolList();
    const molecules = [rdkitMoleculeFromRow(engines.rdkit, row)];
    try {
      for (const smiles of coReactants) {
        const molecule = engines.rdkit.get_mol(String(smiles ?? "").trim());
        if (!molecule) throw new Error(`Could not read the co-reactant ${smiles}`);
        molecules.push(molecule);
      }
      for (const molecule of molecules) reactants.append(molecule);
    } finally {
      for (const molecule of molecules) {
        try { molecule.delete(); } catch {}
      }
    }
    const sets = runner.run_reactants(reactants, MAX_REACTION_PRODUCTS);
    const products = new Set();
    try {
      for (let index = 0; index < sets.size(); index += 1) {
        const set = sets.get(index);
        const parts = [];
        for (let member = 0; member < set.size(); member += 1) {
          parts.push(canonicalProductSmiles(engines.rdkit, set.at(member).get_smiles()));
        }
        if (parts.length) products.add(parts.join("."));
        try { set.delete?.(); } catch {}
      }
    } finally {
      try { sets.delete?.(); } catch {}
    }
    if (products.size === 0) return { errorText: "The reaction does not apply to this structure" };
    return { valueText: [...products].join(".") };
  } catch (error) {
    return { errorText: error instanceof Error ? error.message : String(error) };
  } finally {
    try { reactants?.delete?.(); } catch {}
  }
}

function rdkitMoleculeFromRow(rdkit, row) {
  const molblock = typeof row.molblock === "string" ? row.molblock.trim() : "";
  const smiles = typeof row.smiles === "string" ? row.smiles.trim() : "";
  const source = molblock ? row.molblock : smiles;
  if (!source) throw new Error("Row has no structure");
  const mol = rdkit.get_mol(source);
  if (!mol) throw new Error("RDKit could not parse the structure");
  return mol;
}

function computeWithRdkitMol(rdkit, row, compute) {
  const mol = rdkitMoleculeFromRow(rdkit, row);
  try {
    return compute(mol);
  } finally {
    mol.delete();
  }
}

// Chemical property columns for the Calculate Properties dialog. The ocl group
// reproduces DataWarrior's numbers exactly (same Actelion predictors, BSD via
// openchemlib); the rdkit group reads the counts RDKit's get_descriptors JSON
// already carries. Text risks keep DataWarrior's none/low/high vocabulary.
export const PROPERTY_GROUPS = [
  {
    id: "druglikeness",
    label: "Druglikeness (openchemlib)",
    properties: [
      { id: "cLogP", label: "cLogP", engine: "ocl" },
      { id: "cLogS", label: "cLogS", engine: "ocl" },
      { id: "HAcceptors", label: "H-Acceptors", engine: "ocl" },
      { id: "HDonors", label: "H-Donors", engine: "ocl" },
      { id: "TPSA", label: "Polar Surface Area", engine: "ocl" },
      { id: "RotatableBonds", label: "Rotatable Bonds", engine: "ocl" },
      { id: "StereoCenters", label: "Stereo Centers", engine: "ocl" },
      { id: "Druglikeness", label: "Druglikeness", engine: "ocl" },
      { id: "DrugScore", label: "Drug Score", engine: "ocl" },
    ],
  },
  {
    id: "toxicity",
    label: "Toxicity risks (openchemlib)",
    properties: [
      { id: "Mutagenic", label: "Mutagenic", engine: "ocl" },
      { id: "Tumorigenic", label: "Tumorigenic", engine: "ocl" },
      { id: "Irritant", label: "Irritant", engine: "ocl" },
      { id: "ReproEffective", label: "Reproductive Effective", engine: "ocl" },
    ],
  },
  {
    id: "counts",
    label: "Counts and rings (RDKit)",
    properties: [
      { id: "MolWeight", label: "Molecular Weight", engine: "rdkit", key: "amw" },
      { id: "ExactMass", label: "Monoisotopic Mass", engine: "rdkit", key: "exactmw" },
      { id: "HeavyAtoms", label: "Non-H Atoms", engine: "rdkit", key: "NumHeavyAtoms" },
      { id: "Heteroatoms", label: "Hetero Atoms", engine: "rdkit", key: "NumHeteroatoms" },
      { id: "Rings", label: "Rings", engine: "rdkit", key: "NumRings" },
      { id: "AromaticRings", label: "Aromatic Rings", engine: "rdkit", key: "NumAromaticRings" },
      { id: "SaturatedRings", label: "Saturated Rings", engine: "rdkit", key: "NumSaturatedRings" },
      { id: "Heterocycles", label: "Hetero-Rings", engine: "rdkit", key: "NumHeterocycles" },
      { id: "SpiroAtoms", label: "Spiro Atoms", engine: "rdkit", key: "NumSpiroAtoms" },
      { id: "BridgeheadAtoms", label: "Bridgehead Atoms", engine: "rdkit", key: "NumBridgeheadAtoms" },
      { id: "FractionCsp3", label: "sp3-Carbon Fraction", engine: "rdkit", key: "FractionCSP3" },
      { id: "AmideBonds", label: "Amide Bonds", engine: "rdkit", key: "NumAmideBonds" },
    ],
  },
];

export const PROPERTY_COLUMNS = Object.fromEntries(
  PROPERTY_GROUPS.flatMap((group) => group.properties.map((property) => [property.id, property])),
);

const TOXICITY_TYPES = {
  Mutagenic: "TYPE_MUTAGENIC",
  Tumorigenic: "TYPE_TUMORIGENIC",
  Irritant: "TYPE_IRRITANT",
  ReproEffective: "TYPE_REPRODUCTIVE_EFFECTIVE",
};

function toxicityRiskLabel(ocl, risk) {
  if (risk === ocl.ToxicityPredictor.RISK_NO) return "none";
  if (risk === ocl.ToxicityPredictor.RISK_LOW) return "low";
  if (risk === ocl.ToxicityPredictor.RISK_HIGH) return "high";
  return "unknown";
}

// Predictor construction loads rule tables, so instances are cached on the
// engines object and shared across every row of a run.
function propertyPredictors(engines) {
  if (!engines._propertyPredictors) {
    engines._propertyPredictors = {
      druglikeness: new engines.ocl.DruglikenessPredictor(),
      toxicity: new engines.ocl.ToxicityPredictor(),
    };
  }
  return engines._propertyPredictors;
}

// Computes every requested property for one row with one parse per engine.
// The largest-fragment option strips salts the way DataWarrior does before
// predicting, so a hydrochloride scores like its parent compound.
export function computeRowProperties(engines, row, propertyIds, options = {}) {
  const results = {};
  const wanted = propertyIds.filter((id) => PROPERTY_COLUMNS[id]);
  if (wanted.length === 0) return results;
  const fail = (ids, message) => {
    for (const id of ids) results[id] = { errorText: message };
    return results;
  };
  let oclMol = null;
  try {
    oclMol = oclMoleculeFromRow(engines.ocl, row);
    if (options.largestFragment) oclMol.stripSmallFragments(false);
  } catch (error) {
    return fail(wanted, error instanceof Error ? error.message : String(error));
  }
  const oclIds = wanted.filter((id) => PROPERTY_COLUMNS[id].engine === "ocl");
  if (oclIds.length) {
    try {
      const predictors = propertyPredictors(engines);
      const properties = new engines.ocl.MoleculeProperties(oclMol);
      const needsDruglikeness = oclIds.includes("Druglikeness") || oclIds.includes("DrugScore");
      const druglikeness = needsDruglikeness ? predictors.druglikeness.assessDruglikeness(oclMol) : null;
      const needsRisks = oclIds.includes("DrugScore")
        || oclIds.some((id) => TOXICITY_TYPES[id]);
      const risks = needsRisks
        ? Object.fromEntries(Object.entries(TOXICITY_TYPES).map(([id, type]) => [
          id,
          predictors.toxicity.assessRisk(oclMol, engines.ocl.ToxicityPredictor[type]),
        ]))
        : {};
      for (const id of oclIds) {
        if (id === "cLogP") results[id] = { valueReal: properties.logP };
        else if (id === "cLogS") results[id] = { valueReal: properties.logS };
        else if (id === "HAcceptors") results[id] = { valueReal: properties.acceptorCount };
        else if (id === "HDonors") results[id] = { valueReal: properties.donorCount };
        else if (id === "TPSA") results[id] = { valueReal: properties.polarSurfaceArea };
        else if (id === "RotatableBonds") results[id] = { valueReal: properties.rotatableBondCount };
        else if (id === "StereoCenters") results[id] = { valueReal: properties.stereoCenterCount };
        else if (id === "Druglikeness") results[id] = { valueReal: druglikeness };
        else if (id === "DrugScore") {
          const weight = oclMol.getMolecularFormula().relativeWeight;
          results[id] = {
            valueReal: engines.ocl.DrugScoreCalculator.calculate(
              properties.logP,
              properties.logS,
              weight,
              druglikeness,
              Object.values(risks),
            ),
          };
        } else if (TOXICITY_TYPES[id]) {
          results[id] = { valueText: toxicityRiskLabel(engines.ocl, risks[id]) };
        }
      }
    } catch (error) {
      fail(oclIds.filter((id) => !results[id]), error instanceof Error ? error.message : String(error));
    }
  }
  const rdkitIds = wanted.filter((id) => PROPERTY_COLUMNS[id].engine === "rdkit");
  if (rdkitIds.length) {
    let mol = null;
    try {
      const source = options.largestFragment ? oclMol.toIsomericSmiles() : null;
      mol = source
        ? engines.rdkit.get_mol(source)
        : rdkitMoleculeFromRow(engines.rdkit, row);
      if (!mol) throw new Error("RDKit could not parse the structure");
      const descriptors = JSON.parse(mol.get_descriptors());
      for (const id of rdkitIds) {
        const value = descriptors[PROPERTY_COLUMNS[id].key];
        results[id] = Number.isFinite(value)
          ? { valueReal: value }
          : { errorText: `RDKit did not return ${PROPERTY_COLUMNS[id].key}` };
      }
    } catch (error) {
      fail(rdkitIds.filter((id) => !results[id]), error instanceof Error ? error.message : String(error));
    } finally {
      try { mol?.delete?.(); } catch {}
    }
  }
  return results;
}

// Bemis-Murcko framework: strip the side chains and keep what a chemist would
// draw as the core - every ring system plus the linkers between them. Terminal
// non-ring atoms are pruned until none are left, which leaves ring atoms and
// linker atoms standing (a linker never falls to one neighbour while both of
// its rings survive). Atoms held by a double or triple bond to what remains
// come back, so a ring ketone keeps its oxygen; this is the rule RDKit's
// MurckoDecompose applies, and matching it is what makes our scaffolds
// comparable with everyone else's.
//
// Stereo is dropped: a centre that lost a substituent no longer means what its
// parity said, and enantiomers of one series belong to one scaffold.
export function murckoScaffoldMolecule(ocl, molecule) {
  molecule.ensureHelperArrays(ocl.Molecule.cHelperRings);
  const atomCount = molecule.getAllAtoms();
  const framework = new Array(atomCount).fill(true);
  for (;;) {
    let pruned = false;
    for (let atom = 0; atom < atomCount; atom += 1) {
      if (!framework[atom] || molecule.isRingAtom(atom)) continue;
      let neighbours = 0;
      for (let index = 0; index < molecule.getAllConnAtoms(atom); index += 1) {
        if (framework[molecule.getConnAtom(atom, index)]) neighbours += 1;
      }
      if (neighbours <= 1) {
        framework[atom] = false;
        pruned = true;
      }
    }
    if (!pruned) break;
  }
  const keep = framework.slice();
  for (let atom = 0; atom < atomCount; atom += 1) {
    if (framework[atom]) continue;
    for (let index = 0; index < molecule.getAllConnAtoms(atom); index += 1) {
      if (framework[molecule.getConnAtom(atom, index)] && molecule.getConnBondOrder(atom, index) > 1) {
        keep[atom] = true;
        break;
      }
    }
  }
  const scaffold = molecule.getCompactCopy();
  for (let atom = 0; atom < atomCount; atom += 1) {
    if (!keep[atom]) scaffold.markAtomForDeletion(atom);
  }
  scaffold.deleteMarkedAtomsAndBonds();
  scaffold.stripStereoInformation();
  scaffold.ensureHelperArrays(ocl.Molecule.cHelperRings);
  return scaffold;
}

// A SMARTS query, compiled once and reused for every row of a run. The searcher
// carries the fragment, so building it per row would re-parse the query
// thousands of times.
export function compileSubstructureQuery(ocl, smarts) {
  const query = String(smarts ?? "").trim();
  if (!query) throw new Error("Enter a SMARTS or SMILES query.");
  const fragment = ocl.Molecule.fromSmiles(query, { smartsMode: "smarts" });
  if (fragment.getAllAtoms() === 0) throw new Error("The query matches no atoms.");
  fragment.setFragment(true);
  const searcher = new ocl.SSSearcher();
  searcher.setFragment(fragment);
  return searcher;
}

// How many times the compiled query occurs in one row, counting each distinct
// set of matched atoms once (benzene occurs twice in naphthalene, not twelve
// times). A row that does not contain the query counts zero, which is a value
// and not a failure.
export function countSubstructureMatches(engines, searcher, row) {
  try {
    searcher.setMolecule(oclMoleculeFromRow(engines.ocl, row));
    return { valueReal: searcher.findFragmentInMolecule() };
  } catch (error) {
    return { errorText: error instanceof Error ? error.message : String(error) };
  }
}

// The fingerprint the cluster and chemical-space pipelines already agree on, so
// a similarity computed here means the same thing as one computed on the GPU.
export const SIMILARITY_FINGERPRINT_SETTINGS = {
  radius: 2,
  fplen: 2048,
  useChirality: true,
  useFeatures: false,
};

const FINGERPRINT_WORDS = SIMILARITY_FINGERPRINT_SETTINGS.fplen / 32;

// Packed little-endian so the words line up with the bytes RDKit hands back;
// only popcounts of AND/OR matter, so the bit order inside a word is irrelevant
// as long as both sides pack identically.
export function morganFingerprint(rdkit, source) {
  const molecule = rdkit.get_mol(source);
  if (!molecule) throw new Error("RDKit could not parse the structure");
  try {
    const bytes = molecule.get_morgan_fp_as_uint8array(JSON.stringify(SIMILARITY_FINGERPRINT_SETTINGS));
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== SIMILARITY_FINGERPRINT_SETTINGS.fplen / 8) {
      throw new Error(`RDKit returned ${bytes?.byteLength ?? 0} fingerprint bytes`);
    }
    const words = new Uint32Array(FINGERPRINT_WORDS);
    for (let index = 0; index < bytes.length; index += 1) {
      words[index >> 2] |= bytes[index] << ((index & 3) * 8);
    }
    return words;
  } finally {
    molecule.delete();
  }
}

function popcount(value) {
  let bits = value - ((value >>> 1) & 0x55555555);
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  bits = (bits + (bits >>> 4)) & 0x0f0f0f0f;
  return (bits * 0x01010101) >>> 24;
}

export function tanimoto(left, right) {
  let intersection = 0;
  let union = 0;
  for (let word = 0; word < FINGERPRINT_WORDS; word += 1) {
    intersection += popcount(left[word] & right[word]);
    union += popcount(left[word] | right[word]);
  }
  return union === 0 ? 0 : intersection / union;
}

// The best match a row has anywhere in the reference file, and which molecule
// it was: DataWarrior's Find Similar In File answers both, and the name is what
// makes the number actionable.
export function closestReferenceMatch(engines, row, reference) {
  try {
    const molblock = typeof row.molblock === "string" ? row.molblock.trim() : "";
    const smiles = typeof row.smiles === "string" ? row.smiles.trim() : "";
    const source = molblock ? row.molblock : smiles;
    if (!source) throw new Error("Row has no structure");
    const fingerprint = morganFingerprint(engines.rdkit, source);
    let best = -1;
    let bestIndex = -1;
    for (let index = 0; index < reference.length; index += 1) {
      const similarity = tanimoto(fingerprint, reference[index].fingerprint);
      if (similarity > best) {
        best = similarity;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) throw new Error("The reference file has no usable molecules");
    return { similarity: best, name: reference[bestIndex].name };
  } catch (error) {
    return { errorText: error instanceof Error ? error.message : String(error) };
  }
}

// Molecules out of the file the user picked. Only the formats a reference set
// realistically arrives in are read, and a record that does not parse is
// skipped rather than failing the file: one bad line should not cost the run.
export function parseReferenceStructures(text, extension) {
  const kind = String(extension ?? "").trim().toLowerCase().replace(/^\./u, "");
  if (kind === "sdf" || kind === "sd" || kind === "mol") return parseSdfStructures(text);
  if (kind === "csv" || kind === "tsv") return parseTableStructures(text, kind === "tsv" ? "\t" : ",");
  return parseSmilesListStructures(text);
}

function parseSdfStructures(text) {
  // Exactly the one newline the delimiter left behind is removed: a molfile's
  // first line is its name and is often blank, so trimming further would shift
  // the header block and yield an empty molecule.
  return text.split(/^\$\$\$\$[^\n]*$/mu).flatMap((record, index) => {
    const molblock = record.replace(/^\r?\n/u, "");
    if (!molblock.trim()) return [];
    const name = molblock.split("\n", 1)[0].trim();
    return [{ molblock, name: name || `Record ${index + 1}` }];
  });
}

function parseSmilesListStructures(text) {
  return text.split(/\r?\n/u).flatMap((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const [smiles, ...rest] = trimmed.split(/\s+/u);
    // A header line names its columns instead of holding a structure.
    if (index === 0 && /^(smiles|structure|canonical_smiles)$/iu.test(smiles)) return [];
    return [{ smiles, name: rest.join(" ").trim() || smiles }];
  });
}

const SMILES_HEADERS = ["smiles", "canonical_smiles", "structure", "smi"];
const NAME_HEADERS = ["name", "id", "title", "compound", "molecule"];
// compound_id, mol_name, cmpd_title: the same three words with a prefix, which
// is how half the tables in the wild spell them.
const NAME_HEADER_SUFFIX = /(?:^|_)(?:id|name|title)$/u;

function parseTableStructures(text, separator) {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(separator).map((cell) => cell.trim().replace(/^"|"$/gu, "").toLowerCase());
  const smilesColumn = header.findIndex((cell) => SMILES_HEADERS.includes(cell));
  if (smilesColumn < 0) throw new Error("The reference table has no SMILES column.");
  let nameColumn = header.findIndex((cell) => NAME_HEADERS.includes(cell));
  if (nameColumn < 0) {
    nameColumn = header.findIndex((cell, index) => index !== smilesColumn && NAME_HEADER_SUFFIX.test(cell));
  }
  return lines.slice(1).flatMap((line) => {
    const cells = line.split(separator).map((cell) => cell.trim().replace(/^"|"$/gu, ""));
    const smiles = cells[smilesColumn];
    if (!smiles) return [];
    const name = nameColumn >= 0 ? cells[nameColumn] || smiles : smiles;
    return [{ smiles, name }];
  });
}

// Returns { valueText } on success or { errorText } when the row cannot be
// computed; the store keeps errors on the row so a bad structure is an answer,
// not a hole (same contract as descriptor runs).
export function computeDerivedValue(kind, engines, row) {
  try {
    switch (kind) {
      case "formula":
        return { valueText: oclMoleculeFromRow(engines.ocl, row).getMolecularFormula().formula };
      case "idcode":
        return { valueText: oclMoleculeFromRow(engines.ocl, row).getIDCode() };
      case "canonical-smiles":
        return { valueText: computeWithRdkitMol(engines.rdkit, row, (mol) => mol.get_smiles()) };
      case "inchi": {
        const inchi = computeWithRdkitMol(engines.rdkit, row, (mol) => mol.get_inchi()).trim();
        if (!inchi) throw new Error("RDKit returned an empty InChI");
        return { valueText: inchi };
      }
      case "inchikey": {
        const inchi = computeWithRdkitMol(engines.rdkit, row, (mol) => mol.get_inchi()).trim();
        if (!inchi) throw new Error("RDKit returned an empty InChI");
        const key = engines.rdkit.get_inchikey_for_inchi(inchi).trim();
        if (!key) throw new Error("RDKit returned an empty InChI-Key");
        return { valueText: key };
      }
      case "reaction-smiles":
        return { valueText: reactionSmilesFromParts(reactionPartsFromRow(engines, row)) };
      case "reaction-reactants":
        return { valueText: reactionPartsFromRow(engines, row).reactants.join(".") };
      case "reaction-catalysts":
        return { valueText: reactionPartsFromRow(engines, row).catalysts.join(".") };
      case "reaction-products":
        return { valueText: reactionPartsFromRow(engines, row).products.join(".") };
      case "reaction-transformation":
        return { valueText: reactionTransformation(engines, row) };
      case "largest-fragment": {
        const molecule = oclMoleculeFromRow(engines.ocl, row);
        molecule.stripSmallFragments(false);
        const smiles = molecule.toSmiles();
        if (!smiles) throw new Error("Stripping left no fragment");
        return { valueText: smiles };
      }
      case "murcko-scaffold": {
        const scaffold = murckoScaffoldMolecule(engines.ocl, oclMoleculeFromRow(engines.ocl, row));
        // An acyclic molecule has no framework at all; that is an answer, and
        // the blank cell is how DataWarrior says it too.
        return { valueText: scaffold.getAllAtoms() === 0 ? "" : scaffold.toIsomericSmiles() };
      }
      default:
        throw new Error(`Unknown derived column kind: ${kind}`);
    }
  } catch (error) {
    return { errorText: error instanceof Error ? error.message : String(error) };
  }
}
