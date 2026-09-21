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
  if (!bundle) return false;
  // A structure sitting next to a stray JSON sidecar (e.g. an xTB run marker) is
  // not a folding result. The backend classifies any loose .json as "metadata"
  // and would otherwise show the whole folder as folding output. Require real
  // folding signal instead: a confidence profile, a PAE matrix, per-model
  // metrics, or an artifact that is more than app metadata.
  const isFoldingArtifact = (artifact: { kind: string }) => artifact.kind !== "metadata";
  return bundle.models.some((model) =>
    model.metrics.length > 0
    || Boolean(model.plddtProfile)
    || Boolean(model.matrixPreview)
    || model.artifacts.some(isFoldingArtifact),
  ) || bundle.artifacts.some(isFoldingArtifact);
}
