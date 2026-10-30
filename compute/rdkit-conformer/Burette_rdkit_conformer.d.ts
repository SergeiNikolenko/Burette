// Authored contract for jswrapper.cpp at RDKit Release_2025_03_4,
// commit 276b5a662302c6a548ac4f1363c066f3258e3a20, Emscripten 4.0.10.
// build-wasm.sh copies this declaration beside the generated ES module.

export type UffEvaluation =
  | { energyKcalMol: number; gradient: Float64Array; error?: never }
  | { error: string; energyKcalMol?: never; gradient?: never };

export interface UffEvaluatorContext {
  atom_count(): number;
  evaluate(coordinates: Float64Array): UffEvaluation;
  delete(): void;
}

export interface RDKitConformerModule {
  rdkit_source_revision(): string;
  conformer_extractor_abi_version(): number;
  mmff_extractor_abi_version(): number;
  uff_evaluator_abi_version(): number;
  extract_conformer_parameters(input: string, inputFormat: number, variant: number): Uint8Array;
  extract_mmff_parameters(input: string, inputFormat: number, variant: number): Uint8Array;
  create_uff_evaluator(molblock: string):
    | { context: UffEvaluatorContext; error?: never }
    | { error: string; context?: never };
  compute_gasteiger_charges(molblock: string):
    | { charges: Float64Array; error?: never }
    | { error: string; charges?: never };
}

export default function initialize(options?: {
  wasmBinary?: Uint8Array;
  locateFile?: (path: string, scriptDirectory: string) => string;
}): Promise<RDKitConformerModule>;
