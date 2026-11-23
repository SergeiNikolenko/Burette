import type { ShellActions } from "../../components/types";
import type { ViewerDocument } from "../../types";
import type { StructureViewerSelector } from "../structure-composition";
import { ELEMENT_SYMBOLS } from "../molecular-workbench/elements";
import { runChemistryTask } from "../molecular-workbench/compute-client";
import { serializeXyz } from "../molecular-workbench/xyz";
import type { MolecularAtom, MolecularBond } from "../molecular-workbench/types";
import { classifySourceShape } from "../source-editing/policy";
import { geometryPanelAvailable } from "../geometry-editing";
import { logicalSourceFor, sourceExtension } from "../science-session/state";
import { readStructureText } from "../structure-text";
import { fileStem, sdfFromGraph, sdfRecord } from "./formats";
import { openGeneratedStructure } from "./generated-document-open";
import { markEditableVirtualGraph, structureEditAvailable } from "./graph-draft";
import { readPdbAtoms, readWorkbenchSource } from "./structure";
import { runReaderTask } from "./reader-task";

export const EDIT_3D_MAX_ATOMS = 256;

const GRAPH_EXTENSIONS = new Set(["sdf", "sd", "mol"]);
const PDB_EXTENSIONS = new Set(["pdb", "ent"]);
const CIF_EXTENSIONS = new Set(["cif", "mmcif", "mcif"]);
const CONVERTIBLE_3D_EXTENSIONS = new Set([
  "sdf", "sd", "mol", "mol2", "pdb", "ent",
  "cif", "mmcif", "mcif", "vasp",
  "xyz", "out", "log", "cube", "cub", "molden", "hess", "fchk", "fch",
]);

export type Edit3dMode = "in-place-graph" | "in-place-geometry" | "convert-to-sdf";

export type Edit3dLigandScope = {
  label: string;
  selector: StructureViewerSelector;
  atoms?: number | null;
};

export function edit3dMode(document: ViewerDocument | null): Edit3dMode | null {
  if (!document || document.renderer !== "molstar" || document.dockingRequest || document.mergedCollection) return null;
  if (structureEditAvailable(document)) return "in-place-graph";
  if (geometryPanelAvailable(document)) return "in-place-geometry";
  const extension = sourceExtension(document);
  return CONVERTIBLE_3D_EXTENSIONS.has(extension) ? "convert-to-sdf" : null;
}

export function canEditIn3d(document: ViewerDocument | null): document is ViewerDocument {
  return edit3dMode(document) !== null;
}

function normalizeElement(raw: string): string | null {
  const cleaned = raw.trim().replace(/\..*$/u, "").replace(/[^A-Za-z]/gu, "");
  if (!cleaned) return null;
  const two = cleaned.length >= 2 ? cleaned[0].toUpperCase() + cleaned[1].toLowerCase() : "";
  if (two && ELEMENT_SYMBOLS.includes(two)) return two;
  const one = cleaned[0].toUpperCase();
  return ELEMENT_SYMBOLS.includes(one) ? one : null;
}

/** Splits an SDF file into non-empty individual records and returns the requested index. */
export function extractSdfRecord(text: string, index = 0): string {
  const normalized = text.replace(/\r\n?/gu, "\n");
  const records = normalized
    .split(/^\$\$\$\$[^\n]*$/gmu)
    .map((chunk) => chunk.replace(/^\n+|\s+$/gu, ""))
    .filter((chunk) => chunk.length > 0);
  if (!records.length) throw new Error("The SDF file has no molecule records.");
  const clamped = Math.max(0, Math.min(records.length - 1, Math.trunc(index)));
  return `${records[clamped]}\n$$$$\n`;
}

