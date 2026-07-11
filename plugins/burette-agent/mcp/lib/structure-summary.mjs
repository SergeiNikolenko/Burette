import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const MAX_SUMMARY_BYTES = 16 * 1024 * 1024;

const WATER_NAMES = new Set(["HOH", "WAT", "H2O", "DOD", "TIP", "TIP3", "TIP3P", "TIP4", "TIP4P", "TP3", "TP4", "SPC", "SPCE", "SOL"]);
const ION_NAMES = new Set([
  "AG", "AL", "BA", "BR", "CA", "CD", "CL", "CO", "CS", "CU", "FE", "HG", "IOD", "K",
  "LI", "MG", "MN", "NA", "NI", "RB", "SR", "ZN",
]);
const PROTEIN_RESIDUES = new Set([
  "ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE", "LEU", "LYS",
  "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL", "ASX", "GLX", "SEC", "PYL",
  "HID", "HIE", "HIP", "HSD", "HSE", "HSP",
]);
const NUCLEIC_RESIDUES = new Set(["A", "C", "G", "T", "U", "DA", "DC", "DG", "DT", "DU", "ADE", "CYT", "GUA", "THY", "URA"]);
const POLYMER_RESIDUES = new Set([...PROTEIN_RESIDUES, ...NUCLEIC_RESIDUES]);

export async function summarizeStructureFile(file) {
  const absolutePath = path.resolve(file);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error(`Not a file: ${absolutePath}`);
  }
  if (fileStat.size > MAX_SUMMARY_BYTES) {
    throw new Error(`File is too large for structure summary: ${fileStat.size} bytes`);
  }

  const text = await readFile(absolutePath, "utf8");
  return summarizeStructureText({
    text,
    fileName: absolutePath,
    byteCount: fileStat.size,
    sourcePath: absolutePath,
  });
}

export function summarizeStructureText({ text, fileName, byteCount, sourcePath }) {
  const normalizedText = String(text ?? "");
  const normalizedFileName = String(fileName || "structure");
  const resolvedByteCount = Number.isFinite(byteCount)
    ? Number(byteCount)
    : Buffer.byteLength(normalizedText, "utf8");
  if (resolvedByteCount > MAX_SUMMARY_BYTES) {
    throw new Error(`Structure text is too large for summary: ${resolvedByteCount} bytes`);
  }

  const extension = extensionForPath(normalizedFileName);
  const base = {
    ...(sourcePath ? { path: String(sourcePath) } : {}),
    title: path.basename(normalizedFileName),
    extension,
    byteCount: resolvedByteCount,
    lineCount: lineCount(normalizedText),
  };

  if (extension === "pdb" || extension === "ent" || extension === "pdbqt") {
    return summarizePdbLike(base, normalizedText, extension);
  }
  if (extension === "xyz" || extension === "extxyz") {
    return summarizeXyz(base, normalizedText, extension);
  }
  if (extension === "sdf") {
    return summarizeSdf(base, normalizedText);
  }
  if (extension === "cif" || extension === "mmcif") {
    return summarizeCif(base, normalizedText);
  }
  if (extension === "cfg") {
    return summarizeMlipCfg(base, normalizedText);
  }
  if (extension === "in" || extension === "inp") {
    return summarizeCoordinateAtoms(base, parseQuantumEspressoAtoms(normalizedText), "QE", "Quantum ESPRESSO input");
  }
  if (extension === "log" || extension === "out") {
    return summarizeCoordinateAtoms(base, parseBestCoordinateBlock(normalizedText), extension.toUpperCase(), "Text coordinate output");
  }
  if (extension === "data" || extension === "lammps" || extension === "lmp") {
    return summarizeCoordinateAtoms(base, parseLammpsDataAtoms(normalizedText), "LAMMPS", "LAMMPS data");
  }
  return {
    ...base,
    format: extension ? extension.toUpperCase() : "FILE",
    kind: "Molecular file",
    summaryLine: `${extension ? extension.toUpperCase() : "File"} molecular file, ${formatInteger(resolvedByteCount)} bytes`,
    counts: {},
    rows: [
      { label: "Format", value: extension ? extension.toUpperCase() : "FILE" },
      { label: "Size", value: `${formatInteger(resolvedByteCount)} bytes` },
      { label: "Lines", value: formatInteger(lineCount(normalizedText)) },
    ],
    components: {},
    notes: ["No structure parser is available for this extension."],
  };
}

