export type StructureSummaryRow = {
  label: string;
  value: string;
  action?: StructureViewerAction;
  secondaryAction?: StructureViewerAction;
};

export type StructureCompositionSummary = {
  rows: StructureSummaryRow[];
  componentRows: StructureSummaryRow[];
  maestroRows?: StructureSummaryRow[];
  polymerRows: StructureSummaryRow[];
  ligandRows: StructureSummaryRow[];
  solventRows: StructureSummaryRow[];
  notes: string[];
};

export type StructureViewerSelectorPrimitive = string | number | Array<string | number>;
export type StructureViewerResidueSelector = Record<string, StructureViewerSelectorPrimitive>;
export type StructureViewerSelector = Record<string, StructureViewerSelectorPrimitive | StructureViewerResidueSelector[] | undefined>;

export type StructureViewerAction =
  | {
      type: "select_residues";
      label: string;
      notify?: boolean;
      selector: StructureViewerSelector;
      granularity: "residue";
      mode?: "replace";
    }
  | {
      type: "focus_ligand";
      label: string;
      selector: StructureViewerSelector;
      showNeighborhood?: boolean;
      radiusA?: number;
    }
  | {
      type: "hide_waters" | "show_waters";
      label: string;
    }
  | {
      type: "hide_components" | "show_components";
      label: string;
      kind: "polymer" | "ligand" | "ion";
    }
  | {
      type: "clear_selection";
      label: string;
      notify?: boolean;
    }
  | {
      type: "set_sdf_molecule";
      label: string;
      index: number;
    }
  | {
      type: "set_structure_pose";
      label: string;
      index: number;
    }
  | {
      type: "apply_trajectory_smoothing";
      label: string;
      preset: "light" | "balanced" | "strong";
      targetFrames: number;
      referenceFrame: number;
      align: boolean;
    }
  | {
      type: "set_trajectory_smoothing_view";
      label: string;
      notify?: boolean;
      view: "original" | "smoothed";
    }
  | {
      type: "set_molstar_style";
      label: string;
      notify?: boolean;
      style: string;
    }
  | {
      type: "set_sdf_context_style";
      label: string;
      notify?: boolean;
      style: string;
    }
  | {
      type: "set_sdf_context_opacity";
      label: string;
      notify?: boolean;
      opacity: number;
    }
  | {
      type: "set_sdf_context_color";
      label: string;
      notify?: boolean;
      color: "gray" | "colored";
    }
  | {
      type: "set_sdf_pose_mode";
      label: string;
      notify?: boolean;
      mode: "all" | "single";
    }
  | {
      type: "set_sdf_pose_index";
      label: string;
      index: number;
    };

type AtomRecord = {
  group: "ATOM" | "HETATM";
  atomName: string;
  resName: string;
  chain: string;
  seq: string;
  icode: string;
  element: string;
  model: string;
};

type ResidueGroup = {
  group: "ATOM" | "HETATM";
  resName: string;
  chain: string;
  seq: string;
  icode: string;
  atoms: number;
  elementCounts: Map<string, number>;
};

type ChainGroup = {
  residues: number;
  atoms: number;
  proteinResidues: number;
  nucleicResidues: number;
  otherResidues: number;
};

type MaestroCtSummary = {
  index: number;
  title: string;
  entryName: string;
  ctType: string;
  forceField: string;
  variant: string;
  charge: string;
  energy: string;
  atomCount: number;
  bondCount: number;
  elements: Map<string, number>;
  records: AtomRecord[];
};

const WATER_NAMES = new Set(["HOH", "WAT", "H2O", "DOD", "TIP", "TIP3", "TIP3P", "TIP4", "TIP4P", "TP3", "TP4", "SPC", "SPCE", "SOL"]);
const ION_NAMES = new Set([
  "AG", "AL", "BA", "BR", "CA", "CD", "CL", "CO", "CS", "CU", "FE", "HG", "IOD", "K",
  "LI", "MG", "MN", "NA", "NI", "RB", "SR", "ZN",
]);
const POLYMER_RESIDUES = new Set([
  "ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE", "LEU", "LYS",
  "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL", "ASX", "GLX", "SEC", "PYL",
  "HID", "HIE", "HIP", "HSD", "HSE", "HSP",
  "A", "C", "G", "T", "U", "DA", "DC", "DG", "DT", "DU", "ADE", "CYT", "GUA", "THY", "URA",
]);
const PROTEIN_RESIDUES = new Set([
  "ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE", "LEU", "LYS",
  "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL", "ASX", "GLX", "SEC", "PYL",
  "HID", "HIE", "HIP", "HSD", "HSE", "HSP",
]);
const NUCLEIC_RESIDUES = new Set(["A", "C", "G", "T", "U", "DA", "DC", "DG", "DT", "DU", "ADE", "CYT", "GUA", "THY", "URA"]);

export function parseStructureComposition(text: string, extension: string): StructureCompositionSummary | null {
  const normalizedExtension = extension.toLowerCase();
  if (["pdb", "ent"].includes(normalizedExtension)) return parsePdbComposition(text);
  if (normalizedExtension === "pdbqt") return parsePdbqtComposition(text);
  if (["cif", "mmcif"].includes(normalizedExtension)) return parseCifComposition(text);
  if (normalizedExtension === "gro") return parseGroComposition(text);
  if (["xyz", "extxyz"].includes(normalizedExtension)) return parseXyzComposition(text);
  if (["cube", "cub"].includes(normalizedExtension)) return parseCubeComposition(text);
  if (normalizedExtension === "sdf") return parseSdfComposition(text);
  if (normalizedExtension === "mol") return parseMolComposition(text);
  if (normalizedExtension === "mol2") return parseMol2Composition(text);
  if (["mae", "maegz", "cms"].includes(normalizedExtension)) return parseMaestroComposition(text);
  return null;
}

