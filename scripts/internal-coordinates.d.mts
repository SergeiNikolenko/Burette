export type CoordinateAtom = { element: string; position: number[] };
export type ZmatrixRow = { element: string; refs: number[]; values: number[] };

export const MAX_INTERNAL_COORDINATE_ATOMS: number;
export function parseXyzAtoms(text: string): CoordinateAtom[];
export function parseZmatrixRows(text: string): ZmatrixRow[];
export function atomsFromZmatrixRows(rows: ZmatrixRow[]): CoordinateAtom[];
export function zmatrixRowsFromAtoms(atoms: CoordinateAtom[]): ZmatrixRow[];
export function formatZmatrix(rows: ZmatrixRow[]): string;
export function formatXyz(atoms: CoordinateAtom[], comment: string): string;
export function placeInReferenceFrame(atoms: CoordinateAtom[], reference: CoordinateAtom[], points?: CoordinateAtom[]): CoordinateAtom[];