/** Parses the first molecule in a SYBYL MOL2 file into an explicit SDF record preserving coordinates and bond orders. */
export function parseMol2ToSdf(text: string, fallbackTitle = "molecule"): string {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  let section = "";
  let title = "";
  let moleculeLineOffset = 0;
  let sawMolecule = false;
  const atoms: MolecularAtom[] = [];
  const atomIndexById = new Map<number, number>();
  const bonds: MolecularBond[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("@<TRIPOS>")) {
      const next = trimmed.slice("@<TRIPOS>".length).toUpperCase();
      if (next === "MOLECULE") {
        if (sawMolecule) break;
        sawMolecule = true;
        moleculeLineOffset = 0;
      }
      section = next;
      continue;
    }
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (section === "MOLECULE") {
      if (moleculeLineOffset === 0 && !title) title = trimmed;
      moleculeLineOffset += 1;
      continue;
    }
    if (section === "ATOM") {
      const fields = trimmed.split(/\s+/u);
      if (fields.length < 6) continue;
      const id = Number.parseInt(fields[0], 10);
      const x = Number(fields[2]);
      const y = Number(fields[3]);
      const z = Number(fields[4]);
      const element = normalizeElement(fields[5]) ?? normalizeElement(fields[1]);
      if (!Number.isInteger(id) || !element || ![x, y, z].every(Number.isFinite)) {
        throw new Error(`MOL2 atom ${atoms.length + 1} has an unsupported element or coordinates.`);
      }
      atomIndexById.set(id, atoms.length);
      atoms.push({ element, x, y, z });
      continue;
    }
    if (section === "BOND") {
      const fields = trimmed.split(/\s+/u);
      if (fields.length < 4) continue;
      const a = atomIndexById.get(Number.parseInt(fields[1], 10));
      const b = atomIndexById.get(Number.parseInt(fields[2], 10));
      if (a === undefined || b === undefined || a === b) continue;
      const rawType = fields[3].toLowerCase();
      if (rawType === "du" || rawType === "nc") continue;
      const order: MolecularBond["order"] = rawType === "2" ? 2
        : rawType === "3" ? 3
        : rawType === "ar" ? 1.5
        : 1;
      bonds.push({ a, b, order });
    }
  }
  if (!atoms.length) throw new Error("The MOL2 file has no atoms.");
  assertEditableAtomCount(atoms.length);
  return sdfFromGraph(atoms, bonds, title || fallbackTitle);
}