function parsePdbComposition(text: string): StructureCompositionSummary | null {
  const records: AtomRecord[] = [];
  let model = "1";
  let explicitModelCount = 0;
  for (const line of text.split(/\r?\n/)) {
    const record = line.slice(0, 6).trim();
    if (record === "MODEL") {
      model = line.slice(10, 14).trim() || String(explicitModelCount + 1);
      explicitModelCount += 1;
      continue;
    }
    if (record !== "ATOM" && record !== "HETATM") continue;
    const atomName = line.slice(12, 16).trim();
    const resName = line.slice(17, 20).trim().toUpperCase() || "UNK";
    const chain = line.slice(21, 22).trim() || "-";
    const seq = line.slice(22, 26).trim() || "?";
    const icode = line.slice(26, 27).trim();
    const element = normalizeElement(line.slice(76, 78).trim() || inferElement(atomName));
    records.push({ group: record, atomName, resName, chain, seq, icode, element, model });
  }
  if (records.length === 0) return null;
  return summarizeAtomRecords(records, explicitModelCount > 0 ? explicitModelCount : 1);
}

function parsePdbqtComposition(text: string): StructureCompositionSummary | null {
  const records: AtomRecord[] = [];
  let model = "1";
  let explicitModelCount = 0;
  for (const line of text.split(/\r?\n/)) {
    const record = line.slice(0, 6).trim();
    if (record === "MODEL") {
      model = line.slice(10, 14).trim() || String(explicitModelCount + 1);
      explicitModelCount += 1;
      continue;
    }
    if (record !== "ATOM" && record !== "HETATM") continue;
    const atomName = line.slice(12, 16).trim();
    const resName = line.slice(17, 20).trim().toUpperCase() || "UNK";
    const chain = line.slice(21, 22).trim() || "-";
    const seq = line.slice(22, 26).trim() || "?";
    const icode = line.slice(26, 27).trim();
    const element = normalizeElement(pdbqtElementFromAtomType(line) || line.slice(76, 78).trim() || inferElement(atomName));
    records.push({ group: "HETATM", atomName, resName, chain, seq, icode, element, model });
  }
  if (records.length === 0) return null;
  return summarizeAtomRecords(records, explicitModelCount > 0 ? explicitModelCount : 1);
}

function parseCifComposition(text: string): StructureCompositionSummary | null {
  const records: AtomRecord[] = [];
  const crystalElements = new Map<string, number>();
  let crystalSites = 0;
  const cell = parseCifCell(text);
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== "loop_") continue;
    const headers: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].trim().startsWith("_")) {
      headers.push(lines[cursor].trim());
      cursor += 1;
    }
    if (!headers.some((header) => header.startsWith("_atom_site.") || header.startsWith("_atom_site_"))) continue;
    const groupIndex = headers.findIndex((header) => header === "_atom_site.group_PDB");
    const atomNameIndex = firstHeaderIndex(headers, ["_atom_site.label_atom_id", "_atom_site.auth_atom_id"]);
    const resNameIndex = firstHeaderIndex(headers, ["_atom_site.label_comp_id", "_atom_site.auth_comp_id"]);
    const chainIndex = firstHeaderIndex(headers, ["_atom_site.auth_asym_id", "_atom_site.label_asym_id"]);
    const seqIndex = firstHeaderIndex(headers, ["_atom_site.auth_seq_id", "_atom_site.label_seq_id"]);
    const icodeIndex = headers.findIndex((header) => header === "_atom_site.pdbx_PDB_ins_code");
    const elementIndex = firstHeaderIndex(headers, ["_atom_site.type_symbol", "_atom_site_type_symbol"]);
    const modelIndex = headers.findIndex((header) => header === "_atom_site.pdbx_PDB_model_num");
    while (cursor < lines.length) {
      const trimmed = lines[cursor].trim();
      if (!trimmed || trimmed === "#" || trimmed === "loop_" || trimmed.startsWith("_")) break;
      const tokens = splitCifTokens(trimmed);
      const group = tokens[groupIndex] === "HETATM" ? "HETATM" : tokens[groupIndex] === "ATOM" ? "ATOM" : null;
      if (group && tokens.length >= headers.length) {
        const atomName = cleanCifValue(tokens[atomNameIndex]) || "";
        const resName = (cleanCifValue(tokens[resNameIndex]) || "UNK").toUpperCase();
        const chain = cleanCifValue(tokens[chainIndex]) || "-";
        const seq = cleanCifValue(tokens[seqIndex]) || "?";
        const icode = cleanCifValue(tokens[icodeIndex]) || "";
        const element = normalizeElement(cleanCifValue(tokens[elementIndex]) || inferElement(atomName));
        const model = cleanCifValue(tokens[modelIndex]) || "1";
        records.push({ group, atomName, resName, chain, seq, icode, element, model });
      } else if (groupIndex < 0 && elementIndex >= 0 && tokens.length >= headers.length) {
        const element = normalizeElement(cleanCifValue(tokens[elementIndex]));
        if (element) {
          increment(crystalElements, element, 1);
          crystalSites += 1;
        }
      }
      cursor += 1;
    }
    index = cursor;
  }
  if (records.length > 0) return summarizeAtomRecords(records, new Set(records.map((record) => record.model)).size || 1);
  if (crystalSites > 0) return summarizeCrystalCif(crystalSites, crystalElements, cell);
  return null;
}

function parseGroComposition(text: string): StructureCompositionSummary | null {
  const lines = text.split(/\r?\n/);
  const atomCount = Number.parseInt(lines[1]?.trim() ?? "", 10);
  if (!Number.isFinite(atomCount) || atomCount <= 0) return null;
  const records: AtomRecord[] = [];
  for (let index = 0; index < atomCount; index += 1) {
    const line = lines[index + 2] ?? "";
    if (!line.trim()) continue;
    const resName = line.slice(5, 10).trim().toUpperCase() || "UNK";
    const atomName = line.slice(10, 15).trim();
    records.push({
      group: residueGroupForName(resName),
      atomName,
      resName,
      chain: "-",
      seq: line.slice(0, 5).trim() || String(index + 1),
      icode: "",
      element: normalizeElement(inferElement(atomName)),
      model: "1",
    });
  }
  if (records.length === 0) return null;
  const summary = summarizeAtomRecords(records, 1);
  const boxLine = lines[atomCount + 2]?.trim();
  if (boxLine) summary.rows.push({ label: "Box", value: boxLine.split(/\s+/).slice(0, 3).join(" x ") });
  summary.notes.push("GRO residue grouping is inferred from residue and atom names.");
  return summary;
}

