import type { ScientificDocument, ScientificFrame } from "../molecular-workbench/scientific-types";
import type { ImportedRevision } from "./scientific-source-state";

const ATOM_ROW = /^(M {2}V30 \d+ \S+ )(\S+) (\S+) (\S+)( .*)$/u;

/**
 * The revision of a CJSON graph that shows coordinate set `index`: its MOL source with
 * that set's positions, and science whose graph points at it. Modes travel with their
 * geometry: the active set's move onto its frame and the chosen set's become the
 * document's. Orbitals and basis describe the set the file computed them for, so a
 * revision of another set has none; the file's own revision keeps them.
 */
export function cjsonCoordinateSetRevision(science: ScientificDocument, text: string, index: number): ImportedRevision {
  const graph = science.graph;
  if (science.format !== "cjson" || !graph || graph.molfile !== text) throw new Error("This structure has no coordinate sets.");
  const atoms = science.frames[index]?.atoms;
  if (!atoms || atoms.length !== science.atoms.length) throw new Error("This coordinate set is not in the file.");
  const rows = text.split("\n"), begin = rows.indexOf("M  V30 BEGIN ATOM"), end = rows.indexOf("M  V30 END ATOM");
  if (begin < 0 || end - begin - 1 !== atoms.length) throw new Error("The structure no longer matches its coordinate sets.");
  for (let i = 0; i < atoms.length; i++) {
    const match = ATOM_ROW.exec(rows[begin + 1 + i]), atom = atoms[i];
    if (!match) throw new Error("The structure no longer matches its coordinate sets.");
    rows[begin + 1 + i] = `${match[1]}${atom.x} ${atom.y} ${atom.z}${match[5]}`;
  }
  const molfile = rows.join("\n"), active = graph.activeFrameIndex;
  const frames = science.frames.map((frame, i): ScientificFrame => {
    if (i === index) { const { modes: _chosen, ...rest } = frame; return rest; }
    return i === active && science.modes.length ? { ...frame, modes: science.modes } : frame;
  });
  const { basis: _basis, ...rest } = science;
  return { text: molfile, document: { ...rest, atoms: science.atoms.map((atom, i) => ({ ...atom, x: atoms[i].x, y: atoms[i].y, z: atoms[i].z })), frames, modes: science.frames[index].modes ?? [], orbitals: [], graph: { molfile, activeFrameIndex: index } } };
}
