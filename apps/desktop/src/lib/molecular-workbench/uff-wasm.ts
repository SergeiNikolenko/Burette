// Explicit transport adapter for the pinned, worker-only RDKit UFF module.
// @ts-expect-error generated pinned RDKit module has no authored declarations
import initializeExtractor from "../../../../../PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.js";

const REVISION = "Release_2025_03_4@276b5a662302c6a548ac4f1363c066f3258e3a20";
const MAXIMUM_INPUT_BYTES = 2 * 1024 * 1024;
const wasmUrl = new URL(
  "../../../../../PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.wasm",
  import.meta.url,
).href;

type NativeEvaluation = { energyKcalMol: number; gradient: Float64Array; error?: string };
type NativeContext = {
  atom_count(): number;
  evaluate(coordinates: Float64Array): NativeEvaluation;
  delete(): void;
};
type UffModule = {
  rdkit_source_revision(): string;
  uff_evaluator_abi_version(): number;
  create_uff_evaluator(molblock: string): { context?: NativeContext; error?: string };
  compute_gasteiger_charges(molblock: string): { charges?: Float64Array; error?: string };
};

export type UffWasmEvaluator = {
  readonly atomCount: number;
  evaluate(coordinates: Float64Array): { energyKcalMol: number; gradient: Float64Array };
  dispose(): void;
};

let module: UffModule | undefined;
let loading: Promise<void> | undefined;

export function prepareUffWasm(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const response = await fetch(wasmUrl);
      if (!response.ok) throw new Error(`Cannot load UFF (${response.status}).`);
      const loaded = await initializeExtractor({
        locateFile: () => wasmUrl,
        wasmBinary: new Uint8Array(await response.arrayBuffer()),
      }) as UffModule;
      if (loaded.rdkit_source_revision() !== REVISION
        || typeof loaded.uff_evaluator_abi_version !== "function"
        || loaded.uff_evaluator_abi_version() !== 1) {
        throw new Error("UFF module differs from the pinned RDKit ABI v1.");
      }
      module = loaded;
    })().catch((error) => {
      loading = undefined;
      throw error;
    });
  }
  return loading;
}

export function createUffWasmEvaluator(molblock: string): UffWasmEvaluator {
  if (!module) throw new Error("UFF must be prepared before creating an evaluator.");
  if (!molblock.trim() || molblock.length > MAXIMUM_INPUT_BYTES
    || new TextEncoder().encode(molblock).byteLength > MAXIMUM_INPUT_BYTES) {
    throw new Error("UFF MOL block must contain at most 2 MiB.");
  }
  const result = module.create_uff_evaluator(molblock);
  if (result.error || !result.context) throw new Error(result.error || "Cannot construct UFF.");
  let context: NativeContext | undefined = result.context;
  const atomCount = context.atom_count();
  return {
    atomCount,
    evaluate(coordinates) {
      if (!context) throw new Error("UFF evaluator has been disposed.");
      if (!(coordinates instanceof Float64Array) || coordinates.length !== 3 * atomCount) {
        throw new Error("UFF coordinates must contain exactly 3 values per atom.");
      }
      for (const coordinate of coordinates) {
        if (!Number.isFinite(coordinate) || Math.abs(coordinate) > 1e6) {
          throw new Error("UFF coordinates must be finite and within 1000000 angstrom.");
        }
      }
      const evaluated = context.evaluate(coordinates);
      if (evaluated.error) throw new Error(evaluated.error);
      if (!Number.isFinite(evaluated.energyKcalMol)
        || !(evaluated.gradient instanceof Float64Array)
        || evaluated.gradient.length !== coordinates.length
        || evaluated.gradient.some((value) => !Number.isFinite(value))) {
        throw new Error("UFF returned a non-finite energy or gradient.");
      }
      return { energyKcalMol: evaluated.energyKcalMol, gradient: evaluated.gradient };
    },
    dispose() {
      context?.delete();
      context = undefined;
    },
  };
}

export function calculateGasteigerWasm(molblock: string): Float64Array {
  if (!module) throw new Error("RDKit must be prepared before calculating Gasteiger charges.");
  if (!molblock.trim() || molblock.length > MAXIMUM_INPUT_BYTES
    || new TextEncoder().encode(molblock).byteLength > MAXIMUM_INPUT_BYTES) {
    throw new Error("Gasteiger MOL block must contain at most 2 MiB.");
  }
  const result = module.compute_gasteiger_charges(molblock);
  if (result.error || !result.charges) throw new Error(result.error || "Cannot calculate Gasteiger charges.");
  return result.charges;
}