function summarizeAtomRecords(records: AtomRecord[], modelCount: number): StructureCompositionSummary {
  const residues = new Map<string, ResidueGroup>();
  const elements = new Map<string, number>();
  const chains = new Set<string>();
  const chainGroups = new Map<string, ChainGroup>();
  for (const record of records) {
    if (record.element) increment(elements, record.element, 1);
    const residueKey = [record.chain, record.seq, record.icode, record.resName, record.group, record.model].join(":");
    const residue = residues.get(residueKey) ?? {
      group: record.group,
      resName: record.resName,
      chain: record.chain,
      seq: record.seq,
      icode: record.icode,
      atoms: 0,
      elementCounts: new Map<string, number>(),
    };
    residue.atoms += 1;
    if (record.element) increment(residue.elementCounts, record.element, 1);
    residues.set(residueKey, residue);
  }

  let polymerResidues = 0;
  let polymerAtoms = 0;
  let ligandResidues = 0;
  let ligandAtoms = 0;
  let waterResidues = 0;
  let waterAtoms = 0;
  let ionResidues = 0;
  let ionAtoms = 0;
  const ligandGroups = new Map<string, { residues: number; atoms: number }>();
  const ligandInstances: ResidueGroup[] = [];
  const ionGroups = new Map<string, number>();

  for (const residue of residues.values()) {
    const kind = classifyResidue(residue);
    if (kind === "polymer") {
      polymerResidues += 1;
      polymerAtoms += residue.atoms;
      chains.add(residue.chain);
      const chain = chainGroups.get(residue.chain) ?? { residues: 0, atoms: 0, proteinResidues: 0, nucleicResidues: 0, otherResidues: 0 };
      chain.residues += 1;
      chain.atoms += residue.atoms;
      if (PROTEIN_RESIDUES.has(residue.resName)) chain.proteinResidues += 1;
      else if (NUCLEIC_RESIDUES.has(residue.resName)) chain.nucleicResidues += 1;
      else chain.otherResidues += 1;
      chainGroups.set(residue.chain, chain);
    } else if (kind === "water") {
      waterResidues += 1;
      waterAtoms += residue.atoms;
    } else if (kind === "ion") {
      ionResidues += 1;
      ionAtoms += residue.atoms;
      increment(ionGroups, residue.resName, 1);
    } else {
      ligandResidues += 1;
      ligandAtoms += residue.atoms;
      ligandInstances.push(residue);
      const ligand = ligandGroups.get(residue.resName) ?? { residues: 0, atoms: 0 };
      ligand.residues += 1;
      ligand.atoms += residue.atoms;
      ligandGroups.set(residue.resName, ligand);
    }
  }

  const componentRows: StructureSummaryRow[] = [
    {
      label: "Polymers",
      value: polymerResidues > 0 ? `${chains.size} ${plural(chains.size, "chain")} / ${polymerResidues} ${plural(polymerResidues, "residue")} / ${polymerAtoms} atoms` : "None detected",
      action: polymerResidues > 0 ? {
        type: "select_residues",
        label: "Select polymers",
        selector: { kind: "polymer" },
        granularity: "residue",
        mode: "replace",
      } : undefined,
    },
    {
      label: "Ligands",
      value: ligandResidues > 0 ? `${ligandGroups.size} ${plural(ligandGroups.size, "type")} / ${ligandResidues} ${plural(ligandResidues, "instance")} / ${ligandAtoms} atoms` : "None detected",
      action: ligandResidues > 0 ? {
        type: "select_residues",
        label: "Select ligands",
        selector: { kind: "ligand" },
        granularity: "residue",
        mode: "replace",
      } : undefined,
    },
    {
      label: "Water",
      value: waterResidues > 0 ? `${waterResidues} ${plural(waterResidues, "molecule")} / ${waterAtoms} atoms` : "None detected",
      action: waterResidues > 0 ? { type: "hide_waters", label: "Hide water" } : undefined,
      secondaryAction: waterResidues > 0 ? { type: "show_waters", label: "Show water" } : undefined,
    },
    {
      label: "Ions",
      value: ionResidues > 0 ? `${formatNameCounts(ionGroups, 5)} / ${ionAtoms} atoms` : "None detected",
      action: ionResidues > 0 ? {
        type: "select_residues",
        label: "Select ions",
        selector: { kind: "ion" },
        granularity: "residue",
        mode: "replace",
      } : undefined,
    },
  ];

  const ligandRows: StructureSummaryRow[] = ligandInstances
    .sort(sortResidueGroups)
    .map((ligand) => ({
      label: ligandInstanceLabel(ligand),
      value: `${ligand.atoms} atoms`,
      action: {
        type: "focus_ligand",
        label: `Focus ${ligandInstanceLabel(ligand)}`,
        selector: ligandInstanceSelector(ligand),
        showNeighborhood: true,
        radiusA: 4,
      },
    }));

  const polymerRows: StructureSummaryRow[] = [...chainGroups.entries()]
    .sort((left, right) => naturalChainSort(left[0], right[0]))
    .slice(0, 10)
    .map(([chainId, chain]) => {
      const selector: Record<string, string | number | Array<string | number>> = chainId === "-"
        ? { kind: "polymer" }
        : { kind: "polymer", auth_asym_id: chainId };
      return {
        label: chainId === "-" ? "Chain -" : `Chain ${chainId}`,
        value: `${polymerLabel(chain)} / ${chain.residues} ${plural(chain.residues, "residue")} / ${chain.atoms} atoms`,
        action: {
          type: "select_residues",
          label: chainId === "-" ? "Select chain" : `Select chain ${chainId}`,
          selector,
          granularity: "residue",
          mode: "replace",
        },
      };
    });

  const solventRows: StructureSummaryRow[] = [];
  if (waterResidues > 0) {
    solventRows.push({
      label: "Water",
      value: `${waterResidues} ${plural(waterResidues, "molecule")} / ${waterAtoms} atoms`,
      action: { type: "hide_waters", label: "Hide water" },
      secondaryAction: { type: "show_waters", label: "Show water" },
    });
  }
  if (ionResidues > 0) {
    solventRows.push({
      label: "Ions",
      value: `${formatNameCounts(ionGroups, 8)} / ${ionAtoms} atoms`,
    });
  }
  for (const [name, count] of [...ionGroups.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 8)) {
    solventRows.push({
      label: name,
      value: `${count} ${plural(count, "ion")}`,
      action: {
        type: "select_residues",
        label: `Select ${name}`,
        selector: { kind: "ion", label_comp_id: name },
        granularity: "residue",
        mode: "replace",
      },
    });
  }

  const notes = [
    "Component actions use Mol* selectors; file deletion or cleaned-copy export is kept separate from this brief.",
  ];
  if (chainGroups.size > polymerRows.length) notes.push(`Showing top ${polymerRows.length} of ${chainGroups.size} polymer chains.`);

  return {
    rows: [
      { label: "Atoms", value: formatInteger(records.length) },
      { label: "Residues", value: formatInteger(residues.size) },
      { label: "Chains", value: chains.size > 0 ? formatInteger(chains.size) : "None detected" },
      { label: "Models", value: formatInteger(modelCount) },
      { label: "Elements", value: formatElementCounts(elements, 6) },
    ],
    componentRows,
    polymerRows,
    ligandRows,
    solventRows,
    notes,
  };
}

