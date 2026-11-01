import type { ZmatrixDocument } from './zmatrix-document.mjs';
/** The structural subset of ScientificDocument carried by coordinate interchange. */
export type CoordinateInterchange = {
  atoms: { element: string; x: number; y: number; z: number }[];
  internalCoordinates: ZmatrixDocument;
};
export type CoordinateInterchangeRead = CoordinateInterchange & { comment: string };
export function readCoordinateInterchange(text: string, format: 'xyz' | 'zmat'): CoordinateInterchangeRead;
export function writeCoordinateInterchange(pair: CoordinateInterchange, format: 'xyz' | 'zmat', comment?: string): string;