function summarizePdbLike(base, text, extension) {
  const records = [];
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
    const element = normalizeElement(extension === "pdbqt" ? pdbqtElement(line, atomName) : line.slice(76, 78).trim() || inferElement(atomName));
    records.push({ group: record, atomName, resName, chain, seq, icode, element, model });
  }

  if (records.length === 0) {
    return emptyParsedSummary(base, extension.toUpperCase(), "Macromolecule", "No ATOM/HETATM records detected.");
  }
  return summarizeAtomRecords(base, records, explicitModelCount > 0 ? explicitModelCount : 1, extension.toUpperCase());
}

function summarizeAtomRecords(base, records, modelCount, format) {
  const residues = new Map();
  const elements = new Map();
  const chainGroups = new Map();
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
      elementCounts: new Map(),
    };
    residue.atoms += 1;
    if (record.element) increment(residue.elementCounts, record.element, 1);
    residues.set(residueKey, residue);
  }

  let polymerResidues = 0;
  let polymerAtoms = 0;
  let ligandAtoms = 0;
  let waterMolecules = 0;
  let waterAtoms = 0;
  let ionAtoms = 0;
  const ligandTypes = new Map();
  const ligandInstances = [];
  const ionTypes = new Map();

  for (const residue of residues.values()) {
    const kind = classifyResidue(residue);
    if (kind === "polymer") {
      polymerResidues += 1;
      polymerAtoms += residue.atoms;
      const chain = chainGroups.get(residue.chain) ?? { id: residue.chain, residues: 0, atoms: 0, proteinResidues: 0, nucleicResidues: 0, otherResidues: 0 };
      chain.residues += 1;
      chain.atoms += residue.atoms;
      if (PROTEIN_RESIDUES.has(residue.resName)) chain.proteinResidues += 1;
      else if (NUCLEIC_RESIDUES.has(residue.resName)) chain.nucleicResidues += 1;
      else chain.otherResidues += 1;
      chainGroups.set(residue.chain, chain);
    } else if (kind === "water") {
      waterMolecules += 1;
      waterAtoms += residue.atoms;
    } else if (kind === "ion") {
      ionAtoms += residue.atoms;
      const ion = ionTypes.get(residue.resName) ?? { compId: residue.resName, instances: 0, atoms: 0 };
      ion.instances += 1;
      ion.atoms += residue.atoms;
      ionTypes.set(residue.resName, ion);
    } else {
      ligandAtoms += residue.atoms;
      ligandInstances.push(residue);
      const ligand = ligandTypes.get(residue.resName) ?? { compId: residue.resName, instances: 0, atoms: 0 };
      ligand.instances += 1;
      ligand.atoms += residue.atoms;
      ligandTypes.set(residue.resName, ligand);
    }
  }

  const chains = [...chainGroups.values()].sort((left, right) => naturalSort(left.id, right.id));
  const ligands = ligandInstances.sort(sortResidues).map((ligand) => ({
    label: ligandLabel(ligand),
    compId: ligand.resName,
    chain: ligand.chain,
    seq: parseSeq(ligand.seq),
    insertionCode: ligand.icode || null,
    atoms: ligand.atoms,
    selector: {
      kind: "ligand",
      label_comp_id: ligand.resName,
      auth_asym_id: ligand.chain,
      auth_seq_id: parseSeq(ligand.seq),
    },
  }));
  const ions = [...ionTypes.values()].sort((left, right) => right.instances - left.instances || left.compId.localeCompare(right.compId));
  const kind = polymerResidues > 0 ? "Macromolecule" : "Small molecule";
  const summaryLine = [
    `${format} ${kind.toLowerCase()}`,
    `${chains.length} ${plural(chains.length, "chain")}`,
    `${formatInteger(records.length)} atoms`,
    `${formatInteger(ligands.length)} ${plural(ligands.length, "ligand instance")}`,
    waterMolecules > 0 ? `${formatInteger(waterMolecules)} waters` : null,
    ions.length > 0 ? `${ions.length} ion ${plural(ions.length, "type")}` : null,
  ].filter(Boolean).join(", ");

  return {
    ...base,
    format,
    kind,
    summaryLine,
    counts: {
      atoms: records.length,
      residues: residues.size,
      chains: chains.length,
      models: modelCount,
      polymerResidues,
      polymerAtoms,
      ligandTypes: ligandTypes.size,
      ligandInstances: ligands.length,
      ligandAtoms,
      waterMolecules,
      waterAtoms,
      ionTypes: ions.length,
      ionAtoms,
    },
    rows: [
      { label: "Atoms", value: formatInteger(records.length) },
      { label: "Residues", value: formatInteger(residues.size) },
      { label: "Chains", value: chains.length > 0 ? formatInteger(chains.length) : "None detected" },
      { label: "Models", value: formatInteger(modelCount) },
      { label: "Elements", value: formatNameCounts(elements, 8) },
    ],
    components: {
      polymers: {
        chains: chains.length,
        residues: polymerResidues,
        atoms: polymerAtoms,
      },
      ligands,
      ligandTypes: [...ligandTypes.values()].sort((left, right) => right.instances - left.instances || left.compId.localeCompare(right.compId)),
      chains,
      water: {
        molecules: waterMolecules,
        atoms: waterAtoms,
      },
      ions,
    },
    notes: [
      "Residue classes are inferred from coordinate records and common residue names.",
      ligands.length > 50 ? `Ligand list contains ${ligands.length} instances; clients should paginate before display.` : null,
    ].filter(Boolean),
  };
}

