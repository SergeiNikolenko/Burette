/**
 * The Avogadro command protocol (avogadrolibs InterfaceScript at the pinned
 * revision): the script reads one JSON object on stdin with the molecule in its
 * declared format, `selectedAtoms`, `charge`, `spin` and `options`, and prints
 * one JSON object. Burette never replaces the active molecule with the result;
 * a returned molecule opens as a new document.
 */
import { readCjsonGraph } from "../molecular-workbench/cjson-graph";
import type { MolecularStructure } from "../molecular-workbench/molecular-graph";
import { atomicNumber } from "../molecular-workbench/elements";
import { serializeXyz } from "../molecular-workbench/xyz";
import type { PluginCommand } from "./avogadro-plugin-manifest";

export type CommandOptionValue = string | number | boolean;
export type CommandOption =
  | { key: string; label: string; type: "integer" | "float"; value: number; minimum?: number; maximum?: number; tooltip?: string }
  | { key: string; label: string; type: "string" | "text"; value: string; tooltip?: string }
  | { key: string; label: string; type: "boolean"; value: boolean; tooltip?: string }
  | { key: string; label: string; type: "stringList"; value: string; values: string[]; tooltip?: string };

export type CommandResult = {
  /** A molecule to open as a new document. */
  molecule?: { extension: "sdf" | "xyz" | "pdb"; text: string };
  /** The command wants the molecule added to the current one rather than replacing it. */
  append: boolean;
  selectedAtoms: number[];
  messages: { kind: "message" | "warning" | "error"; text: string }[];
};

const MAX_OPTIONS = 64;
const label = (value: unknown, max = 128) => typeof value === "string" && value.trim() && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value) ? value.trim() : undefined;
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Reads a `user-options` file: `{ key: { type, label, default, ... } }`. Unknown types are dropped. */
export function readCommandOptions(text: string): CommandOption[] {
  const document = JSON.parse(text) as unknown;
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("Invalid options");
  const options: CommandOption[] = [];
  for (const [key, raw] of Object.entries(document as Record<string, unknown>).slice(0, MAX_OPTIONS)) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/u.test(key) || !raw || typeof raw !== "object") continue;
    const spec = raw as Record<string, unknown>, name = label(spec.label) ?? key, tooltip = label(spec.toolTip, 500);
    const common = { key, label: name, ...(tooltip ? { tooltip } : {}) };
    if (spec.type === "integer" || spec.type === "float") {
      const minimum = finite(spec.minimum), maximum = finite(spec.maximum);
      options.push({ ...common, type: spec.type, value: finite(spec.default) ?? minimum ?? 0, ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}) });
    } else if (spec.type === "string" || spec.type === "text") options.push({ ...common, type: spec.type, value: typeof spec.default === "string" ? spec.default.slice(0, 4096) : "" });
    else if (spec.type === "boolean") options.push({ ...common, type: "boolean", value: spec.default === true });
    else if (spec.type === "stringList" && Array.isArray(spec.values)) {
      const values = spec.values.map(value => label(value)).filter((value): value is string => Boolean(value)).slice(0, 64);
      const index = finite(spec.default);
      if (values.length) options.push({ ...common, type: "stringList", values, value: typeof spec.default === "string" && values.includes(spec.default) ? spec.default : values[index !== undefined && values[index] ? index : 0] });
    }
  }
  return options;
}

function cjson(structure: MolecularStructure) {
  return {
    chemicalJson: 1,
    atoms: {
      elements: { number: structure.atoms.map(atom => atomicNumber(atom.element)) },
      coords: { "3d": structure.atoms.flatMap(atom => [atom.x, atom.y, atom.z]) },
    },
    bonds: { connections: { index: structure.bonds.flatMap(bond => [bond.a, bond.b]) }, order: structure.bonds.map(bond => bond.order) },
  };
}

/** The stdin document for one command run. */
export function commandInput(command: PluginCommand, structure: MolecularStructure, options: Record<string, CommandOptionValue>, selectedAtoms: readonly number[] = []): string {
  const molfile = structure.molfile.endsWith("$$$$\n") ? structure.molfile : `${structure.molfile.replace(/\n?$/u, "\n")}$$$$\n`;
  const text = command.inputFormat === "xyz" ? serializeXyz([...structure.atoms], structure.title)
    : command.inputFormat === "sdf" || command.inputFormat === "mol" ? molfile : undefined;
  return JSON.stringify({
    ...(command.inputFormat === "cjson" || command.inputCjson ? { cjson: cjson(structure) } : {}),
    ...(text !== undefined ? { [command.inputFormat]: text } : {}),
    inputMoleculeFormat: command.inputFormat,
    selectedAtoms: [...selectedAtoms],
    charge: 0,
    spin: 1,
    options,
  });
}

