import { invoke } from "@tauri-apps/api/core";
import type { FoldingResultBundle } from "../types";
import { isTauriRuntime } from "./tauri";

export async function readFoldingResultBundle(path: string): Promise<FoldingResultBundle> {
  if (isTauriRuntime()) {
    return invoke<FoldingResultBundle>("read_folding_result_bundle", { path });
  }
  const response = await fetch(`/__burette/folding-result?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<FoldingResultBundle>;
}

export function hasFoldingResultContent(bundle: FoldingResultBundle | null) {
  return Boolean(bundle && (bundle.models.length > 0 || bundle.artifacts.length > 0));
}