function summarizeXyz(base, text, extension) {
  const lines = text.split(/\r?\n/);
  let cursor = 0;
  let frames = 0;
  let firstFrameAtoms = 0;
  let totalAtoms = 0;
  const elements = new Map();
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
  if (frames === 0) return emptyParsedSummary(base, extension.toUpperCase(), "Structure frames", "No XYZ frames detected.");
  return {
    ...base,
    format: extension.toUpperCase(),
    kind: "Structure frames",
    summaryLine: `${extension.toUpperCase()} structure frames, ${frames} ${plural(frames, "frame")}, ${formatInteger(firstFrameAtoms)} atoms/frame`,
    counts: { frames, atomsPerFrame: firstFrameAtoms, totalAtoms },
    rows: [
      { label: "Frames", value: formatInteger(frames) },
      { label: "Atoms/frame", value: formatInteger(firstFrameAtoms) },
      { label: "Total atoms", value: formatInteger(totalAtoms) },
      { label: "Elements", value: formatNameCounts(elements, 8) },
    ],
    components: { elements: Object.fromEntries(elements) },
    notes: ["XYZ components are element-level because the format has no residue or chain records."],
  };
}

function summarizeSdf(base, text) {
  const molecules = text.split(/\r?\n\$\$\$\$/).map((block) => block.trim()).filter(Boolean);
  let atomTotal = 0;
  let bondTotal = 0;
  const titles = [];
  for (const molecule of molecules) {
    titles.push(molecule.split(/\r?\n/, 1)[0]?.trim() || "Untitled molecule");
    const counts = parseMolCounts(molecule);
    atomTotal += counts.atoms;
    bondTotal += counts.bonds;
  }
  return {
    ...base,
    format: "SDF",
    kind: molecules.length > 1 ? "Molecule collection" : "Small molecule",
    summaryLine: `SDF ${molecules.length > 1 ? "collection" : "molecule"}, ${formatInteger(molecules.length)} ${plural(molecules.length, "molecule")}, ${formatInteger(atomTotal)} atoms`,
    counts: { molecules: molecules.length, atoms: atomTotal, bonds: bondTotal },
    rows: [
      { label: "Molecules", value: formatInteger(molecules.length) },
      { label: "Atoms", value: formatInteger(atomTotal) },
      { label: "Bonds", value: formatInteger(bondTotal) },
    ],
    components: {
      molecules: titles.slice(0, 50).map((title, index) => ({ index, title })),
    },
    notes: ["SDF molecule counts are parsed from molfile count lines."],
  };
}

