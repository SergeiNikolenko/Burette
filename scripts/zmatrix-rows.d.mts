import type { CoordinateAtom } from './internal-coordinates.mjs';
import type { ZmatrixDefinitionRow, ZmatrixDocument } from './zmatrix-document.mjs';
export type ZmatrixRowAction = { type: 'append'; row: ZmatrixDefinitionRow } | { type: 'remove'; index: number } | { type: 'move'; index: number; to: number };
export type ZmatrixRowEdit = {
  document: ZmatrixDocument;
  atoms: CoordinateAtom[];
  /** New real atom index -> old real atom index; null denotes an added atom. */
  atomMap: (number | null)[];
  detachedBindings: { row: number; slot: number; binding: string }[];
};
export function editZmatrixRows(document: ZmatrixDocument, action: ZmatrixRowAction, referenceAtoms?: CoordinateAtom[]): ZmatrixRowEdit;