function parseXyzComposition(text: string): StructureCompositionSummary | null {
  const lines = text.split(/\r?\n/);
  let cursor = 0;
  let frames = 0;
  let firstFrameAtoms = 0;
  let totalAtoms = 0;
  const elements = new Map<string, number>();
  while (cursor < lines.length) {
    const atomCount = Number.parseInt(lines[cursor].trim(), 10);
    if (!Number.isFinite(atomCount) || atomCount <= 0) break;
    if (frames === 0) firstFrameAtoms = atomCount;
    frames += 1;
    totalAtoms += atomCount;
    cursor += 2;
    for (let atomIndex = 0; atomIndex < atomCount && cursor + atomIndex < lines.length; atomIndex += 1) {
      const element = normalizeElement(lines[cursor + atomIndex].trim().split(/\s+/)[0] ?? "");
      if (element) increment(elements, element, 1);
    }
    cursor += atomCount;
  }
  if (frames === 0) return null;
  return {
    rows: [
      { label: "Frames", value: formatInteger(frames) },
      { label: "Atoms/frame", value: formatInteger(firstFrameAtoms) },
      { label: "Total atoms", value: formatInteger(totalAtoms) },
      { label: "Elements", value: formatElementCounts(elements, 8) },
    ],
    componentRows: [
      { label: "Molecule", value: `${firstFrameAtoms} atoms in first frame` },
      { label: "Trajectory", value: frames > 1 ? `${frames} frames detected` : "Single frame" },
    ],
    polymerRows: [],
    ligandRows: [],
    solventRows: [],
    notes: ["XYZ components are element-level because the format has no residue or chain records."],
  };
}

function summarizeCrystalCif(
  sites: number,
  elements: Map<string, number>,
  cell: string | null,
): StructureCompositionSummary {
  return {
    rows: [
      { label: "Atom sites", value: formatInteger(sites) },
      { label: "Elements", value: formatElementCounts(elements, 8) },
      { label: "Cell", value: cell ?? "Not specified" },
    ],
    componentRows: [
      { label: "Crystal sites", value: `${sites} atom ${plural(sites, "site")}` },
      { label: "Asymmetric unit", value: "Fractional coordinates" },
    ],
    polymerRows: [],
    ligandRows: [],
    solventRows: [],
    notes: ["Crystallographic CIF sites are grouped by element because residue and chain records are not present."],
  };
}

function parseCifCell(text: string) {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(_cell_length_[abc])\s+(.+)$/);
    if (!match) continue;
    values.set(match[1], cleanCifValue(match[2].trim()));
  }
  const a = values.get("_cell_length_a");
  const b = values.get("_cell_length_b");
  const c = values.get("_cell_length_c");
  if (!a || !b || !c) return null;
  return `${a} x ${b} x ${c}`;
}

function parseCubeComposition(text: string): StructureCompositionSummary | null {
  const lines = text.split(/\r?\n/);
  if (lines.length < 6) return null;
  const atomCount = Math.abs(Number.parseInt(lines[2]?.trim().split(/\s+/)[0] ?? "", 10));
  if (!Number.isFinite(atomCount)) return null;
  const grid = [3, 4, 5].map((lineIndex) => Math.abs(Number.parseInt(lines[lineIndex]?.trim().split(/\s+/)[0] ?? "", 10)));
  const elements = new Map<string, number>();
  for (let index = 0; index < atomCount; index += 1) {
    const atomicNumber = Number.parseInt(lines[6 + index]?.trim().split(/\s+/)[0] ?? "", 10);
    const element = elementFromAtomicNumber(atomicNumber);
    if (element) increment(elements, element, 1);
  }
  return {
    rows: [
      { label: "Atoms", value: formatInteger(atomCount) },
      { label: "Grid", value: grid.every((value) => Number.isFinite(value)) ? grid.join(" x ") : "Unknown" },
      { label: "Elements", value: formatElementCounts(elements, 8) },
    ],
    componentRows: [
      { label: "Atomic scaffold", value: `${atomCount} atoms` },
      { label: "Volume", value: "Scalar field grid" },
    ],
    polymerRows: [],
    ligandRows: [],
    solventRows: [],
    notes: ["Cube files expose atoms plus a volumetric field; residue grouping is not present."],
  };
}