function summarizeCif(base, text) {
  const atomSiteLines = text.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("_") && !trimmed.startsWith("loop_");
  });
  const likelyAtomRows = atomSiteLines.filter((line) => /\b(ATOM|HETATM)\b/.test(line));
  const atoms = likelyAtomRows.length;
  return {
    ...base,
    format: "CIF",
    kind: atoms > 0 ? "Macromolecule" : "Molecular file",
    summaryLine: atoms > 0 ? `CIF macromolecule, ${formatInteger(atoms)} atom_site rows` : "CIF molecular file",
    counts: { atomSiteRows: atoms },
    rows: [
      { label: "Atom sites", value: atoms > 0 ? formatInteger(atoms) : "Not detected" },
      { label: "Lines", value: formatInteger(base.lineCount) },
    ],
    components: {},
    notes: ["CIF summary is intentionally lightweight; open the file in Burrete for detailed residue grouping."],
  };
}

function summarizeMlipCfg(base, text) {
  const atoms = parseMlipCfgAtoms(text);
  const configs = (text.match(/\bBEGIN_CFG\b/g) || []).length;
  const summary = summarizeCoordinateAtoms(base, atoms, "CFG", "MLIP configuration");
  return {
    ...summary,
    summaryLine: atoms.length > 0
      ? `CFG MLIP configuration, ${formatInteger(configs || 1)} ${plural(configs || 1, "configuration")}, ${formatInteger(atoms.length)} atoms in first configuration`
      : summary.summaryLine,
    counts: { ...summary.counts, configurations: configs || 0 },
    rows: [
      { label: "Configurations", value: configs > 0 ? formatInteger(configs) : "Not detected" },
      ...summary.rows,
    ],
    notes: [
      "MLIP CFG summary reads the first BEGIN_CFG block for coordinates.",
    ],
  };
}

function summarizeCoordinateAtoms(base, atoms, format, kind) {
  if (atoms.length === 0) return emptyParsedSummary(base, format, kind, "No supported coordinate block was detected.");
  const elements = new Map();
  for (const atom of atoms) {
    increment(elements, atom.element || "X", 1);
  }
  return {
    ...base,
    format,
    kind,
    summaryLine: `${format} ${kind.toLowerCase()}, ${formatInteger(atoms.length)} atoms`,
    counts: { atoms: atoms.length, elements: elements.size },
    rows: [
      { label: "Atoms", value: formatInteger(atoms.length) },
      { label: "Elements", value: formatNameCounts(elements, 8) },
      { label: "Lines", value: formatInteger(base.lineCount) },
    ],
    components: { elements: Object.fromEntries(elements) },
    notes: ["Coordinate summary is element-level because this format has no residue or chain records."],
  };
}

function emptyParsedSummary(base, format, kind, note) {
  return {
    ...base,
    format,
    kind,
    summaryLine: `${format} ${kind.toLowerCase()}, no coordinate records detected`,
    counts: {},
    rows: [
      { label: "Format", value: format },
      { label: "Lines", value: formatInteger(base.lineCount) },
    ],
    components: {},
    notes: [note],
  };
}

function classifyResidue(residue) {
  if (WATER_NAMES.has(residue.resName)) return "water";
  if (ION_NAMES.has(residue.resName) && residue.atoms <= 2) return "ion";
  if (residue.group === "ATOM" || POLYMER_RESIDUES.has(residue.resName)) return "polymer";
  return "ligand";
}

function parseMolCounts(block) {
  const lines = block.split(/\r?\n/);
  const countsLine = lines[3] ?? "";
  return {
    atoms: Number.parseInt(countsLine.slice(0, 3).trim(), 10) || 0,
    bonds: Number.parseInt(countsLine.slice(3, 6).trim(), 10) || 0,
  };
}

function parseQuantumEspressoAtoms(text) {
  const lines = text.split(/\r?\n/);
  const atoms = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^ATOMIC_POSITIONS\b/i.test(lines[index].trim())) continue;
    for (let atomLineIndex = index + 1; atomLineIndex < lines.length; atomLineIndex += 1) {
      const parsed = parseElementCoordinateLine(lines[atomLineIndex]);
      if (!parsed) {
        if (atoms.length > 0) return atoms;
        break;
      }
      atoms.push(parsed);
    }
  }
  return atoms;
}

