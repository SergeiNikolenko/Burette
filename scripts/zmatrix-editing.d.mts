import type { ZmatrixDocument } from './zmatrix-document.mjs';
export function addZmatrixVariable(document: ZmatrixDocument, name: string, value: number): ZmatrixDocument;
export function renameZmatrixVariable(document: ZmatrixDocument, name: string, nextName: string): ZmatrixDocument;
export function removeZmatrixVariable(document: ZmatrixDocument, name: string): ZmatrixDocument;
export function bindZmatrixCoordinate(document: ZmatrixDocument, rowIndex: number, slot: number, binding: string | number | null): ZmatrixDocument;
export function setZmatrixReferences(document: ZmatrixDocument, rowIndex: number, refs: number[]): { document: ZmatrixDocument; detachedSlots: number[] };