function parseSdfComposition(text: string): StructureCompositionSummary | null {
  const molecules = text.split(/\r?\n\$\$\$\$/).map((block) => block.trim()).filter(Boolean);
  if (molecules.length === 0) return null;
  let atomTotal = 0;
  let bondTotal = 0;
  const properties = new Set<string>();
  const titles = molecules.map(sdfMoleculeTitle);
  const duplicateTitles = new Set(titles.filter((title, index) => title && titles.indexOf(title) !== index));
  const moleculeRows = molecules.map((molecule, index) => {
    const { atoms, bonds } = parseMolCounts(molecule);
    atomTotal += atoms;
    bondTotal += bonds;
    for (const match of molecule.matchAll(/^>\s*<([^>]+)>/gm)) properties.add(match[1].trim());
    const label = sdfMoleculeLabel(titles[index], duplicateTitles, index);
    return {
      label,
      value: `${formatInteger(atoms)} ${plural(atoms, "atom")} / ${formatInteger(bonds)} ${plural(bonds, "bond")}`,
      action: {
        type: "set_sdf_molecule",
        label: `Show ${label}`,
        index,
      },
    } satisfies StructureSummaryRow;
  });
  const componentRows: StructureSummaryRow[] = molecules.length > 1 ? moleculeRows : [
    { label: "Small molecule", value: `${formatInteger(atomTotal)} ${plural(atomTotal, "atom")} / ${formatInteger(bondTotal)} ${plural(bondTotal, "bond")}` },
  ];
  if (properties.size > 0) {
    componentRows.push({ label: "Properties", value: [...properties].slice(0, 4).join(", ") });
  }
  return {
    rows: [
      { label: "Molecules", value: formatInteger(molecules.length) },
      { label: "Atoms", value: formatInteger(atomTotal) },
      { label: "Bonds", value: formatInteger(bondTotal) },
      { label: "Properties", value: properties.size > 0 ? formatInteger(properties.size) : "None detected" },
    ],
    componentRows,
    polymerRows: [],
    ligandRows: [],
    solventRows: [],
    notes: ["SDF records are treated as separate small-molecule components."],
  };
}

function sdfMoleculeTitle(molecule: string) {
  return molecule.split(/\r?\n/, 1)[0]?.trim().slice(0, 80) || "";
}

function sdfMoleculeLabel(title: string, duplicateTitles: Set<string>, index: number) {
  return title && !duplicateTitles.has(title) ? title : `Molecule ${index + 1}`;
}

function parseMolComposition(text: string): StructureCompositionSummary | null {
  const { atoms, bonds } = parseMolCounts(text);
  if (atoms === 0 && bonds === 0) return null;
  return {
    rows: [
      { label: "Atoms", value: formatInteger(atoms) },
      { label: "Bonds", value: formatInteger(bonds) },
    ],
    componentRows: [
      { label: "Small molecule", value: `${atoms} atoms / ${bonds} bonds` },
    ],
    polymerRows: [],
    ligandRows: [],
    solventRows: [],
    notes: ["MOL files describe one small-molecule component."],
  };
}

function parseMol2Composition(text: string): StructureCompositionSummary | null {
  const atomCount = (text.match(/^@<TRIPOS>ATOM$/gim) ? countMol2SectionRows(text, "ATOM") : 0);
  const bondCount = (text.match(/^@<TRIPOS>BOND$/gim) ? countMol2SectionRows(text, "BOND") : 0);
  if (atomCount === 0 && bondCount === 0) return null;
  return {
    rows: [
      { label: "Atoms", value: formatInteger(atomCount) },
      { label: "Bonds", value: formatInteger(bondCount) },
    ],
    componentRows: [
      { label: "Small molecule", value: `${atomCount} atoms / ${bondCount} bonds` },
    ],
    polymerRows: [],
    ligandRows: [],
    solventRows: [],
    notes: ["MOL2 files are grouped as one small-molecule component unless multiple records are present."],
  };
}

function parseMaestroComposition(text: string): StructureCompositionSummary | null {
  const cts = parseMaestroCtSummaries(text);
  if (cts.length === 0) return null;
  const elements = new Map<string, number>();
  for (const ct of cts) {
    for (const [element, count] of ct.elements) increment(elements, element, count);
  }
  const atomTotal = cts.reduce((total, ct) => total + ct.atomCount, 0);
  const bondTotal = cts.reduce((total, ct) => total + ct.bondCount, 0);
  const shareTopology = maestroCtsShareTopology(cts);
  const previewCts = maestroPreviewCts(cts);
  const previewCt = previewCts[0];
  const previewRecords = shareTopology
    ? previewRecordsForSharedTopology(previewCts)
    : previewRecordsForIndependentCts(previewCts);
  const previewUsesIndependentEntries = cts.length > 1 && !shareTopology && previewCts.length > 1;
  const baseSummary = previewRecords.length > 0
    ? summarizeAtomRecords(previewRecords, 1)
    : {
        rows: [],
        componentRows: [],
        polymerRows: [],
        ligandRows: [],
        solventRows: [],
        notes: [],
      };
  const previewLabel = maestroCtLabel(previewCt);
  const previewAtomCount = previewCts.reduce((total, ct) => total + ct.atomCount, 0);
  const rows: StructureSummaryRow[] = [
    { label: "CT blocks", value: formatInteger(cts.length) },
    { label: "Preview atoms", value: formatInteger(previewAtomCount || atomTotal) },
    { label: "Source atoms", value: formatInteger(atomTotal) },
    { label: "Source bonds", value: formatInteger(bondTotal) },
    { label: "Elements", value: formatElementCounts(elements, 8) },
  ];
  if (previewCt) rows.splice(1, 0, { label: previewCts.length > 1 ? "Preview entries" : "Preview CT", value: previewCts.length > 1 ? formatInteger(previewCts.length) : previewLabel });

  const ctRows: StructureSummaryRow[] = cts.slice(0, 12).map((ct) => ({
    label: maestroCtLabel(ct),
    value: maestroCtValue(ct),
    action: maestroCtAction(ct),
  }));
  if (cts.length > ctRows.length) ctRows.push({ label: "More CT blocks", value: `${cts.length - ctRows.length} hidden` });

  return {
    rows,
    componentRows: baseSummary.componentRows,
    maestroRows: ctRows,
    polymerRows: baseSummary.polymerRows,
    ligandRows: baseSummary.ligandRows,
    solventRows: baseSummary.solventRows,
    notes: [
      "MAE, MAEGZ, and CMS composition is parsed from Maestro CT atom and bond tables.",
      cts.length > 1 ? "Component counts use the Mol* preview entries; source CT blocks are listed separately as Maestro entries." : "",
      previewUsesIndependentEntries ? "Independent Maestro CT blocks are combined into one Mol* preview so separate molecules remain visible together." : "",
      cts.length > 1 && shareTopology && previewCts.length > 1 ? "Multiple CT blocks share topology and can be previewed as Mol* models." : "",
      ...baseSummary.notes,
    ].filter(Boolean),
  };
}

