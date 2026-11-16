import type { MainModule as RDKitModule } from "@rdkit/rdkit";

export const LIBRARY_PRODUCT_LIMIT: number;

export class LibraryInputError extends Error {}

export type LibraryBuildingBlock = {
  smiles?: string | null;
  molblock?: string | null;
  /** Where the building block came from, as the product row will say it. */
  source: string;
};

export type LibraryRequest =
  | { mode: "reaction"; reaction: string; reactionName?: string; positions: LibraryBuildingBlock[][] }
  | { mode: "core"; core: string; positions: LibraryBuildingBlock[][] };

export type LibraryProduct = {
  smiles: string;
  molblock: string;
  parts: Array<{ smiles: string; source: string }>;
};

export type Library = {
  schemeLabel: "Reaction" | "Core";
  scheme: string;
  positions: Array<{ label: string; used: number; unreadable: number; unmatched: number }>;
  products: LibraryProduct[];
  combinations: number;
  duplicates: number;
  withoutProduct: number;
  capped: boolean;
};

export function reactionReactantTemplates(smarts: string): string[];
export function coreAttachmentLabels(core: string): number[];
export function enumerateLibrary(
  rdkit: RDKitModule,
  request: LibraryRequest,
  options?: { onProgress?: (done: number, total: number) => void },
): Library;
export function libraryToSdf(library: Library): string;