function parseBestCoordinateBlock(text) {
  const lines = text.split(/\r?\n/);
  let best = [];
  for (let start = 0; start < lines.length; start += 1) {
    const block = [];
    for (let index = start; index < lines.length; index += 1) {
      const parsed = parseElementCoordinateLine(lines[index]);
      if (!parsed) {
        if (block.length >= 3) break;
        if (block.length > 0) break;
        continue;
      }
      block.push(parsed);
    }
    if (block.length > best.length) best = block;
  }
  return best;
}

function parseMlipCfgAtoms(text) {
  const lines = text.split(/\r?\n/);
  const begin = lines.findIndex((line) => line.trim() === "BEGIN_CFG");
  if (begin < 0) return [];
  const end = lines.findIndex((line, index) => index > begin && line.trim() === "END_CFG");
  const block = lines.slice(begin, end > begin ? end : undefined);
  const size = parseMlipCfgSize(block);
  const atomDataIndex = block.findIndex((line) => line.trim().startsWith("AtomData:"));
  if (atomDataIndex < 0) return [];
  const header = block[atomDataIndex].trim().split(/\s+/).slice(1);
  const typeIndex = header.indexOf("type");
  const xIndex = header.indexOf("cartes_x");
  const yIndex = header.indexOf("cartes_y");
  const zIndex = header.indexOf("cartes_z");
  if (xIndex < 0 || yIndex < 0 || zIndex < 0) return [];
  const atoms = [];
  for (let index = atomDataIndex + 1; index < block.length; index += 1) {
    const values = block[index].trim().split(/\s+/);
    if (values.length < header.length) break;
    const x = Number.parseFloat(values[xIndex]);
    const y = Number.parseFloat(values[yIndex]);
    const z = Number.parseFloat(values[zIndex]);
    if (![x, y, z].every(Number.isFinite)) break;
    const type = typeIndex >= 0 ? values[typeIndex] : "";
    atoms.push({ element: mlipCfgSymbolForType(type), x, y, z });
    if (size > 0 && atoms.length >= size) break;
  }
  return atoms;
}

function parseMlipCfgSize(block) {
  const sizeIndex = block.findIndex((line) => line.trim() === "Size");
  if (sizeIndex < 0 || sizeIndex + 1 >= block.length) return 0;
  const size = Number.parseInt(block[sizeIndex + 1].trim(), 10);
  return Number.isFinite(size) ? size : 0;
}

function mlipCfgSymbolForType(type) {
  const normalized = normalizeElement(type);
  if (normalized) return normalized;
  if (type === "1") return "H";
  if (/^\d+$/.test(type)) return "C";
  return "X";
}

function parseLammpsDataAtoms(text) {
  const lines = text.split(/\r?\n/);
  const masses = parseLammpsMasses(lines);
  const atoms = [];
  const atomsIndex = lines.findIndex((line) => /^Atoms\b/i.test(line.trim()));
  if (atomsIndex < 0) return atoms;
  for (let index = atomsIndex + 1; index < lines.length; index += 1) {
    const line = stripInlineComment(lines[index]).trim();
    if (!line) continue;
    if (/^[A-Za-z]/.test(line)) break;
    const values = line.split(/\s+/);
    if (values.length < 5) continue;
    const atom = lammpsDataAtom(values, masses);
    if (!atom) continue;
    atoms.push(atom);
  }
  return atoms;
}

function parseLammpsMasses(lines) {
  const masses = new Map();
  const massesIndex = lines.findIndex((line) => /^Masses\b/i.test(line.trim()));
  if (massesIndex < 0) return masses;
  for (let index = massesIndex + 1; index < lines.length; index += 1) {
    const line = stripInlineComment(lines[index]).trim();
    if (!line) continue;
    if (/^[A-Za-z]/.test(line)) break;
    const values = line.split(/\s+/);
    const type = values[0];
    const symbol = normalizeElement(values[2]) || lammpsSymbolFromMass(values[1]);
    if (type && symbol) masses.set(type, symbol);
  }
  return masses;
}