function parseMaestroCtSummaries(text: string): MaestroCtSummary[] {
  return splitMaestroCtBlocks(text).map((lines, index) => parseMaestroCtSummary(lines, index + 1)).filter((ct) => ct.atomCount > 0 || ct.bondCount > 0);
}

function splitMaestroCtBlocks(text: string) {
  const lines = text.split(/\r?\n/);
  const blocks: string[][] = [];
  let blockStart = -1;
  let depth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const startsCt = /^\s*f_m_ct\s*\{\s*$/.test(line);
    if (startsCt && depth === 0) blockStart = index;
    if (blockStart < 0) continue;
    depth += countOccurrences(line, "{") - countOccurrences(line, "}");
    if (depth === 0) {
      blocks.push(lines.slice(blockStart, index + 1));
      blockStart = -1;
    }
  }
  return blocks;
}

function parseMaestroCtSummary(lines: string[], index: number): MaestroCtSummary {
  const scalarValues = parseMaestroScalarValues(lines);
  const atomTables = parseMaestroTables(lines, "m_atom");
  const bondTables = parseMaestroTables(lines, "m_bond");
  const elements = new Map<string, number>();
  const records: AtomRecord[] = [];
  for (const table of atomTables) {
    for (const row of table.rows) {
      const element = maestroAtomElement(table.headers, row);
      if (element) increment(elements, element, 1);
      records.push({
        group: residueGroupForName(maestroAtomResidueName(table.headers, row)),
        atomName: maestroTableValue(table.headers, row, ["s_m_pdb_atom_name", "s_m_atom_name"]) || element || "X",
        resName: maestroAtomResidueName(table.headers, row),
        chain: maestroTableValue(table.headers, row, ["s_m_chain_name", "s_m_pdb_chain_name"]) || "-",
        seq: maestroTableValue(table.headers, row, ["i_m_residue_number", "i_m_pdb_residue_number"]) || String(index),
        icode: "",
        element,
        model: String(index),
      });
    }
  }
  return {
    index,
    title: scalarValues.get("s_m_title") ?? "",
    entryName: scalarValues.get("s_m_entry_name") ?? "",
    ctType: scalarValues.get("s_ffio_ct_type") ?? "",
    forceField: scalarValues.get("s_lp_Force_Field") ?? "",
    variant: scalarValues.get("s_lp_Variant") ?? "",
    charge: scalarValues.get("i_epik_Tot_Q") ?? "",
    energy: scalarValues.get("r_lp_Energy") ?? "",
    atomCount: atomTables.reduce((total, table) => total + Math.max(table.declaredCount, table.rows.length), 0),
    bondCount: bondTables.reduce((total, table) => total + Math.max(table.declaredCount, table.rows.length), 0),
    elements,
    records,
  };
}

function parseMaestroScalarValues(lines: string[]) {
  const values = new Map<string, string>();
  const headers: string[] = [];
  let cursor = 1;
  while (cursor < lines.length) {
    const trimmed = lines[cursor].trim();
    cursor += 1;
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed === ":::") break;
    if (/^[A-Za-z]_/.test(trimmed)) headers.push(trimmed);
  }
  for (const header of headers) {
    if (cursor >= lines.length) break;
    const trimmed = lines[cursor].trim();
    if (/^m_[A-Za-z0-9_]+\[\d+\]\s*\{\s*$/.test(trimmed) || trimmed === "}") break;
    values.set(header, cleanMaestroValue(lines[cursor]));
    cursor += 1;
  }
  return values;
}

function parseMaestroTables(lines: string[], tableName: "m_atom" | "m_bond") {
  const tables: Array<{ declaredCount: number; headers: string[]; rows: string[][] }> = [];
  const tablePattern = new RegExp(`^\\s*${tableName}\\[(\\d+)\\]\\s*\\{\\s*$`);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(tablePattern);
    if (!match) continue;
    const declaredCount = Number.parseInt(match[1], 10);
    const headers: string[] = [];
    const rows: string[][] = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const trimmed = lines[cursor].trim();
      cursor += 1;
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed === ":::") break;
      headers.push(trimmed);
    }
    while (cursor < lines.length) {
      const trimmed = lines[cursor].trim();
      cursor += 1;
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed === ":::" || trimmed === "}") break;
      rows.push(splitCifTokens(trimmed).map(cleanMaestroValue));
    }
    tables.push({ declaredCount: Number.isFinite(declaredCount) ? declaredCount : rows.length, headers, rows });
    index = cursor;
  }
  return tables;
}