function messages(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string").join("\n").trim() || undefined;
  return undefined;
}

/** CJSON atom and bond labels (for example R/S and E/Z assignments) as one message. */
function labels(document: Record<string, unknown>, elements: readonly string[]): string | undefined {
  const atoms = (document.atoms as Record<string, unknown> | undefined)?.labels, bonds = (document.bonds as Record<string, unknown> | undefined)?.labels;
  const parts = [
    ...(Array.isArray(atoms) ? atoms.flatMap((value, index) => label(value, 32) ? [`${elements[index] ?? "Atom"}${index + 1} ${value}`] : []) : []),
    ...(Array.isArray(bonds) ? bonds.flatMap((value, index) => label(value, 32) ? [`Bond ${index + 1} ${value}`] : []) : []),
  ];
  return parts.length ? parts.slice(0, 200).join(", ") : undefined;
}

/** Parses the script's stdout. Leading non-JSON lines (library chatter) are ignored, as Avogadro does. */
export function readCommandOutput(stdout: string, atomCount: number): CommandResult {
  const start = stdout.search(/^\s*\{/mu);
  if (start < 0) {
    if (!stdout.trim()) return { append: false, selectedAtoms: [], messages: [] };
    throw new Error("The command did not answer with JSON.");
  }
  const document = JSON.parse(stdout.slice(start)) as Record<string, unknown>;
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("The command did not answer with a JSON object.");
  const result: CommandResult = { append: document.append === true, selectedAtoms: [], messages: [] };
  for (const kind of ["message", "warning", "error"] as const) {
    const text = messages(document[kind]);
    if (text) result.messages.push({ kind, text: text.slice(0, 4000) });
  }
  if (Array.isArray(document.selectedAtoms)) {
    result.selectedAtoms = [...new Set(document.selectedAtoms.filter((index): index is number => Number.isInteger(index) && index >= 0 && index < atomCount))].sort((a, b) => a - b);
  }
  const format = typeof document.moleculeFormat === "string" ? document.moleculeFormat.toLowerCase() : "cjson";
  if (format === "cjson" && document.cjson && typeof document.cjson === "object") {
    const text = JSON.stringify(document.cjson);
    const graph = readCjsonGraph("result.cjson", text);
    const records = graph.coordinateSets.length > 1 ? graph.coordinateSets.map(atoms => withCoordinates(graph.structure.molfile, atoms)) : [graph.structure.molfile];
    result.molecule = { extension: "sdf", text: records.map(record => `${record.replace(/\n?$/u, "\n")}$$$$\n`).join("") };
    const described = labels(document.cjson as Record<string, unknown>, graph.structure.atoms.map(atom => atom.element));
    if (described) result.messages.push({ kind: "message", text: described });
  } else if ((format === "sdf" || format === "mol" || format === "xyz" || format === "pdb") && typeof document[format] === "string" && (document[format] as string).trim()) {
    result.molecule = { extension: format === "mol" ? "sdf" : format, text: document[format] as string };
  } else if (document.moleculeFormat !== undefined && document[format] !== undefined) {
    throw new Error("The command answered with a molecule format Burette cannot open.");
  }
  return result;
}

/** Replaces V2000 atom-block coordinates, keeping every other column. */
function withCoordinates(molfile: string, atoms: readonly { x: number; y: number; z: number }[]) {
  const lines = molfile.split("\n");
  const counts = lines[3] ?? "", atomCount = Number(counts.slice(0, 3));
  if (!/V2000/u.test(counts) || atomCount !== atoms.length) return molfile;
  for (let index = 0; index < atomCount; index++) {
    const line = lines[4 + index], atom = atoms[index];
    lines[4 + index] = [atom.x, atom.y, atom.z].map(value => value.toFixed(4).padStart(10)).join("") + line.slice(30);
  }
  return lines.join("\n");
}
