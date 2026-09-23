import * as ocl from "openchemlib";
import { computeDerivedValue, type DerivedComputeRow, type DerivedComputeResult } from "../lib/derived-column-compute.mjs";

export type ScaffoldRequest = { id: number; rows: DerivedComputeRow[] };
export type ScaffoldResponse = { id: number; results?: DerivedComputeResult[]; error?: string };

self.addEventListener("message", (event: MessageEvent<ScaffoldRequest>) => {
  const { id, rows } = event.data;
  try {
    if (!Array.isArray(rows) || rows.length > 200
      || rows.reduce((size, row) => size + (row.smiles?.length ?? 0) + (row.molblock?.length ?? 0), 0) > 4 * 1024 * 1024) {
      throw new Error("Scaffold batch exceeds the molecular input limit");
    }
    const results = rows.map((row) => {
      const result = computeDerivedValue("murcko-scaffold", { ocl }, row);
      return result.errorText ? { errorText: result.errorText.slice(0, 500) } : result;
    });
    self.postMessage({ id, results } satisfies ScaffoldResponse);
  } catch (error) {
    self.postMessage({ id, error: String(error).slice(0, 500) } satisfies ScaffoldResponse);
  }
});
