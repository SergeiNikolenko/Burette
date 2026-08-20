import { invoke } from "@tauri-apps/api/core";
import type { RDKitLoader, RDKitModule } from "@rdkit/rdkit";

import { isTauriRuntime } from "./tauri";

import {
  closestReferenceMatch,
  compileSubstructureQuery,
  computeDerivedValue,
  computeRowProperties,
  createReactionRunner,
  countSubstructureMatches,
  DERIVED_COLUMN_KINDS,
  morganFingerprint,
  murckoScaffoldMolecule,
  parseReferenceStructures,
  PROPERTY_COLUMNS,
  PROPERTY_GROUPS,
  runReactionOnRow,
  SCAFFOLD_COUNT_COLUMN,
  SIMILARITY_FINGERPRINT_SETTINGS,
  tanimoto,
  type DerivedColumnKind,
  type DerivedComputeResult,
  type DerivedComputeRow,
  type PropertyColumnInfo,
  type PropertyComputeResult,
  type PropertyGroupInfo,
  type PropertyRunOptions,
  type ReferenceFingerprint,
  type ReferenceStructure,
  type SubstructureSearcher,
} from "./derived-column-compute.mjs";

export {
  closestReferenceMatch,
  compileSubstructureQuery,
  computeDerivedValue,
  computeRowProperties,
  countSubstructureMatches,
  createReactionRunner,
  DERIVED_COLUMN_KINDS,
  morganFingerprint,
  murckoScaffoldMolecule,
  parseReferenceStructures,
  PROPERTY_COLUMNS,
  PROPERTY_GROUPS,
  runReactionOnRow,
  SCAFFOLD_COUNT_COLUMN,
  SIMILARITY_FINGERPRINT_SETTINGS,
  tanimoto,
};
export type {
  DerivedColumnKind,
  DerivedComputeResult,
  DerivedComputeRow,
  PropertyColumnInfo,
  PropertyComputeResult,
  PropertyGroupInfo,
  PropertyRunOptions,
  ReferenceFingerprint,
  ReferenceStructure,
  SubstructureSearcher,
};

export type DerivedSourceRow = {
  rowId: number;
  name: string;
  smiles?: string | null;
  molblock?: string | null;
  sourceIndex: number;
};

export type DerivedSourceRowsResult = {
  rows: DerivedSourceRow[];
  totalRows: number;
};

export type DerivedStoreValue = {
  rowId: number;
  valueReal?: number | null;
  valueText?: string | null;
  errorText?: string | null;
};

export type DerivedEngines = {
  ocl: typeof import("openchemlib");
  rdkit: RDKitModule;
};

// Both engines load lazily and once: openchemlib is a plain module, while RDKit
// receives its WASM bytes directly so packaged WKWebView never has to fetch a
// Vite data URL through Emscripten's network loader.
let enginesPromise: Promise<DerivedEngines> | null = null;

export function loadDerivedEngines(): Promise<DerivedEngines> {
  if (!enginesPromise) {
    enginesPromise = (async () => {
      const [ocl, oclResourcesRaw, rdkitModule, wasm] = await Promise.all([
        import("openchemlib"),
        // WKWebView cannot fetch Vite's emitted JSON asset through Tauri's
        // packaged frontend protocol. Bundle the predictor tables into the JS
        // chunk and register them without a runtime network request.
        import("../../../../node_modules/openchemlib/dist/resources.json?raw"),
        import("@rdkit/rdkit") as unknown as Promise<{ default: RDKitLoader }>,
        import("@rdkit/rdkit/dist/RDKit_minimal.wasm?url"),
      ]);
      // The Actelion predictors (druglikeness, toxicity) refuse to run until
      // their rule tables are registered.
      ocl.Resources.register(JSON.parse(oclResourcesRaw.default));
      const wasmUrl = wasm.default;
      const wasmBinary = wasmUrl.startsWith("data:")
        ? Uint8Array.from(atob(wasmUrl.slice(wasmUrl.indexOf(",") + 1)), (char) => char.charCodeAt(0))
        : new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
      const rdkitOptions = { locateFile: () => wasmUrl, wasmBinary };
      const rdkit = await rdkitModule.default(rdkitOptions);
      return { ocl, rdkit };
    })().catch((error) => {
      enginesPromise = null;
      throw error;
    });
  }
  return enginesPromise;
}

export async function fetchDerivedSourceRows(
  documentId: string,
  afterSourceIndex: number,
  limit?: number,
): Promise<DerivedSourceRowsResult> {
  return invoke<DerivedSourceRowsResult>("derived_source_rows", {
    request: {
      documentId,
      afterSourceIndex,
      ...(limit ? { limit } : {}),
    },
  });
}

export type RGroupRuntimeStatus = {
  available: boolean;
  pythonPath: string | null;
  rdkitVersion: string | null;
  message: string;
  installHint: string;
};

export type RGroupDecomposition = {
  rdkitVersion: string | null;
  labels: string[];
  rows: Array<{ rowId: number; values: Record<string, string> }>;
  unmatchedRows: number;
  unparsedRows: number;
};

// R-group decomposition is the one SAR tool that leaves the webview: RDKit's
// rdRGroupDecomposition has no in-process equivalent, so the managed Python
// runtime answers, and the menu asks first whether it can.
export async function rgroupRuntimeStatus(): Promise<RGroupRuntimeStatus> {
  if (!isTauriRuntime()) {
    return {
      available: false,
      pythonPath: null,
      rdkitVersion: null,
      message: "R-group decomposition needs the desktop app.",
      installHint: "Open the collection in Burette on the desktop.",
    };
  }
  return invoke<RGroupRuntimeStatus>("rgroup_runtime_status");
}

export async function decomposeRGroupsInRuntime(
  core: string,
  rows: Array<{ rowId: number; smiles: string | null; molblock: string | null }>,
): Promise<RGroupDecomposition> {
  return invoke<RGroupDecomposition>("rgroup_decompose", { request: { core, rows } });
}

export async function storeDerivedValues(
  documentId: string,
  column: {
    columnId: string;
    label: string;
    // Every kind that can reach the store: structure-derived, the property run,
    // formulas, merges, reactions and the SAR tools.
    kind:
      | DerivedColumnKind
      | "property"
      | "calculated"
      | "merged"
      | "reaction-product"
      | "scaffold-count"
      | "substructure-count"
      | "similarity"
      | "rgroup"
      | "row-number"
      | "bins";
    paramsJson?: string | null;
  },
  values: DerivedStoreValue[],
): Promise<{ stored: number }> {
  return invoke<{ stored: number }>("derived_store_values", {
    request: {
      documentId,
      columnId: column.columnId,
      label: column.label,
      kind: column.kind,
      paramsJson: column.paramsJson ?? null,
      values,
    },
  });
}