function maestroTableValue(headers: string[], row: string[], names: string[]) {
  const offset = row.length === headers.length + 1 ? 1 : 0;
  for (const name of names) {
    const index = headers.indexOf(name);
    if (index >= 0) return row[index + offset] ?? "";
  }
  return "";
}

function maestroAtomElement(headers: string[], row: string[]) {
  const atomicNumber = Number.parseInt(maestroTableValue(headers, row, ["i_m_atomic_number"]), 10);
  return elementFromAtomicNumber(atomicNumber)
    || normalizeElement(maestroTableValue(headers, row, ["s_m_pdb_element", "s_m_element"]))
    || normalizeElement(inferElement(maestroTableValue(headers, row, ["s_m_pdb_atom_name", "s_m_atom_name"])));
}

function maestroAtomResidueName(headers: string[], row: string[]) {
  return (maestroTableValue(headers, row, ["s_m_pdb_residue_name", "s_m_mmod_res"]) || "UNK").toUpperCase();
}

function maestroCtLabel(ct: MaestroCtSummary | undefined) {
  if (!ct) return "CT";
  return ct.title || ct.entryName || `CT ${ct.index}`;
}

function maestroCtValue(ct: MaestroCtSummary) {
  return [
    `${ct.atomCount} ${plural(ct.atomCount, "atom")}`,
    `${ct.bondCount} ${plural(ct.bondCount, "bond")}`,
    ct.forceField,
    ct.variant,
    ct.ctType,
  ].filter(Boolean).join(" / ");
}

function maestroCtAction(ct: MaestroCtSummary): StructureViewerAction {
  const label = `Select ${maestroCtLabel(ct)}`;
  const ctType = ct.ctType.trim().toLowerCase();
  if (ctType === "full_system") {
    return { type: "select_residues", label, selector: { kind: "all" }, granularity: "residue", mode: "replace" };
  }
  if (ctType === "solute") {
    return { type: "select_residues", label, selector: { structure: "primary" }, granularity: "residue", mode: "replace" };
  }
  if (ctType === "ion") {
    return { type: "select_residues", label, selector: { kind: "ion" }, granularity: "residue", mode: "replace" };
  }
  if (ctType === "solvent") {
    return { type: "select_residues", label, selector: { kind: "water" }, granularity: "residue", mode: "replace" };
  }
  return { type: "select_residues", label, selector: maestroCtResidueSelector(ct), granularity: "residue", mode: "replace" };
}

function maestroCtResidueSelector(ct: MaestroCtSummary) {
  const residueNames = Array.from(new Set(ct.records
    .map((record) => record.resName)
    .filter((name) => name && !WATER_NAMES.has(name) && !ION_NAMES.has(name))));
  const selector: Record<string, string | number | Array<string | number>> = { kind: "ligand" };
  if (residueNames.length === 1) selector.label_comp_id = residueNames[0];
  return selector;
}

function maestroPreviewCts(cts: MaestroCtSummary[]) {
  const bestScore = Math.max(...cts.map(maestroCtScore));
  return cts.filter((ct) => maestroCtScore(ct) === bestScore);
}

function previewRecordsForSharedTopology(cts: MaestroCtSummary[]) {
  return cts[0]?.records ?? [];
}

function previewRecordsForIndependentCts(cts: MaestroCtSummary[]) {
  return cts.flatMap((ct, index) => ct.records.map((record) => ({
    ...record,
    chain: maestroPreviewChainName(index),
    model: "1",
  })));
}

function maestroPreviewChainName(index: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return alphabet[index % alphabet.length] || "A";
}

function maestroCtScore(ct: MaestroCtSummary | undefined) {
  const normalizedType = ct?.ctType.trim().toLowerCase();
  if (normalizedType === "full_system") return 4;
  if (normalizedType === "solute") return 3;
  if (normalizedType === "ion") return 1;
  if (normalizedType === "solvent") return 0;
  return 2;
}

function maestroCtsShareTopology(cts: MaestroCtSummary[]) {
  const [firstCt, ...otherCts] = cts;
  if (!firstCt || otherCts.length === 0) return true;
  const firstKeys = firstCt.records.map(maestroRecordTopologyKey);
  return otherCts.every((ct) => (
    ct.records.length === firstKeys.length
    && ct.records.every((record, index) => maestroRecordTopologyKey(record) === firstKeys[index])
  ));
}

function maestroRecordTopologyKey(record: AtomRecord) {
  return [
    record.element,
    record.atomName,
    record.resName,
    record.seq,
    record.chain,
  ].join("|");
}