function selectorString(selector: StructureViewerSelector, keys: string[]): string | null {
  for (const key of keys) {
    const value = selector[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string" && value[0].trim()) return value[0].trim();
  }
  return null;
}

function selectorInt(selector: StructureViewerSelector, keys: string[]): number | null {
  for (const key of keys) {
    const value = selector[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseInt(value.trim(), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

/** Extracts atoms matching a viewer ligand/residue selector from the first PDB model. */
export function extractSelectedPdbAtoms(text: string, selector: StructureViewerSelector): MolecularAtom[] {
  const compId = selectorString(selector, ["label_comp_id", "auth_comp_id"])?.toUpperCase() ?? null;
  const chainId = selectorString(selector, ["auth_asym_id", "label_asym_id"]) ?? null;
  const seqId = selectorInt(selector, ["auth_seq_id", "label_seq_id"]);
  const insCode = selectorString(selector, ["pdbx_PDB_ins_code"]) ?? "";
  if (!compId && chainId === null && seqId === null) {
    throw new Error("Select a single ligand or residue to edit in 3D.");
  }
  const atoms: MolecularAtom[] = [];
  let altLoc: string | null = null;
  for (const line of text.split(/\r?\n/u)) {
    if (line.startsWith("ENDMDL")) break;
    if (!line.startsWith("ATOM  ") && !line.startsWith("HETATM")) continue;
    const alt = line[16]?.trim() ?? "";
    if (alt && (altLoc ??= alt) !== alt) continue;
    const lineComp = line.slice(17, 20).trim().toUpperCase();
    const lineChain = line[21]?.trim() ?? "";
    const lineSeq = Number.parseInt(line.slice(22, 26).trim(), 10);
    const lineIns = line[26]?.trim() ?? "";
    if (compId && lineComp !== compId) continue;
    if (chainId !== null && lineChain !== chainId) continue;
    if (seqId !== null && lineSeq !== seqId) continue;
    if (insCode && lineIns !== insCode) continue;
    const name = line.slice(12, 16);
    const raw = line.slice(76, 78).trim() || (name[0] === " " || /\d/u.test(name[0]) ? name.trim().replace(/^\d+/u, "")[0] : name.trim().slice(0, 2)) || "";
    const element = normalizeElement(raw);
    const [x, y, z] = [line.slice(30, 38), line.slice(38, 46), line.slice(46, 54)].map(Number);
    if (!element || ![x, y, z].every(Number.isFinite)) continue;
    atoms.push({ element, x, y, z });
  }
  if (!atoms.length) throw new Error("Could not find the selected ligand in the PDB file.");
  return atoms;
}

function tokenizeCifRow(line: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < line.length) {
    while (index < line.length && /\s/u.test(line[index])) index += 1;
    if (index >= line.length || line[index] === "#") break;
    const quote = line[index];
    if (quote === "'" || quote === "\"") {
      index += 1;
      const start = index;
      while (index < line.length && !(line[index] === quote && (index + 1 === line.length || /\s/u.test(line[index + 1])))) {
        index += 1;
      }
      tokens.push(line.slice(start, index));
      if (index < line.length) index += 1;
    } else {
      const start = index;
      while (index < line.length && !/\s/u.test(line[index])) index += 1;
      tokens.push(line.slice(start, index));
    }
  }
  return tokens;
}

/** Extracts atoms matching a viewer ligand/residue selector from an mmCIF `_atom_site` loop. */
export function extractSelectedMmcifAtoms(text: string, selector: StructureViewerSelector): MolecularAtom[] {
  const compId = selectorString(selector, ["label_comp_id", "auth_comp_id"])?.toUpperCase() ?? null;
  const chainId = selectorString(selector, ["auth_asym_id", "label_asym_id"]) ?? null;
  const seqId = selectorInt(selector, ["auth_seq_id", "label_seq_id"]);
  const insCode = selectorString(selector, ["pdbx_PDB_ins_code"]) ?? "";
  if (!compId && chainId === null && seqId === null) {
    throw new Error("Select a single ligand or residue to edit in 3D.");
  }
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const columns: string[] = [];
  let inLoop = false;
  let inAtomSite = false;
  const atoms: MolecularAtom[] = [];
  let firstModel: string | null = null;
  let altLoc: string | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed === "loop_") {
      if (inAtomSite && atoms.length > 0) break;
      inLoop = true;
      inAtomSite = false;
      columns.length = 0;
      continue;
    }
    if (inLoop && trimmed.startsWith("_")) {
      if (trimmed.startsWith("_atom_site.")) {
        inAtomSite = true;
        columns.push(trimmed.slice("_atom_site.".length));
      } else if (inAtomSite) {
        break;
      } else {
        inLoop = false;
      }
      continue;
    }
    if (!inAtomSite) continue;
    if (trimmed.startsWith("data_") || trimmed.startsWith("_") || trimmed === ";") break;
    const row = tokenizeCifRow(trimmed);
    if (row.length < columns.length) continue;
    const col = (name: string) => {
      const idx = columns.indexOf(name);
      return idx >= 0 ? row[idx] : "";
    };
    const model = col("pdbx_PDB_model_num");
    if (model && model !== "." && model !== "?") {
      if (firstModel === null) firstModel = model;
      else if (model !== firstModel) break;
    }
    const alt = col("label_alt_id");
    if (alt && alt !== "." && alt !== "?") {
      if (altLoc === null) altLoc = alt;
      else if (alt !== altLoc) continue;
    }
    const rowComp = (col("label_comp_id") || col("auth_comp_id")).toUpperCase();
    const rowAuthChain = col("auth_asym_id");
    const rowLabelChain = col("label_asym_id");
    const rowSeq = Number.parseInt(col("auth_seq_id") || col("label_seq_id"), 10);
    const rowIns = col("pdbx_PDB_ins_code");
    if (compId && rowComp !== compId) continue;
    if (chainId !== null && rowAuthChain !== chainId && rowLabelChain !== chainId) continue;
    if (seqId !== null && rowSeq !== seqId) continue;
    if (insCode && rowIns !== insCode) continue;
    const element = normalizeElement(col("type_symbol") || col("label_atom_id") || col("auth_atom_id"));
    const x = Number(col("Cartn_x"));
    const y = Number(col("Cartn_y"));
    const z = Number(col("Cartn_z"));
    if (!element || ![x, y, z].every(Number.isFinite)) continue;
    atoms.push({ element, x, y, z });
  }
  if (!atoms.length) throw new Error("Could not find the selected ligand in the CIF file.");
  return atoms;
}

function assertEditableAtomCount(count: number, hasLigandHint = false) {
  if (count < 1) throw new Error("No atoms were found to edit.");
  if (count > EDIT_3D_MAX_ATOMS) {
    throw new Error(hasLigandHint
      ? `3D atom editing supports up to ${EDIT_3D_MAX_ATOMS} atoms (this structure has ${count.toLocaleString()}). Select a ligand in the 3D view or Structure section, then choose Edit in 3D.`
      : `3D atom editing supports up to ${EDIT_3D_MAX_ATOMS} atoms (this structure has ${count.toLocaleString()}).`);
  }
}

async function atomsToEditableSdf(atoms: MolecularAtom[], title: string, signal?: AbortSignal): Promise<string> {
  assertEditableAtomCount(atoms.length);
  const parsed = await runChemistryTask({ action: "parse", source: serializeXyz(atoms, title), format: "xyz" }, { signal });
  return sdfRecord(parsed.molfile);
}

/**
 * Opens the active 3D structure for editing. Single SDF/MOL files open directly in
 * Edit; single XYZ files open in Geometry; PDB, CIF, MOL2, multi-record SDF, and
 * quantum files convert the active structure (or selected ligand) into an editable
 * 3D SDF copy and switch the right dock to Edit.
 */
export async function openEdit3d(
  document: ViewerDocument,
  actions: Pick<ShellActions, "openStructureRecords" | "openDockTab" | "setDockDocument">,
  options: {
    ligand?: Edit3dLigandScope | null;
    mode?: "auto" | "atoms-and-bonds";
    frameIndex?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ openedCopy: boolean; document: ViewerDocument }> {
  const mode = edit3dMode(document);
  if (!mode) throw new Error("This file cannot be edited in 3D.");
  const extension = sourceExtension(document);
  const preferAtomsAndBonds = options.mode === "atoms-and-bonds";

  const text = logicalSourceFor(document.id)?.text ?? await readStructureText(document.path);
  options.signal?.throwIfAborted();
  const shape = classifySourceShape(extension, text);

  if (!preferAtomsAndBonds && mode === "in-place-geometry" && shape === "single") {
    actions.setDockDocument("right", document.id);
    actions.openDockTab("right", "geometry");
    return { openedCopy: false, document };
  }

  if (mode === "in-place-graph" && shape === "single") {
    actions.setDockDocument("right", document.id);
    actions.openDockTab("right", "structure-edit");
    return { openedCopy: false, document };
  }

  const stem = fileStem(document.title);
  let copyName = `${stem}-edit`;
  let sdfText: string;

  if (GRAPH_EXTENSIONS.has(extension)) {
    const recordIndex = options.frameIndex ?? 0;
    const record = extractSdfRecord(text, recordIndex);
    const parsed = await runChemistryTask({ action: "parse", source: record, format: "sdf" }, { signal: options.signal });
    sdfText = sdfRecord(parsed.molfile);
    copyName = `${stem}-molecule-${recordIndex + 1}`;
  } else if (extension === "mol2") {
    const rawSdf = parseMol2ToSdf(text, stem);
    const parsed = await runChemistryTask({ action: "parse", source: rawSdf, format: "sdf" }, { signal: options.signal });
    sdfText = sdfRecord(parsed.molfile);
  } else if (PDB_EXTENSIONS.has(extension)) {
    const atoms = options.ligand
      ? extractSelectedPdbAtoms(text, options.ligand.selector)
      : readPdbAtoms(text);
    assertEditableAtomCount(atoms.length, !options.ligand);
    copyName = options.ligand ? `${stem}-${fileStem(options.ligand.label)}` : `${stem}-edit`;
    sdfText = await atomsToEditableSdf(atoms, copyName, options.signal);
  } else if (CIF_EXTENSIONS.has(extension) && options.ligand) {
    const atoms = extractSelectedMmcifAtoms(text, options.ligand.selector);
    assertEditableAtomCount(atoms.length, false);
    copyName = `${stem}-${fileStem(options.ligand.label)}`;
    sdfText = await atomsToEditableSdf(atoms, copyName, options.signal);
  } else if (extension === "xyz" && options.frameIndex !== undefined && options.frameIndex > 0) {
    const scientific = await runReaderTask({ action: "parse", name: `${stem}.xyz`, text }, { signal: options.signal });
    const frame = scientific.frames[Math.min(options.frameIndex, Math.max(0, scientific.frames.length - 1))];
    if (!frame?.atoms?.length) throw new Error("The selected XYZ frame has no atoms.");
    copyName = `${stem}-frame-${options.frameIndex + 1}`;
    sdfText = await atomsToEditableSdf(frame.atoms, copyName, options.signal);
  } else {
    const source = await readWorkbenchSource(document, text, options.signal);
    assertEditableAtomCount(source.atoms.length, CIF_EXTENSIONS.has(extension));
    sdfText = await atomsToEditableSdf(source.atoms, copyName, options.signal);
  }

  options.signal?.throwIfAborted();
  const opened = await openGeneratedStructure(actions, copyName, "sdf", sdfText, undefined, { newDocument: true });
  const target = opened[0];
  if (!target) throw new Error("Could not open an editable 3D copy.");
  markEditableVirtualGraph(target.id);
  actions.setDockDocument("right", target.id);
  actions.openDockTab("right", "structure-edit");
  return { openedCopy: true, document: target };
}

export type Edit3dRequest = {
  document: ViewerDocument;
  mode?: "auto" | "atoms-and-bonds";
};

const edit3dListeners = new Set<(request: Edit3dRequest) => void>();

export function requestEditIn3d(document: ViewerDocument, options: { mode?: "auto" | "atoms-and-bonds" } = {}) {
  const request: Edit3dRequest = { document, mode: options.mode };
  for (const listener of edit3dListeners) listener(request);
}

export function subscribeEditIn3d(listener: (request: Edit3dRequest) => void) {
  edit3dListeners.add(listener);
  return () => { edit3dListeners.delete(listener); };
}

