// Type surface for derived-column-compute.mjs (allowJs is off; the .mjs body
// is shared with the node golden tests, so types live in this declaration).

export type DerivedColumnKind =
  | "formula"
  | "canonical-smiles"
  | "inchi"
  | "inchikey"
  | "idcode"
  | "largest-fragment"
  | "murcko-scaffold"
  | "reaction-smiles"
  | "reaction-reactants"
  | "reaction-catalysts"
  | "reaction-products"
  | "reaction-transformation";

export type DerivedColumnKindInfo = {
  columnId: string;
  label: string;
  engine: "ocl" | "rdkit";
};

export type DerivedComputeRow = {
  smiles?: string | null;
  molblock?: string | null;
};

export type DerivedComputeEngines = {
  ocl?: unknown;
  rdkit?: unknown;
};

export type DerivedComputeResult = {
  valueText?: string;
  valueReal?: number;
  errorText?: string;
};

export declare const DERIVED_COLUMN_KINDS: Record<DerivedColumnKind, DerivedColumnKindInfo>;

export declare function computeDerivedValue(
  kind: DerivedColumnKind,
  engines: DerivedComputeEngines,
  row: DerivedComputeRow,
): DerivedComputeResult;

export type PropertyEngine = "ocl" | "rdkit";

export type PropertyColumnInfo = {
  id: string;
  label: string;
  engine: PropertyEngine;
  key?: string;
};

export type PropertyGroupInfo = {
  id: string;
  label: string;
  properties: PropertyColumnInfo[];
};

export type PropertyComputeResult = {
  valueReal?: number;
  valueText?: string;
  errorText?: string;
};

export type PropertyRunOptions = {
  largestFragment?: boolean;
};

export declare const PROPERTY_GROUPS: PropertyGroupInfo[];
export declare const PROPERTY_COLUMNS: Record<string, PropertyColumnInfo>;

export declare function computeRowProperties(
  engines: DerivedComputeEngines,
  row: DerivedComputeRow,
  propertyIds: string[],
  options?: PropertyRunOptions,
): Record<string, PropertyComputeResult>;

export declare const SCAFFOLD_COUNT_COLUMN: { columnId: string; label: string };

export declare function murckoScaffoldMolecule(ocl: unknown, molecule: unknown): unknown;

export type SubstructureSearcher = { setMolecule(molecule: unknown): void };

export declare function compileSubstructureQuery(ocl: unknown, smarts: string): SubstructureSearcher;

export declare function countSubstructureMatches(
  engines: DerivedComputeEngines,
  searcher: SubstructureSearcher,
  row: DerivedComputeRow,
): { valueReal?: number; errorText?: string };

export declare const SIMILARITY_FINGERPRINT_SETTINGS: {
  radius: number;
  fplen: number;
  useChirality: boolean;
  useFeatures: boolean;
};

export declare function morganFingerprint(rdkit: unknown, source: string): Uint32Array;

export declare function tanimoto(left: Uint32Array, right: Uint32Array): number;

export type ReferenceStructure = { smiles?: string; molblock?: string; name: string };

export type ReferenceFingerprint = { name: string; fingerprint: Uint32Array };

export declare function closestReferenceMatch(
  engines: DerivedComputeEngines,
  row: DerivedComputeRow,
  reference: ReferenceFingerprint[],
): { similarity?: number; name?: string; errorText?: string };

export declare function parseReferenceStructures(
  text: string,
  extension: string,
): ReferenceStructure[];
export type ReactionSource = {
  kind: "rxn" | "smiles";
  text: string;
};

export type ReactionParts = {
  reactants: string[];
  catalysts: string[];
  products: string[];
};

export declare function looksLikeRxnBlock(text: unknown): boolean;
export declare function looksLikeReactionSmiles(text: unknown): boolean;
export declare function reactionSourceFromRow(row: DerivedComputeRow): ReactionSource | null;
export declare function reactionPartsFromRow(
  engines: DerivedComputeEngines,
  row: DerivedComputeRow,
): ReactionParts;
export declare function reactionSmilesFromParts(parts: ReactionParts): string;
export declare function reactionTransformation(
  engines: DerivedComputeEngines,
  row: DerivedComputeRow,
): string;

export type ReactionRunner = { delete(): void };

export declare function createReactionRunner(
  engines: DerivedComputeEngines,
  smarts: string,
): ReactionRunner;

export declare function runReactionOnRow(
  engines: DerivedComputeEngines,
  runner: ReactionRunner,
  row: DerivedComputeRow,
  coReactants?: string[],
): DerivedComputeResult;
