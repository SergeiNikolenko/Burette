import { parseMolecule, type MolecularStructure } from './molecular-graph';
import { editGraph, type GraphEdit, type GraphEditResult } from './graph-edit';

export type GraphRequest =
  | { action: 'parse'; source: string; format: 'xyz' | 'mol' | 'sdf' }
  | { action: 'edit-graph'; molecule: MolecularStructure; edits: GraphEdit[] };
export type GraphResults = { parse: MolecularStructure; 'edit-graph': GraphEditResult };

/** Shared graph operations for the focused worker and the complete chemistry worker. */
export function runGraphOperation<T extends GraphRequest>(data: T): GraphResults[T['action']] {
  if (data.action === 'parse') return parseMolecule(data.source, data.format) as GraphResults[T['action']];
  if (data.action !== 'edit-graph') throw new Error('Unknown chemistry operation.');
  // One user action can be several graph edits (add an atom, then bond it);
  // they apply together or not at all. Provenance composes back to the input.
  if (!data.edits.length || data.edits.length > 16) throw new Error('Apply 1–16 graph edits at a time.');
  let current: GraphEditResult | null = null;
  for (const edit of data.edits) {
    const next: GraphEditResult = editGraph(current ?? data.molecule, edit);
    current = current ? { ...next, sourceAtomIndices: next.sourceAtomIndices.map(i => i < 0 ? -1 : current!.sourceAtomIndices[i]) } : next;
  }
  return current! as GraphResults[T['action']];
}
