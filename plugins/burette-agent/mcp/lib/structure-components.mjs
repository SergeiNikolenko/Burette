import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const MAX_COMPONENT_BYTES = 16 * 1024 * 1024;
const WATER_NAMES = new Set(["HOH", "WAT", "H2O", "DOD", "TIP", "TIP3", "TIP3P", "TIP4", "TIP4P", "TP3", "TP4", "SPC", "SPCE", "SOL"]);
const ION_NAMES = new Set(["AG", "AL", "BA", "BR", "CA", "CD", "CL", "CO", "CS", "CU", "FE", "HG", "IOD", "K", "LI", "MG", "MN", "NA", "NI", "RB", "SR", "ZN"]);

export async function extractStructureComponentFile({
  file,
  component,
  chain,
  compId,
  seq,
  element,
  title,
}) {
  const sourcePath = path.resolve(file);
  const fileStat = await stat(sourcePath);
  if (!fileStat.isFile()) throw new Error(`Not a file: ${sourcePath}`);
  if (fileStat.size > MAX_COMPONENT_BYTES) throw new Error(`File is too large for component extraction: ${fileStat.size} bytes`);
  const extension = path.extname(sourcePath).replace(/^\./u, "").toLowerCase();
  if (extension !== "pdb" && extension !== "ent") {
    throw new Error(`Component extraction currently supports PDB/ENT files, not .${extension || "file"}.`);
  }
  const text = await readFile(sourcePath, "utf8");
  const records = pdbAtomLines(text)
    .filter((record) => matchesComponent(record, { component, chain, compId, seq, element }));
  if (records.length === 0) {
    throw new Error("No atoms matched the requested component.");
  }
  const outputDir = path.join(tmpdir(), "burrete-agent-components");
  await mkdir(outputDir, { recursive: true });
  const outputTitle = safeFileName(title || componentTitle({ component, chain, compId, seq, element }));
  const outputPath = path.join(outputDir, `${outputTitle}.pdb`);
  const contents = [
    `REMARK Extracted by Burrete agent from ${sourcePath}`,
    `REMARK Component ${componentTitle({ component, chain, compId, seq, element })}`,
    ...records.map((record) => record.line),
    "END",
    "",
  ].join("\n");
  await writeFile(outputPath, contents, "utf8");
  return {
    outputPath,
    sourcePath,
    title: path.basename(outputPath),
    atomCount: records.length,
    component: componentTitle({ component, chain, compId, seq, element }),
  };
}

export function componentSelector({ component, chain, compId, seq, element }) {
  const selector = {};
  if (component === "polymer" || component === "ligand" || component === "water" || component === "ion") {
    selector.kind = component;
  }
  if (chain) selector.auth_asym_id = chain;
  if (compId) selector.label_comp_id = compId.toUpperCase();
  if (seq !== undefined && seq !== null && String(seq).trim()) selector.auth_seq_id = numericOrString(seq);
  if (element) selector.type_symbol = normalizeElement(element);
  return selector;
}

function pdbAtomLines(text) {
  const records = [];
  for (const line of text.split(/\r?\n/u)) {
    const group = line.slice(0, 6).trim();
    if (group !== "ATOM" && group !== "HETATM") continue;
    const atomName = line.slice(12, 16).trim();
    records.push({
      line,
      group,
      atomName,
      resName: line.slice(17, 20).trim().toUpperCase() || "UNK",
      chain: line.slice(21, 22).trim() || "-",
      seq: line.slice(22, 26).trim() || "?",
      element: normalizeElement(line.slice(76, 78).trim() || atomName),
    });
  }
  return records;
}

function matchesComponent(record, request) {
  if (request.chain && record.chain !== request.chain) return false;
  if (request.compId && record.resName !== request.compId.toUpperCase()) return false;
  if (request.seq !== undefined && request.seq !== null && String(request.seq).trim() && String(record.seq) !== String(request.seq)) return false;
  if (request.element && record.element !== normalizeElement(request.element)) return false;
  if (request.component === "chain") return Boolean(request.chain);
  if (request.component === "element") return Boolean(request.element);
  if (request.component === "ligand") return record.group === "HETATM" && !WATER_NAMES.has(record.resName) && !ION_NAMES.has(record.resName);
  if (request.component === "water") return WATER_NAMES.has(record.resName);
  if (request.component === "ion") return ION_NAMES.has(record.resName);
  if (request.component === "polymer") return record.group === "ATOM";
  return false;
}

function componentTitle({ component, chain, compId, seq, element }) {
  return [
    component,
    compId ? compId.toUpperCase() : null,
    chain ? `chain-${chain}` : null,
    seq !== undefined && seq !== null && String(seq).trim() ? `seq-${seq}` : null,
    element ? `element-${normalizeElement(element)}` : null,
  ].filter(Boolean).join("-");
}

function safeFileName(value) {
  return String(value || "component").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "component";
}

function normalizeElement(value) {
  const cleaned = String(value || "").replace(/[^A-Za-z]/g, "");
  if (!cleaned) return "";
  if (cleaned.length === 1) return cleaned.toUpperCase();
  return `${cleaned[0].toUpperCase()}${cleaned.slice(1, 2).toLowerCase()}`;
}

function numericOrString(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && String(parsed) === String(value).trim() ? parsed : String(value);
}