function cleanMaestroValue(value: string | undefined) {
  if (!value) return "";
  const cleaned = value.trim().replace(/^['"]|['"]$/g, "").trim();
  if (!cleaned || cleaned === "." || cleaned === "?" || cleaned === "<>") return "";
  return cleaned;
}

function countOccurrences(value: string, needle: string) {
  return value.split(needle).length - 1;
}

function classifyResidue(residue: ResidueGroup) {
  if (WATER_NAMES.has(residue.resName)) return "water";
  if (ION_NAMES.has(residue.resName) && residue.atoms <= 2) return "ion";
  if (residue.group === "ATOM" || POLYMER_RESIDUES.has(residue.resName)) return "polymer";
  return "ligand";
}

function pdbqtElementFromAtomType(line: string) {
  const atomType = line.trim().split(/\s+/).at(-1)?.replace(/[^A-Za-z]/g, "") ?? "";
  if (!atomType) return "";
  const normalized = atomType.toUpperCase();
  if (normalized === "A") return "C";
  if (normalized === "HD" || normalized === "HS") return "H";
  if (normalized === "NA" || normalized === "NS") return "N";
  if (normalized === "OA" || normalized === "OS") return "O";
  if (normalized === "SA") return "S";
  return atomType.slice(0, 2);
}

function residueGroupForName(resName: string): "ATOM" | "HETATM" {
  if (POLYMER_RESIDUES.has(resName)) return "ATOM";
  return "HETATM";
}

function naturalChainSort(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function sortResidueGroups(left: ResidueGroup, right: ResidueGroup) {
  const chainOrder = naturalChainSort(left.chain, right.chain);
  if (chainOrder) return chainOrder;
  const leftSeq = Number.parseInt(left.seq, 10);
  const rightSeq = Number.parseInt(right.seq, 10);
  if (Number.isFinite(leftSeq) && Number.isFinite(rightSeq) && leftSeq !== rightSeq) return leftSeq - rightSeq;
  const seqOrder = left.seq.localeCompare(right.seq, undefined, { numeric: true, sensitivity: "base" });
  if (seqOrder) return seqOrder;
  return left.resName.localeCompare(right.resName, undefined, { numeric: true, sensitivity: "base" });
}

function ligandInstanceLabel(ligand: ResidueGroup) {
  const chain = ligand.chain && ligand.chain !== "-" ? ` ${ligand.chain}` : "";
  const seq = ligand.seq && ligand.seq !== "?" ? ` ${ligand.seq}${ligand.icode}` : "";
  return `${ligand.resName}${chain}${seq}`;
}

function ligandInstanceSelector(ligand: ResidueGroup): Record<string, string | number | Array<string | number>> {
  const selector: Record<string, string | number | Array<string | number>> = {
    kind: "ligand",
    label_comp_id: ligand.resName,
  };
  if (ligand.chain && ligand.chain !== "-") selector.auth_asym_id = ligand.chain;
  const seq = Number.parseInt(ligand.seq, 10);
  if (Number.isFinite(seq)) selector.auth_seq_id = seq;
  if (ligand.icode) selector.pdbx_PDB_ins_code = ligand.icode;
  return selector;
}

function polymerLabel(chain: ChainGroup) {
  const labels: string[] = [];
  if (chain.proteinResidues > 0) labels.push(`${chain.proteinResidues} protein`);
  if (chain.nucleicResidues > 0) labels.push(`${chain.nucleicResidues} nucleic`);
  if (chain.otherResidues > 0) labels.push(`${chain.otherResidues} other`);
  return labels.length > 0 ? labels.join(" / ") : "Polymer";
}

function parseMolCounts(text: string) {
  const lines = text.split(/\r?\n/);
  const counts = parseV2000MolCountsLine(lines[3] ?? "")
    ?? lines.slice(0, 8).map(parseV2000MolCountsLine).find(Boolean);
  let atoms = counts?.atoms ?? Number.NaN;
  let bonds = counts?.bonds ?? Number.NaN;
  if (!Number.isFinite(atoms) || !Number.isFinite(bonds)) {
    const v3000 = text.match(/M\s+V30\s+COUNTS\s+(\d+)\s+(\d+)/);
    atoms = v3000 ? Number.parseInt(v3000[1], 10) : 0;
    bonds = v3000 ? Number.parseInt(v3000[2], 10) : 0;
  }
  return {
    atoms: Number.isFinite(atoms) ? atoms : 0,
    bonds: Number.isFinite(bonds) ? bonds : 0,
  };
}

function parseV2000MolCountsLine(line: string) {
  const match = line.match(/^\s*(\d{1,3})\s+(\d{1,3})\b.*\bV2000\b/);
  if (!match) return null;
  return {
    atoms: Number.parseInt(match[1], 10),
    bonds: Number.parseInt(match[2], 10),
  };
}

function countMol2SectionRows(text: string, section: string) {
  const start = new RegExp(`^@<TRIPOS>${section}$`, "im").exec(text);
  if (!start) return 0;
  const rest = text.slice(start.index).split(/\r?\n/).slice(1);
  let count = 0;
  for (const line of rest) {
    if (line.startsWith("@<TRIPOS>")) break;
    if (line.trim()) count += 1;
  }
  return count;
}

function firstHeaderIndex(headers: string[], names: string[]) {
  for (const name of names) {
    const index = headers.findIndex((header) => header === name);
    if (index >= 0) return index;
  }
  return -1;
}

function splitCifTokens(line: string) {
  const tokens: string[] = [];
  const pattern = /'(?:[^']*)'|"(?:[^"]*)"|\S+/g;
  for (const match of line.matchAll(pattern)) tokens.push(match[0]);
  return tokens;
}

function cleanCifValue(value: string | undefined) {
  if (!value || value === "." || value === "?") return "";
  return value.replace(/^['"]|['"]$/g, "");
}

function inferElement(atomName: string) {
  const cleaned = atomName.replace(/[^A-Za-z]/g, "");
  if (!cleaned) return "";
  return cleaned.length >= 2 && cleaned[0].toUpperCase() === cleaned[0] && cleaned[1].toLowerCase() === cleaned[1]
    ? cleaned.slice(0, 2)
    : cleaned[0];
}

function normalizeElement(value: string) {
  const cleaned = value.replace(/[^A-Za-z]/g, "");
  if (!cleaned) return "";
  return cleaned.length === 1 ? cleaned.toUpperCase() : `${cleaned[0].toUpperCase()}${cleaned.slice(1, 2).toLowerCase()}`;
}

function elementFromAtomicNumber(atomicNumber: number) {
  const elements = ["", "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr"];
  return elements[atomicNumber] ?? "";
}

function increment(map: Map<string, number>, key: string, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function formatElementCounts(elements: Map<string, number>, limit: number) {
  if (elements.size === 0) return "None detected";
  return formatNameCounts(elements, limit);
}

function formatNameCounts(values: Map<string, number>, limit: number) {
  const entries = [...values.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const visible = entries.slice(0, limit).map(([name, count]) => `${name} ${count}`);
  if (entries.length > limit) visible.push(`+${entries.length - limit}`);
  return visible.join(", ");
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function plural(count: number, noun: string) {
  return count === 1 ? noun : `${noun}s`;
}
