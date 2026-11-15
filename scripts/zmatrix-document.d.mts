import type { CoordinateAtom, ZmatrixRow } from './internal-coordinates.mjs';
export type ZmatrixDefinitionRow = { element: string; refs: number[]; values: (number | string)[] };
export type ZmatrixDocument = { rows: ZmatrixDefinitionRow[]; variables: { name: string; value: number }[] };
export function parseZmatrixDocument(text: string): ZmatrixDocument;
export function resolveZmatrixDocument(document: ZmatrixDocument): ZmatrixRow[];
export function atomsFromZmatrixDocument(document: ZmatrixDocument): CoordinateAtom[];
export function formatZmatrixDocument(document: ZmatrixDocument): string;