function lammpsDataAtom(values, masses) {
  const starts = [];
  if (masses.has(values[2])) starts.push({ coordinateIndex: 4, typeIndex: 2 });
  if (masses.has(values[1])) starts.push({ coordinateIndex: 3, typeIndex: 1 }, { coordinateIndex: 2, typeIndex: 1 });
  starts.push(
    { coordinateIndex: 3, typeIndex: 1 },
    { coordinateIndex: 4, typeIndex: 2 },
    { coordinateIndex: 2, typeIndex: 1 },
  );
  for (const start of starts) {
    const x = Number.parseFloat(values[start.coordinateIndex]);
    const y = Number.parseFloat(values[start.coordinateIndex + 1]);
    const z = Number.parseFloat(values[start.coordinateIndex + 2]);
    if ([x, y, z].every(Number.isFinite)) {
      return { element: lammpsDataAtomSymbol(values, masses, start.typeIndex), x, y, z };
    }
  }
  return null;
}

function lammpsDataAtomSymbol(values, masses, typeIndex) {
  return masses.get(values[typeIndex])
    || normalizeElement(values[typeIndex])
    || "X";
}

function lammpsSymbolFromMass(value) {
  const mass = Number(value);
  if (!Number.isFinite(mass)) return "";
  if (Math.abs(mass - 1.008) < 0.25) return "H";
  if (Math.abs(mass - 12.011) < 0.5) return "C";
  if (Math.abs(mass - 14.007) < 0.5) return "N";
  if (Math.abs(mass - 15.999) < 0.5) return "O";
  if (Math.abs(mass - 32.06) < 1) return "S";
  return "";
}

function parseElementCoordinateLine(line) {
  const values = stripInlineComment(line).trim().split(/\s+/);
  if (values.length < 4) return null;
  const element = normalizeElement(values[0]);
  const x = Number.parseFloat(values[1]);
  const y = Number.parseFloat(values[2]);
  const z = Number.parseFloat(values[3]);
  if (!element || ![x, y, z].every(Number.isFinite)) return null;
  return { element, x, y, z };
}

function stripInlineComment(line) {
  return String(line || "").replace(/[#;!].*$/, "");
}

function ligandLabel(residue) {
  return [residue.resName, residue.chain === "-" ? "" : residue.chain, residue.seq === "?" ? "" : residue.seq, residue.icode].filter(Boolean).join(" ");
}

function sortResidues(left, right) {
  return left.resName.localeCompare(right.resName)
    || naturalSort(left.chain, right.chain)
    || parseSeq(left.seq) - parseSeq(right.seq)
    || left.icode.localeCompare(right.icode);
}

function naturalSort(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function parseSeq(seq) {
  const parsed = Number.parseInt(seq, 10);
  return Number.isFinite(parsed) ? parsed : seq;
}

function pdbqtElement(line, atomName) {
  const atomType = line.slice(77).trim().split(/\s+/).pop();
  return atomType ? atomType.replace(/[^A-Za-z]/g, "") : inferElement(atomName);
}

function normalizeElement(value) {
  const cleaned = String(value || "").replace(/[^A-Za-z]/g, "");
  if (!cleaned) return "";
  if (cleaned.length === 1) return cleaned.toUpperCase();
  return `${cleaned[0].toUpperCase()}${cleaned.slice(1, 2).toLowerCase()}`;
}

function inferElement(atomName) {
  return String(atomName || "").replace(/^\d+/, "").slice(0, 2);
}

function increment(map, key, amount) {
  map.set(key, (map.get(key) || 0) + amount);
}

function formatNameCounts(map, limit) {
  const entries = [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, limit);
  return entries.length > 0 ? entries.map(([name, count]) => `${name} ${formatInteger(count)}`).join(", ") : "None detected";
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function plural(count, noun) {
  return count === 1 ? noun : `${noun}s`;
}

function extensionForPath(file) {
  const extension = path.extname(file).replace(/^\./, "").toLowerCase();
  if (extension) return extension;
  const basename = path.basename(file);
  return /^in(?:_|$)/iu.test(basename) ? "in" : "";
}

function lineCount(text) {
  return text.length === 0 ? 0 : text.split(/\r?\n/).length;
}
