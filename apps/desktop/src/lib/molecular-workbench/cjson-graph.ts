import { elementSymbol } from "./elements";
import { checkMoleculeSize, parseMolecule, type MolecularStructure } from "./molecular-graph";
import { readCjsonSpectra } from "./scientific-spectra-inputs";
import type { ScientificSpectra } from "./scientific-spectra";
import type { MolecularAtom, MolecularBond } from "./types";

/** Explicit graph source prerequisite; it is not an XYZ ScientificDocument. */
export type CjsonGraphDocument = {
  format: "cjson";
  structure: MolecularStructure;
  coordinateSets: MolecularAtom[][];
  activeSet: number;
  spectra?: ScientificSpectra;
};

type RecordValue = Record<string, unknown>;
function fail(message: string): never { throw new Error(`Invalid Chemical JSON: ${message}`); }
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected an object.");
  return value as RecordValue;
}
function array(value: unknown, length?: number): unknown[] {
  if (!Array.isArray(value) || (length !== undefined && value.length !== length)) fail("array length does not match the source atoms or bonds.");
  return value;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) fail("integer is outside the supported range.");
  return value;
}

/** Coordinates and connection tables remain in CJSON source atom order. */
export function readCjsonGraph(name: string, text: string): CjsonGraphDocument {
  if (text.length > 16 * 1024 * 1024 || new TextEncoder().encode(text).byteLength > 16 * 1024 * 1024 || text.includes("\0")) fail("source exceeds 16 MiB or contains binary data.");
  const input = object(JSON.parse(text.replace(/^\uFEFF/u, "")));
  const version = input.chemicalJson ?? input["chemical json"];
  if (version !== 0 && version !== 1) fail("expected Chemical JSON version 0 or 1.");
  const atoms = object(input.atoms), coords = object(atoms.coords);
  if (input.unitCell != null || input["unit cell"] != null || coords["3dFractional"] !== undefined || coords["3d fractional"] !== undefined) {
    fail("periodic and fractional sources require a cell-preserving graph representation.");
  }
  const sourceNumbers = array(object(atoms.elements).number);
  checkMoleculeSize(sourceNumbers.length);
  const numbers = sourceNumbers.map(value => integer(value, 1, 118));
  const count = numbers.length, elements = numbers.map(elementSymbol);
  const sets = coords["3dSets"] === undefined ? [] : array(coords["3dSets"]);
  if (sets.length > 2_000 || Math.max(1, sets.length) * count * 3 > 2_000_000) fail("coordinate history exceeds the supported size.");
  const coordinateSets = (sets.length ? sets : [coords["3d"]]).map(value => {
    const flat = array(value, count * 3).map(number => {
      if (typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > 1e6) fail("coordinates must be finite and within 1000000 Å.");
      return number;
    });
    return elements.map((element, i) => ({ element, x: flat[i * 3], y: flat[i * 3 + 1], z: flat[i * 3 + 2] }));
  });
  // Native CJSON defaults to the first set, even when the separate `3d` block differs.
  const activeSet = coords["3dSetsActive"] === undefined ? 0 : integer(coords["3dSetsActive"], 0, coordinateSets.length - 1);
  const charges = atoms.formalCharges === undefined ? numbers.map(() => 0)
    : array(atoms.formalCharges, count).map(value => integer(value, -128, 127));
  const isotopes = atoms.isotopes === undefined ? numbers.map(() => 0)
    : array(atoms.isotopes, count).map((value, index) => value === 0 ? 0 : integer(value, numbers[index], 300));
  const bonds: MolecularBond[] = [];
  if (input.bonds !== undefined) {
    const source = object(input.bonds), connections = array(object(source.connections).index);
    if (connections.length % 2 || connections.length > count * (count - 1)) fail("invalid bond connection count.");
    const order = source.order === undefined ? Array(connections.length / 2).fill(1) : array(source.order, connections.length / 2);
    const pairs = new Set<string>();
    for (let i = 0; i < order.length; i++) {
      const a = integer(connections[2 * i], 0, count - 1), b = integer(connections[2 * i + 1], 0, count - 1);
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`, value = integer(order[i], 1, 6);
      if (a === b || pairs.has(key)) fail("self-bonds and duplicate bonds cannot form an explicit graph.");
      if (value > 3) fail("bond orders 4–6 cannot be represented by the current MOL graph; order 4 is not aromatic.");
      pairs.add(key); bonds.push({ a, b, order: value });
    }
  }
  const title = input.name ?? name;
  if (typeof title !== "string" || title.length > 1024 || /[\r\n\0]/u.test(title)) fail("name must be a single line of at most 1024 characters.");
  // Keep the source table verbatim in physical 3D space. Going through OCL's
  // writer first would reorder explicit H and introduce indexed stereo groups.
  const molfile = [title, "Burette".padEnd(20) + "3D", "", "  0  0  0  0  0  0              0 V3000",
    "M  V30 BEGIN CTAB", `M  V30 COUNTS ${count} ${bonds.length} 0 0 0`, "M  V30 BEGIN ATOM",
    ...coordinateSets[activeSet].map((atom, i) => `M  V30 ${i + 1} ${atom.element} ${atom.x} ${atom.y} ${atom.z} 0${charges[i] ? ` CHG=${charges[i]}` : ""}${isotopes[i] ? ` MASS=${isotopes[i]}` : ""}`),
    "M  V30 END ATOM", "M  V30 BEGIN BOND",
    ...bonds.map((bond, i) => `M  V30 ${i + 1} ${bond.order} ${bond.a + 1} ${bond.b + 1}`),
    "M  V30 END BOND", "M  V30 END CTAB", "M  END", ""].join("\n");
  const structure = { ...parseMolecule(molfile, "mol"), molfile, title, bonds };
  const spectra = readCjsonSpectra(input.spectra, { format: "cjson", scope: "file", name }, numbers);
  return { format: "cjson", structure, coordinateSets, activeSet, ...(spectra ? { spectra } : {}) };
}
